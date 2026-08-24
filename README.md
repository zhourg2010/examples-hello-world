# nodepipe — 家庭代理订阅自动化管道

本地机器定时测活/测速代理节点 → 挑出**美国节点** → 推送到 Deno Deploy → 家人/朋友设备拉取订阅。

本地端(`nodepipe/`)在 **macOS / Ubuntu / Windows** 上都能跑,同一份 Python 代码。

## 一、整体架构

```
[上游订阅源 x N]
      │  (SUB_URL,逗号分隔多个)
      ▼
[本地机器: subs-check]   ← 测活 + 测速 + Claude解锁检测(media-check) + 重命名(国家码前缀)
      │  bin/output/all.yaml
      ▼
[select_and_push.py]     ← 严格 GeoIP 核实"真的在美国" + 按协议轮转选点(上限100)
      │                     + 三振出局历史 + 三层兜底
      │  POST /push (base64)
      ▼
[Deno Deploy]            ← 存节点池,按链接后缀转换成 clash / sing-box / base64 /
      │                     Surge / Quantumult X / Loon 等格式
      ▼
[家人设备]  OpenClash / mihomo / sing-box / Surge / Loon / QX / v2rayN / V2Box …
```

## 二、本地端(`nodepipe/`)

完整说明见 **[nodepipe/README.md](nodepipe/README.md)**(装法、目录结构、三平台定时任务、
推送逻辑细节、日常操作速查)。这里只列文件清单:

```
nodepipe/
  common.py               跨平台基础:目录/env/日志/解释器路径,平台差异全收口在这
  select_and_push.py      核心:选美国节点 + 推送
  gen_config.py           生成 subs-check 的 config.yaml + 回调包装脚本
  run_once.py             跑一轮完整流程(测活测速 → 回调推送)
  archive_sub.py          归档订阅源原始内容(独立小工具,跟主链路无关)
  install_scheduler.py    在当前平台装/卸载定时任务,三平台一条命令
  clash_source.py         另一条数据源:本地 Clash Verge Rev 的节点 + 实测延迟
  geoip.py                本地 GeoIP 库(判断节点服务器是否真在美国)
  node_cache.py           节点出现次数统计(排序时当"稳定性"用)
  scheduler/
    macos/…plist          launchd 模板
    linux/…service|timer  systemd user timer 模板
    windows/…xml          计划任务模板
  env.example             配置模板
```

### 两条数据源

平时定时任务走 subs-check。也可以把**本地 Clash Verge Rev 里当下实测延迟达标**的节点
直接推出去,不用等下一轮测速:

```bash
SOURCE=clash python3 select_and_push.py                    # 只按延迟筛
SOURCE=clash CLASH_MIN_SPEED=0.5 python3 select_and_push.py  # 再加上"速度 ≥ 0.5 MB/s"
```

两条路只在"从哪儿拿候选 + 怎么判断好不好用"这一步不同,后面的美国核实、轮转选点、
上限、三层兜底、推送全部共用同一份代码。

⚠️ **Clash 自己不产生速度数据** —— mihomo 的 API 只有 `/delay`(延迟),没有测速端点;
Clash Verge Rev 界面上那些"速度"是连接列表的实时流量显示,不是逐节点测速。所以按速度筛
只能由脚本驱动内核实测(切 global 模式 → 逐个切节点下载 → 还原),串行、几分钟,
期间本机出口节点会跟着变。默认是关的。细节见 [nodepipe/README.md](nodepipe/README.md#另一条数据源直接用本地-clash-verge-rev-的节点)。

## 三、Deno 端

```
main.ts                 路由分派
routes/subscribe.ts     订阅出口:/l/{user}/{id}[/{格式后缀}]
routes/push.ts          接收本地推送
formats.ts              **格式登记表**:格式 → 渲染器 + 支持的客户端 + 支持的协议
clash.ts                → Clash / mihomo YAML
singbox.ts              → sing-box JSON(同时是所有格式共用的分享链接解析层)
surge.ts                → Surge 5 conf
quanx.ts                → Quantumult X server_local 行
loon.ts                 → Loon conf
fmt-util.ts             各格式转换器共用工具(去重/洗名字/时间戳标记节点)
protocol-filter.ts      按协议过滤 + 按数量上限截断
kv.ts                   设备/节点池存储(Deno KV)
ui.ts / tools_ui.ts     管理后台页面
```

### 支持的格式和对应客户端

订阅链接是 `/l/{用户名}/{id}`,后面加后缀切换格式。不加后缀走设备在后台设置的默认格式
(**新建设备默认是 clash**)。

| 后缀 | 格式 | 支持的客户端 | 能表达的协议 |
|---|---|---|---|
| *(不加)* | 设备默认格式 | — | 取决于所选格式 |
| `/clash` | Clash / mihomo YAML | OpenClash、mihomo(Clash.Meta)、Clash Verge Rev、ClashX Meta、Stash、FlClash | vless / anytls / trojan / vmess / ss |
| `/openclash` | 同上(旧链接别名) | OpenClash | 同上 |
| `/singbox` | sing-box JSON | sing-box、SFI / SFM(iOS/macOS)、Hiddify | 同上 |
| `/base64` | base64 标准订阅 | v2rayN、Shadowrocket、NekoBox、Hiddify 等 | 同上 |
| `/v2box` | base64(去掉 anytls) | V2Box | vless / trojan / vmess / ss |
| `/v2rayn` | base64(去掉 anytls) | v2rayN | vless / trojan / vmess / ss |
| `/surge` | Surge 5 conf | Surge 5(macOS / iOS) | **仅** trojan / vmess / ss |
| `/quanx` | QX server_local 行 | Quantumult X(iOS) | vless / anytls / trojan / vmess / ss |
| `/loon` | Loon conf | Loon(iOS) | 同上 |

**Surge 要特别注意**:Surge 本身的代理类型里就没有 vless 和 anytls,这不是转换器偷懒。
美国节点池里 vless 通常占大头,所以 Surge 那条链接的节点数会明显少于其他格式。
后台的链接列表里每条都会显示"这条链接实际有几个节点 / 池子共几个",一眼能看出差距。

`/v2box` 和 `/v2rayn` 摘掉 anytls 是因为这两个客户端对它的支持不稳定(V2Box 底层
Xray-core 根本不支持)。想要全协议的 base64 就用 `/base64`。

## 四、当前生效参数

| 参数 | 值 | 说明 |
|---|---|---|
| 测速批次 | 6:00 / 10:30 / 14:30 / 19:00 | 由操作系统调度器触发(launchd / systemd timer / 计划任务) |
| 测的协议 | vless / anytls / trojan | |
| 地区 | **只要美国** | 节点名国家码粗筛 + 本地 GeoIP 库核实真实 IP,严格模式下"验证不了"也丢弃 |
| 数量上限 | `MAX_NODES=100` | 上限不是目标;按协议轮转取,某协议取完名额自动让给别的协议 |
| CL(Claude解锁)标签 | 排序优先级,不是硬过滤 | 曾经当硬门槛,一次 media-check 抖动把节点清零过 |
| 最低速度 | 128 KB/s | |
| 安全兜底 | 可用节点 < `MIN_KEEP=10` 则不推送 | 保留 Deno 端上次的好节点,防止推空导致全家断网 |
| 归档垫底 | **只在跌破 `MIN_KEEP` 时**补到下限 | 应急下限,不是用来凑满 100 的填充物 |
| 三振出局窗口 | 连续 3 轮未出现 → 移出强制重测名单 | 1~2 轮内的会被真的拉回去重测 |
| GeoIP 库 | sapics/ip-location-db(server-country) | PDDL,不用注册/不用 key,默认 7 天刷新一次 |
| Deno 数量上限 | `NODE_CAP=100` | 与本地端 `MAX_NODES` 一致,防御性的第二道闸 |

时间戳标记节点(名字形如"🇺🇸US 更新于 2026-08-24 14:30",指向 127.0.0.1 连不通)不计入
数量上限,也不会被截断——它的作用只是让家人在客户端节点列表末尾一眼看出这批节点是
什么时候推的。Surge / QX / Loon 这三种格式表达不了这么个假节点,改成写在文件头的注释里。

## 五、2026-08 这次大改动了什么

**本地端**
- 从"只能在 macOS 上跑"改成 macOS / Ubuntu / Windows 通用。写死的
  `/opt/local/bin/python3.12`、`~/nodepipe`、launchctl 全部去掉。
- `gen_config.sh` / `force_retest.sh` / `archive_sub.sh` → 对应的 `.py`。
- subs-check 不再需要常驻守护进程:每次跑一轮就退出,调度完全交给操作系统。
  它原来兼任的"重测名单文件服务"由 `run_once.py` 起的十几行只读文件服务接管。
- 地区从"美>欧>亚排序偏好"改成"只要美国,GeoIP 严格核实"。
- 数量从"vless桶30 + other桶30 再砍到50"改成"按协议轮转,上限100"。
- 归档垫底从"填满到上限"改成"只在跌破安全线时补到下限"。

**Deno 端**
- 新增 Surge / Quantumult X / Loon 三种格式;设备默认格式从 base64 改成 **clash**。
- 新建 `formats.ts` 统一登记表。以前"哪个后缀走哪种格式""过滤哪些协议""后台显示几个
  节点"分散在 `subscribe.ts` 和 `ui.ts` 各写一份,很容易对不上;现在全部一处收口,
  后台显示的节点数跟订阅出口用的是同一张表。
- 后台链接列表现在会标注每种格式**支持哪些客户端**,以及这条链接**实际**能给到多少
  个节点(比如 `4 / 100 个节点`)。
- 删掉隐藏的 `/us`「美国节点组」整条链路(`/push-us`、KV 的 `us_nodes`、设备的
  `usEnabled` 开关、`us_archive.py`)——主池现在本来就全是美国节点,这条是纯重复。
- 修好 sing-box 配置的三个问题,详见下节。

## 六、sing-box 配置修了什么

用 sing-box 1.13.0 官方二进制实测验证过。

1. **配置直接起不来(FATAL)**。DNS 里的 DoH 服务器写了 `detour: "proxy"`,但
   `outbounds` 里根本没有 tag 叫 `proxy` 的出站(只有 `select` / `auto` / `direct` 和
   各节点名)。实测报错:

   ```
   FATAL start service: start dns/https[remote]: outbound detour not found: proxy
   ```

   注意 `sing-box check` **查不出这个问题**(它只校验 schema,不解析出站引用),只有
   真正 `sing-box run` 才会暴露。现在指向真实存在的 `select`。

2. **两条 DNS 规则完全没生效**。用的是 `domain: ["geosite:cn"]` 这种写法,`geosite:`
   前缀语法 1.8 就废弃、1.12 已彻底移除。写在 `domain` 字段里不报错,但会被当成一个
   **字面域名** "geosite:cn" 去精确匹配,永远匹配不上——两条规则等于没写,所有 DNS
   查询都掉到 `final: "local"`,也就是明文发给 223.5.5.5。现在换成自包含的
   `domain_suffix` 规则,并把 `final` 改成走代理里的 DoH。

   (没有改用远程 rule-set,是因为那会多出一个"首次启动要联网下载规则集"的失败点。
   对"发给家人直接用"的订阅来说,自包含更划算。)

3. **DoH 服务器缺 `domain_resolver`**。`server` 写的是域名 `dns.google`,按 1.12 的新
   DNS 格式必须有 `domain_resolver` 才能解析它自己(1.14 起是硬性要求)。现在显式指到
   `local`,不会形成"要查 dns.google 得先查 dns.google"的死循环。

顺带开了 `experimental.cache_file`,urltest 的测速结果和 selector 选中的节点会存盘,
客户端重启后不用从头再测一遍。

## 七、已知限制

- 归档池里的节点被当"应急下限"推送时**没有在当次重新验证**,只是最后已知可用的 URI。
  批次标签里会带 `⚠含归档节点`。
- `run_once.py` 假设 `subs-check -f config.yaml` 跑完一轮就退出。生成的 config 已经不写
  `check-interval` / `cron-expression` 也关了 web-ui,正常没有理由常驻;万一某个版本行为
  不同,`RUN_TIMEOUT`(默认 40 分钟)会兜住。**第一次装完请手动跑一次确认它会正常结束。**
- GeoIP 只有 IPv4 库,纯 IPv6 节点会落到"无法核实"分支,严格模式下被丢弃。
- Surge / QX / Loon 的配置语法是照着 [Sub-Store](https://github.com/sub-store-org/Sub-Store)
  的 producer 实现核对的(那是这几种格式事实上的参考实现),但没有在真机客户端上逐个
  验证过。clash 和 sing-box 两种格式是用真实解析器实测验证过的。

# nodepipe — 家庭代理订阅自动化管道

本地机器定时测活/测速代理节点 → 挑出**美国节点** → 推送到 Deno Deploy → 家人/朋友设备拉取订阅。

本地端(`nodepipe/`)在 **macOS / Ubuntu / Windows** 上都能跑,同一份 Python 代码。

## 一、整体架构

```
[上游订阅源 x N]            [免费节点源 x N]
      │  (SUB_URL)                │  Deno.cron 每 6 小时抓一轮(free/)
      │                           ▼
      │                    [Deno: 免费池 → Neon]  ← 解析/去重/限流,节点名打上 FREE 前缀
      │                           │  GET /free/pool
      │                           ▼
      │                    [free_pool.py]  ← 拉到本地,当成一个普通订阅源
      ▼                           ▼
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
  push_now.py             一键入口:从本地 Clash 挑好节点推给 Deno(不需要 subs-check)
  install_launcher.py     在桌面生成"双击就推送"的入口,三平台各一种
  clash_source.py         数据源:本地 Clash Verge Rev 的节点 + 实测延迟/测速/Claude
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
python3 push_now.py --fast     # 只测延迟,十几秒
python3 push_now.py --claude   # 延迟 + Claude 解锁检测
python3 push_now.py --full     # 延迟 + 测速 + Claude,几分钟
python3 install_launcher.py    # 在桌面生成双击入口,以后点一下就推
```

**这条路不需要 subs-check**,也不需要定时任务——节点直接来自你 Clash 里已加载的订阅,
好不好用在这里实测。想彻底不用 Mac 那套东西的话,用这个就够了。

两条路只在"从哪儿拿候选 + 怎么判断好不好用"这一步不同,后面的美国核实、轮转选点、
上限、三层兜底、推送全部共用同一份代码。

⚠️ **Clash 自己不产生速度数据** —— mihomo 的 API 只有 `/delay`(延迟),没有测速端点;
Clash Verge Rev 界面上那些"速度"是连接列表的实时流量显示,不是逐节点测速。所以按速度筛
只能由脚本驱动内核实测(切 global 模式 → 逐个切节点下载 → 还原),串行、几分钟,
期间本机出口节点会跟着变。默认是关的。细节见 [nodepipe/README.md](nodepipe/README.md#另一条数据源直接用本地-clash-verge-rev-的节点)。

## 三、自定义客户端(rClash)

**rClash 已经搬到独立仓库:[zhourg2010/rClash](https://github.com/zhourg2010/rClash)**
(2026-08-27,用 `git subtree split` 抽出去的,历史都在)。本仓库里原来的 `client/` 目录和
`.github/workflows/build-client.yml` 都已删除 —— 想翻旧代码的话,`git log -- client/` 还在。

它是 [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) v2.5.4 的源码副本,
加了一个**「一键推送美国节点到 Deno」按钮**,位置就在代理页测延迟按钮旁边。用法:先点测延迟
→ 再点上传图标(第一次会弹设置,填 `/push` 地址和 `PUSH_KEY`;之后单击即推,右键改设置)。
**有了它就不再需要本地端那套 subs-check 流程** —— 测速、筛选、推送全在客户端里完成,
换电脑只要装这个包。

分出去的理由很实际:它是个 33MB 的 Tauri + Rust 项目,跟这边的 Deno 订阅服务在语言、
工具链、构建时长(几十分钟 vs 几十秒)上没有一点重合,挤在一个仓库里只会互相添乱 ——
`deno.json` 要专门 exclude 它,`check-deno.yml` 要专门排除它的路径,而它自己的构建又要
到处写 `client/` 前缀。而且它是 GPL-3.0-only,跟本仓库其余部分许可证不同,分开也更清楚。

## 四、Deno 端

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
free/                   **免费节点池**(定期抓公开免费节点,见第九节)
routes/free.ts          免费池的后台面板 + 给本地端拉候选的接口
```

### 支持的格式和对应客户端

订阅链接是 `/l/{用户名}/{id}`,后面加后缀切换格式。不加后缀走设备在后台设置的默认格式
(**新建设备默认是 clash**)。

| 后缀 | 格式 | 支持的客户端 | 能表达的协议 |
|---|---|---|---|
| *(不加)* | 设备默认格式 | — | 取决于所选格式 |
| `/clash` | Clash / mihomo YAML | OpenClash、mihomo(Clash.Meta)、Clash Verge Rev、ClashX Meta、Stash、FlClash | vless / anytls / trojan / vmess / ss |
| `/singbox` | sing-box JSON | sing-box、SFI / SFM(iOS/macOS)、**Karing**、Hiddify | 同上 |
| `/base64` | base64 标准订阅 | v2rayN、Shadowrocket、NekoBox、**Karing**、Hiddify 等 | 同上 |
| `/surge` | Surge 5 conf | Surge 5(macOS / iOS) | **仅** trojan / vmess / ss |
| `/quanx` | QX server_local 行 | Quantumult X(iOS) | vless / anytls / trojan / vmess / ss |
| `/loon` | Loon conf | Loon(iOS) | 同上 |

后台的链接列表按**格式**列,一种格式一条。下面这三条依然有效(已经发出去的旧链接不会失效),
只是不再单独占一行:

| 后缀 | 说明 |
|---|---|
| `/v2box` | base64 去掉 anytls。**V2Box 必须用这条**,它不支持 anytls。后台里挂在 `/base64` 那一行下面 |
| `/openclash` | 输出与 `/clash` 完全一致的别名 |
| `/v2rayn` | 输出与 `/base64` 完全一致的别名 |

**Karing 用哪条**:它是 sing-box 内核的客户端,虽然也能读 clash 订阅,但官方说明写的是
"完全支持 `clash` 配置,**部分支持** `clash.meta` 配置"——我们的 clash 输出用了
anytls / reality / client-fingerprint 这些 meta 特性,所以推荐给它 `/singbox`,
`/base64` 也可以。

**Surge 要特别注意**:Surge 本身的代理类型里就没有 vless 和 anytls,这不是转换器偷懒。
美国节点池里 vless 通常占大头,所以 Surge 那条链接的节点数会明显少于其他格式。
后台的链接列表里每条都会显示"这条链接实际有几个节点 / 池子共几个",一眼能看出差距。

**关于 anytls 的两条后缀**(2026-08 重新核实过,之前代码里的说法是错的):

- **`/v2rayn` 给全协议 —— v2rayN 支持 anytls。** 它带多个内核并按节点绑定:遇到 anytls
  自动切到自带的 sing-box 去跑。源码依据(`2dust/v2rayN`):`EConfigType.cs` 里有
  `Anytls = 11` 一等公民枚举,`AnytlsFmt.cs` 是完整的分享链接解析实现,`FmtHandler.cs`
  在订阅导入时按 scheme 分发给它,`ConfigHandler.AddAnytlsServer()` 里写死
  `CoreType = ECoreType.sing_box`。以前这条链接摘掉 anytls,是白白少推节点。
- **`/v2box` 摘掉 anytls —— V2Box 不支持**(实测确认)。这里**必须**摘:V2Box 解析不了的
  行会让整份订阅导入失败,不是只丢那一条。

⚠️ 别把这两条搞混:两个客户端都用 Xray-core,而 Xray-core 本身确实完全不支持 anytls
(`XTLS/Xray-core` 的 `proxy/` 目录下没这个协议,全仓库 grep 零命中)。区别在于 v2rayN
**同时带 sing-box 并按节点切内核**,V2Box 没有。所以"底层是 Xray"推不出"不支持 anytls",
得看那个客户端是不是多内核。

想要全协议的 base64 也可以直接用 `/base64`。

## 五、当前生效参数

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

## 六、免费节点池(`free/`)

除了自己付费机场的节点,还会**定期**从公开的免费节点仓库抓一批候选进来。这些节点名字统一
带 `FREE | ` 前导词,在客户端列表里跟自己的节点一眼分得开。

### 跑在哪儿、多久跑一次

抓取跑在 **Deno 端**,由 `Deno.cron` 调度,不依赖本机开着:

| 任务 | 时间(UTC) | 做什么 |
|---|---|---|
| `harvest-free-nodes` | 每 6 小时 | 抓一轮:拉取 → 解析 → 转 URI → 去重限流 → 落库 |
| `prune-free-nodes` | 每天 04:30 | 清掉 30 天没再出现过的节点 |

后台 `{ADMIN_PATH}/free` 有面板,能看池子现状、各源战报,也能手动补跑一轮。

免费源每天都在变,今天抓到的明天大半就死了,所以真正有价值的是**那条时间线**:
`free_node.seen_count` 记录一个节点在历次抓取里出现过多少次,连着十几轮都还在的,
说明背后的机器是长期在跑的。只跑一次拿到的是一张快照,跑久了才有稳定性信号。

### 存在哪儿:为什么不是 SQLite

服务跑在 Deno Deploy 上,**没有可持久化的文件系统** —— isolate 无状态,冷启动换机器,
写到本地的 `.db` 文件下一次请求就不见了。所以"服务器端的 SQLite 文件"在当前部署形态下
存不住。这里用的是 **Neon Postgres**,连接串跟访问日志归档共用同一个 `DATABASE_URL`,
不用新开任何基础设施。(本地那份 SQLite `nodepipe/node_cache.py` 保持不动,它记的是另一
件事——节点在历次**推送**里的出现次数。)

没配 `DATABASE_URL` 时整个模块降级成"不落库",不影响订阅主链路。

### 去重:这一步决定了池子有没有用

抓下来的原始数量非常唬人,但重复度极高。实测一轮的数字:

```
可用节点          8330 条
不同 endpoint     2268 个
不同 credential   1439 套   ← 真正不同的"服务"只有这么多
```

其中**一套**凭据(某个 Cloudflare 前置的 vmess)自己就占了 4000 条 —— 同一个 uuid、
同一个 Host,套在四千个 CF 边缘 IP 上。CF 边缘是任播的,连哪个都落到同一台后端机器。
按 `type:server:port` 去重的话这 4000 条**一条都去不掉**,整个池子会被一个源的扇出淹没。

所以按两个维度算身份(`free/identity.ts`),并在入库时限流:

| 闸门 | 值 | 为什么 |
|---|---|---|
| `PER_CRED_CAP` | 3 | 同一套凭据最多留 3 条。不同入口 IP 速度确实有差别,留几个备选有意义,留一千个没有 |
| `PER_SOURCE_CAP` | 2000 | 限了凭据之后,聚合源 Sub-Config-Extractor 一家仍占整池 89%,得再限一层 |

限流后一轮稳定在 4000 条左右,来源分布健康。

### 协议范围

只收 `formats.ts` 里 `Proto` 已定义、下游每个渲染器都认的那五个:
**vless / trojan / vmess / ss / anytls**。

免费源里还有不少 hysteria2 / tuic / hysteria / http,**故意没收**:要让它们一路走到客户端,
得先把 `Proto` 联合类型、五个渲染器、`protocol-filter` 全部拓宽,那是另一件事。
丢弃数量按协议记在每轮战报里,想加的时候一眼能看到值不值得(实测 hysteria2 是丢得最多的)。

### 活性谁来测

**池子里的节点都没实测过。** Deno Deploy 上没有代理内核,拨不了这些节点,活性、速度、
以及那道严格的美国 GeoIP 核实,它一样都判断不了。这些活儿在本地端:

```
run_once.py
  └─ free_pool.py          从 /free/pool 拉候选,写成 RETEST_DIR/free_pool.txt
  └─ subs-check            把它当成一个普通订阅源测(跟"三振出局重测名单"同一套机制)
       └─ select_and_push.py   测活/测速/GeoIP 之后,活下来的才推给 Deno
```

走 subs-check 这条已经在跑的路,而不是另起一套测试逻辑。免费池拉失败不中断主流程 ——
它是锦上添花,自己机场那条链路不该被它拖累(`FREE_POOL=0` 可整个关掉)。

### 加源

只动 `free/sources.ts`。三种类型:

- `clash` — URL 直接返回 Clash 配置
- `base64` — URL 返回整段 base64 的分享链接列表
- `index` — URL 返回的是**索引页**(README / HTML),先抓索引再用 `pick` 正则挑出子文件

每个源有 `verified` 标记,区分"我实际抓通并解析成功过"和"代码路径写好了但没跑过真实响应"
—— 排障时这两种情况的意义完全不同。

## 七、2026-08 这次大改动了什么

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

## 八、sing-box 配置修了什么

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

## 九、已知限制

- 归档池里的节点被当"应急下限"推送时**没有在当次重新验证**,只是最后已知可用的 URI。
  批次标签里会带 `⚠含归档节点`。
- `run_once.py` 假设 `subs-check -f config.yaml` 跑完一轮就退出。生成的 config 已经不写
  `check-interval` / `cron-expression` 也关了 web-ui,正常没有理由常驻;万一某个版本行为
  不同,`RUN_TIMEOUT`(默认 40 分钟)会兜住。**第一次装完请手动跑一次确认它会正常结束。**
- GeoIP 只有 IPv4 库,纯 IPv6 节点会落到"无法核实"分支,严格模式下被丢弃。
- Surge / QX / Loon 的配置语法是照着 [Sub-Store](https://github.com/sub-store-org/Sub-Store)
  的 producer 实现核对的(那是这几种格式事实上的参考实现),但没有在真机客户端上逐个
  验证过。clash 和 sing-box 两种格式是用真实解析器实测验证过的。

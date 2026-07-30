# nodepipe — 家庭代理订阅自动化管道

Mac mini 定时测活/测速代理节点 → 挑选打包 → 推送到 Deno Deploy → 家人/朋友设备拉取订阅。

## 一、整体架构

```
[上游订阅源 x N]
      │  (sub-urls, 逗号分隔多个)
      ▼
[Mac mini: subs-check]  ← 测活 + 测速 + Claude解锁检测(media-check) + 重命名(国家/CL标签)
      │  output/all.yaml
      ▼
[select_and_push.py]    ← 两桶配额选节点(CL优先→地区优先) + 三振出局历史追踪 + 总量上限
      │  POST /push (base64)
      ▼
[Deno Deploy]           ← 存节点池,按"默认链接"或"客户端标签链接"分别截断数量、转换格式
      │
      ▼
[家人设备]  sing-box / OpenClash / V2Box / v2rayN
```

## 二、Mac mini 端目录结构

```
~/nodepipe/
  env                     ← 真实密钥/参数(不进git),从 env.example 复制改写
  env.example              ← 模板
  gen_config.sh             ← 读 env,生成 subs-check 的 config.yaml
  select_and_push.py        ← 核心逻辑:选节点、三振出局历史、推送
  select_and_push.sh         ← subs-check 的 callback-script,负责导出环境变量后调用上面的 python
  force_retest.sh            ← 强制立即测活+推送一次(停daemon→前台跑一次→重启daemon)
  bin/
    subs-check               ← 测速程序本体
    config.yaml               ← 由 gen_config.sh 生成,不要手改(会被覆盖)
    output/
      all.yaml                 ← 本轮测速结果
      recent_history.txt        ← 三振出局机制:"最近还活过"的节点,当一个额外订阅源喂回去重测
  state/
    last_good.json             ← 按桶(vless/other)的最近一次成功结果缓存
    node_history.json           ← 每个节点(协议:IP:端口)的最近存活/缺席记录("三振出局"用)
  logs/
    push.log                   ← 每次选节点+推送的详细记录
    history.csv                 ← 每次结果摘要(可用数/命中地区/协议分布,趋势速查)
    force_retest.log             ← 强制重测脚本的运行记录

~/Library/LaunchAgents/
  com.nodepipe.subscheck.plist     ← subs-check 常驻进程(KeepAlive,开机自启)
  com.nodepipe.forceretest.plist    ← 4个定点任务(6:00/10:30/14:30/19:00),各自触发 force_retest.sh
```

## 三、Deno 端(examples-hello-world 仓库)关键文件

```
main.ts                  ← 路由分派
routes/subscribe.ts       ← 订阅出口:/l/{user}/{id}[/{clientTag}]
protocol-filter.ts         ← 按协议前缀过滤 + 按订阅类型截断节点数量上限
singbox.ts / clash.ts       ← 转换成 sing-box JSON / Clash YAML
kv.ts                       ← 设备/节点池存储(Deno KV)
ui.ts / tools_ui.ts          ← 管理后台页面
```

**链接类型说明**:
- **默认链接**(不带标签,如 `/l/张三/abcd1234`):走设备后台设置的格式(base64/singbox/clash),节点数量上限 **50**。
- **客户端标签链接**(如 `/l/张三/abcd1234/v2box`):
  - `singbox`、`clash`/`openclash` — 全协议(vless+anytls+trojan),数量上限 **30**
  - `v2box`、`v2rayn` — 只保留 vless+trojan(这两个客户端不支持/不稳定支持 anytls),数量上限 **30**

时间戳标记节点(名字形如"更新于 2026-07-30 14:30",指向 127.0.0.1 连不通)不计入以上任何数量上限，也不会被截断掉——它的作用只是让家人在客户端节点列表末尾一眼看出这批节点是什么时候推的。

## 四、当前生效参数

| 参数 | 值 | 说明 |
|---|---|---|
| 测速批次 | 6:00 / 10:30 / 14:30 / 19:00 | 由 launchd 的 `com.nodepipe.forceretest.plist` 触发,不再用 subs-check 自带的 cron-expression(它写不出"部分整点部分30分"的混合模式) |
| 兜底调度 | check-interval: 1440分钟(24小时) | 万一 launchd 失效时的最后保险,不是主力调度 |
| 测的协议 | vless / anytls / trojan | |
| CL(Claude解锁)标签 | 仅作排序优先级,不再是硬过滤 | 之前把 `filter: "CL-"` 当硬性门槛,一次 media-check 抖动就把节点清零过,现改成能解锁 Claude 的节点在同协议桶内排最前 |
| 最低速度 | 128 KB/s | |
| Mac mini 选节点配额 | vless桶≤30、other(anytls+trojan)桶≤30,合计再砍到 GENERAL_CAP=50 | 两桶各自按"CL优先→地区优先(美>欧>亚)"排序截取,互不补齐 |
| 安全兜底(全局) | 可用节点 < MIN_KEEP=10 则不推送 | 保留 Deno 端上次的好节点 |
| 每桶三层兜底 | ①本轮新鲜结果 → ②last_good.json 缓存(桶整体为空时) → ③三振出局归档池(桶数量不够时垫底,未经本轮重新验证) | |
| 三振出局窗口 | 连续3轮未出现 → 移出强制重测名单,转入归档 | 归档节点仍保留最后已知 URI,只在真的凑不够数时才会被拿出来当候选 |
| 历史保活(subs-check自带) | keep-days: 28 | 与三振出局机制并存,是两层不同粒度的历史保留 |
| 永久排除 | 香港 HK、澳门 MO(国家码 + 中英文关键词双重兜底) | |
| Deno 默认链接上限 | 50 | 与 Mac mini 的 GENERAL_CAP 一致,属防御性重复校验 |
| Deno 标签链接上限 | 每条 30 | singbox/clash/openclash/v2box/v2rayn 各自独立截断 |

## 五、日常操作速查

### 换/加订阅源
```bash
nano ~/nodepipe/env          # SUB_URL 用逗号分隔多个: "https://a,https://b"
~/nodepipe/gen_config.sh full
launchctl unload ~/Library/LaunchAgents/com.nodepipe.subscheck.plist
launchctl load ~/Library/LaunchAgents/com.nodepipe.subscheck.plist
```

### 手动立即测活+推送一次(不用等定点批次)
```bash
bash ~/nodepipe/force_retest.sh
tail -60 ~/nodepipe/logs/force_retest.log
```

### 看运行状态
```bash
launchctl list | grep nodepipe                    # 两个 launchd job 都在不在
tail -30 ~/nodepipe/logs/push.log                   # 最近一次选节点+推送详情
cat ~/nodepipe/logs/history.csv                      # 历史趋势(可用数/协议分布)
cat ~/nodepipe/state/node_history.json | python3 -m json.tool   # 每个节点的存活/缺席记录
```

### 一次性不设配额上限地全量推送(临时需求,不改 env)
```bash
PICK_VLESS=9999 PICK_OTHER=9999 GENERAL_CAP=9999 bash ~/nodepipe/select_and_push.sh
```

### 临时停 / 恢复自动化
```bash
launchctl unload ~/Library/LaunchAgents/com.nodepipe.subscheck.plist
launchctl unload ~/Library/LaunchAgents/com.nodepipe.forceretest.plist
# 恢复就把 unload 换成 load
```

## 六、已知限制 / 后续可优化方向

- 三振出局归档池里的节点被当"垫底候选"推送时,**没有在当次重新验证**,只是最后已知可用的 URI——用它兜底总比完全没有强,但不是百分百保证能连通。
- `recent_history.txt` 依赖 subs-check 自己的 8199 端口文件服务对外提供;如果哪天关闭了 `enable-web-ui` 或换了 `listen-port`,这个重测通道会失效,需要同步检查。
- Deno 端目前存在过不同步的历史版本(不同时间点上传的 zip 内容不一致),合并代码前建议先确认线上实际部署的是哪个版本,避免在旧版本上重复叠加改动。
- launchd 相关操作不要加 `sudo`——`~/Library/LaunchAgents/` 是用户级 agent,加 sudo 会导致 launchctl 去错误的域找文件。

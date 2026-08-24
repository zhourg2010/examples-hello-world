# nodepipe 本地端 — macOS / Ubuntu / Windows 通用

测活测速 → 挑出**美国节点** → 推送到 Deno。三个平台跑的是同一份 Python 代码,
只有"定时任务怎么装"这一步各平台不同,而且已经由 `install_scheduler.py` 抹平了。

## 依赖

- Python 3.9+
- PyYAML
  - macOS: `pip3 install pyyaml`(MacPorts 用户也可以 `sudo port install py312-yaml`)
  - Ubuntu: `sudo apt install python3-yaml` 或 `pip3 install pyyaml`
  - Windows: `py -m pip install pyyaml`
- [subs-check](https://github.com/beck-8/subs-check) 可执行文件

## 目录结构

工作目录默认是 `~/nodepipe`(Windows 上是 `C:\Users\你\nodepipe`),
想放别处就设环境变量 `NODEPIPE_HOME`。

```
<NODEPIPE_HOME>/
  env                          ← 真实密钥/参数(不进 git),从 env.example 复制改写
  bin/
    subs-check                 ← 测速程序本体(Windows 上是 subs-check.exe)
    config.yaml                ← 由 gen_config.py 生成,不要手改
    callback.sh / callback.cmd ← 由 gen_config.py 生成的回调包装,不要手改
    output/all.yaml            ← 本轮测速结果
  state/
    node_history.json          ← 每个节点的存活/缺席记录("三振出局"用)
    node_cache.db              ← 每个节点的累计出现次数(排序时当"稳定性"用)
    last_good.json             ← 最近一次成功推送的节点,应急兜底
    geoip/                     ← 本地 GeoIP 库(判断节点服务器是否真在美国)
    retest/recent_history.txt  ← 下一轮要强制重测的节点清单
  logs/
    push.log run_once.log gen_config.log geoip.log archive.log history.csv
```

代码本身可以放在任何地方(比如就在这个 git 仓库里),不必跟 `NODEPIPE_HOME` 在一起。

## 装起来(三个平台都一样的部分)

```bash
# 1. 建工作目录,把 subs-check 放进 bin/
mkdir -p ~/nodepipe/bin
#    然后把 subs-check 可执行文件拷到 ~/nodepipe/bin/

# 2. 配置
cp env.example ~/nodepipe/env
#    编辑 ~/nodepipe/env,至少填 SUB_URL / PUSH_URL / PUSH_KEY

# 3. 生成 subs-check 配置(必须用 full 模式,见下方说明)
python3 gen_config.py full

# 4. 手动跑一轮,确认整条链路通
python3 run_once.py
tail -50 ~/nodepipe/logs/push.log

# 5. 装定时任务(每天 6:00 / 10:30 / 14:30 / 19:00)
python3 install_scheduler.py install
python3 install_scheduler.py status
```

Windows 上把 `python3` 换成 `py`。

### 为什么必须是 `full` 模式

只有 `full` 会开 `rename-node`,让 subs-check 给节点名加上国家码前缀(`US_24`、`JP_5`)。
`select_and_push.py` 的**第一层**美国粗筛依赖这个前缀。没有它的话,所有节点都会在
第一层就被判成"标签非US"而全部丢弃。

## 定时任务装到哪了

| 平台 | 机制 | 位置 |
|---|---|---|
| macOS | launchd | `~/Library/LaunchAgents/com.nodepipe.runonce.plist` |
| Ubuntu | systemd user timer | `~/.config/systemd/user/nodepipe.{service,timer}` |
| Windows | 计划任务 | 任务名 `nodepipe` |

模板在 `scheduler/<平台>/` 下,里面的 `__PYTHON__` / `__RUN_ONCE__` / `__HOME__` /
`__LOGS__` 占位符由 `install_scheduler.py` 在安装时替换成真实绝对路径——所以模板本身
不含任何跟某台机器绑定的路径,可以放心进 git。

**macOS 注意**:`launchctl` 操作 `~/Library/LaunchAgents/` 下的用户级 agent
**不要加 sudo**,加了会让它去 root 的域里找文件,报莫名其妙的错。

**Ubuntu 注意**:systemd user unit 默认只在用户登录期间存活。常开的无人值守小主机
需要开 lingering,否则注销之后定时任务就不跑了:

```bash
sudo loginctl enable-linger $USER
```

`install_scheduler.py install` 会检查这一项并在没开时提醒你。

## 推送逻辑

### 只要美国节点,严格判定

两层:

1. subs-check 的 iprisk 检测在节点名里打的国家码前缀 —— 便宜,先粗筛一遍。
2. 本地 GeoIP 库对节点服务器的**真实 IP** 做权威核实。

严格模式(默认 `GEOIP_STRICT=1`)下,第二层查不出 `US` 就一律不要,**包括"库里没有
这个 IP 段"的情况**——在"只要美国节点"这个前提下,"验证不了"和"验证不通过"应该同等
对待。实测里这一层确实拦下过"标签写着 US、GeoIP 查出来在加拿大"的节点。

GeoIP 库整个不可用时(第一次跑就下载失败、本地也没有任何缓存副本),**这一轮不推送**,
保住 Deno 上一批好节点。宁可这一轮不更新,也不能把一池子没核实过国家的节点发给家人。
急用的话可以临时 `GEOIP_STRICT=0` 降级成只信节点名标签,不建议常开。

GeoIP 数据来自 [sapics/ip-location-db](https://github.com/sapics/ip-location-db) 的
server-country 库(PDDL 协议,不用注册/不用 key),默认每 7 天自动刷新一次。

### 上限 100,按协议轮转取

`MAX_NODES=100` 是**上限不是目标**。各协议(vless / trojan / anytls)各自排好序后
一人一个交替拿,拿满 100 为止。某个协议先取完了,剩下的名额自动让给还有货的协议。

比"每协议固定配额"好在两点:
- anytls 只有 3 个的时候,配额制下剩下的名额是白白浪费的,轮转制会自动让出去。
- 轮转天然保证各协议都有代表,不会出现"Deno 那边 v2rayN 链接把 anytls 过滤掉之后
  一个节点都不剩"的情况。

桶内排序:能解锁 Claude 的(`CL-` 标签)优先 → 历史出现次数多的(更稳定)优先。

### 三层兜底

| 层 | 触发条件 | 说明 |
|---|---|---|
| 本轮新鲜结果 | 正常情况 | 测活测速都通过 + GeoIP 确认美国 |
| `last_good.json` 缓存 | 本轮一个 URI 都没构造出来 | 上一次成功推送的那批 |
| 三振出局归档池 | 数量跌破 `MIN_KEEP` | **应急下限,不是填充物**——只补到 `MIN_KEEP` 为止,不会为了凑满 100 而塞进几十个未验证的旧节点 |

再往下还有最后一道:凑完还是不到 `MIN_KEEP`(默认 10)就**跳过推送**,保留 Deno 上
一批,防止推空导致全家断网。

### 三振出局与重测通道

- 本轮出现的节点 → 缺席计数归零。
- 连续 1~2 轮没出现 → 写进 `state/retest/recent_history.txt`,下一轮由本地文件服务
  喂回给 subs-check 当订阅源,**真的拉去重测**,而不是凭旧缓存假设它还活着。
- 连续 3 轮没出现 → 移出重测名单,转入被动归档池(只在跌破 `MIN_KEEP` 时才被拿出来)。

这个本地文件服务由 `run_once.py` 临时起在 `127.0.0.1:8299`(只监听 127.0.0.1,
因为目录里是含密码/UUID 的节点 URI,绝对不能对局域网可见),跑完就关。

## 跟旧版(纯 macOS 版)相比变了什么

| | 旧 | 新 |
|---|---|---|
| 平台 | 只有 macOS | macOS / Ubuntu / Windows |
| 解释器 | 写死 `/opt/local/bin/python3.12` | `sys.executable`,你用哪个 python 起的就用哪个 |
| 目录 | 写死 `~/nodepipe` | 默认同前,可用 `NODEPIPE_HOME` 整体搬家 |
| 流程脚本 | `gen_config.sh` / `force_retest.sh` / `archive_sub.sh`(bash) | `gen_config.py` / `run_once.py` / `archive_sub.py` |
| subs-check | 常驻守护进程 + 自带定时 + launchd 再踢一脚(三重调度叠加) | 每次跑一轮就退出,调度完全交给操作系统 |
| 重测通道 | 靠 subs-check 自带的 8199 web-ui 提供文件(要求它常驻) | `run_once.py` 起的十几行只读文件服务 |
| 地区 | 美>欧>亚 排序偏好,非美国节点仍会被推 | 只要美国,GeoIP 严格核实 |
| 数量 | vless 桶 30 + other 桶 30,再砍到 50 | 按协议轮转,上限 100 |
| `/us` 独立链路 | `us_archive.py` + `/push-us` + 隐藏的 `/us` 链接 | 整条删掉(主池本来就全是美国节点了) |

## 另一条数据源:直接用本地 Clash Verge Rev 的节点

平时定时任务走的是 subs-check。但你也可以把**本地 Clash Verge Rev 里当下实测延迟达标**的
节点直接推出去,不用等下一轮测速:

```bash
SOURCE=clash python3 select_and_push.py
```

后面的美国核实、轮转选点、上限、三层兜底、推送全部跟 subs-check 那条路共用同一份代码,
只有"从哪儿拿候选 + 怎么判断好不好用"这一步不同。

### 它是怎么工作的

Clash 的 REST API **只给节点名和延迟,不给完整连接参数**(server/port/uuid/password 一个
都没有),光靠 API 重建不出分享链接。所以要两边都读:

1. `clash-verge.yaml`(Clash Verge Rev 数据目录下的运行时合并配置)—— mihomo 内核当前
   真正加载的那份,`proxies:` 里有完整参数,而且结构跟 subs-check 的 all.yaml 完全一样,
   所以解析层一行都不用改。
2. Clash API 的 `/proxies/{name}/delay` —— 实测延迟,按节点名跟上面那份对应起来。

顺序上是**先做美国核实,再测延迟**——一池子几百个节点里可能只有几十个是美国的,
没必要对其余的也各测一次 API。

### 连接方式

Clash Verge Rev 的 `enable_external_controller` **默认是关的**,也就是说默认情况下 mihomo
根本没在监听 HTTP 端口,只开了 unix socket(macOS/Linux)或命名管道(Windows)。

所以这里**优先走 unix socket**,macOS 和 Ubuntu 上你什么设置都不用改就能连上。
TCP 是备选(默认 `127.0.0.1:9097` —— 注意不是常见的 9090,Clash Verge Rev 用的是 9097)。

Windows 上命名管道走不了 Python 标准库的 HTTP,需要你在
**设置 → Clash 内核 → 外部控制器** 里打开走 TCP;脚本连不上时会明确提示这一点。

### 相关环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SOURCE` | `subscheck` | 设成 `clash` 走这条路 |
| `CLASH_MAX_DELAY` | `800` | 延迟阈值(毫秒),超过的不要 |
| `CLASH_TEST_URL` | `http://www.gstatic.com/generate_204` | 测延迟用的地址 |
| `CLASH_TEST_TIMEOUT` | `5000` | 单个节点测延迟的超时(毫秒) |
| `CLASH_CONCURRENCY` | `16` | 同时测几个 |
| `CLASH_HOME` | 按平台自动找 | Clash Verge Rev 数据目录,装在别处时用 |
| `CLASH_PROFILE` | `<CLASH_HOME>/clash-verge.yaml` | 直接指定含 proxies 的 YAML |
| `CLASH_API` / `CLASH_SECRET` | 从 `config.yaml` 读 | 手动指定控制器和密钥 |

排序也会跟着变:这条路上每个节点都带着刚测出来的延迟,桶内排序就用延迟
(比"历史出现次数"更能反映当下好不好用);subs-check 那条路没有逐节点延迟,仍用出现次数。

**任何一步失败(Clash 没在跑、找不到配置、一个节点都不达标)都会中止本轮并保留 Deno 上
一批节点**,不会推一批空的把家里的订阅清掉。

### 想让它也自动跑

把定时任务的命令换成带 `SOURCE=clash` 的那条即可。不过要注意:这条路依赖 Clash Verge Rev
正在运行,而且它只测**延迟**不测**带宽**,也拿不到 Claude 解锁检测(`CL-` 标签)——
那两样是 subs-check 才有的。两条路并存、按需切换通常比二选一更合适。

## 日常操作

```bash
# 立刻跑一轮(不用等定点批次)
python3 run_once.py

# 看最近一次选点+推送的详情
tail -60 ~/nodepipe/logs/push.log

# 看历史趋势(每轮的美国节点数/推送数/协议分布)
cat ~/nodepipe/logs/history.csv

# 换/加订阅源:改 env 里的 SUB_URL(逗号分隔多个),然后重新生成配置
python3 gen_config.py full

# 临时不设上限地全量推一次(不改 env)
MAX_NODES=9999 python3 select_and_push.py

# 临时停 / 恢复自动化
python3 install_scheduler.py uninstall
python3 install_scheduler.py install

# 归档一份订阅原始内容(独立小工具,跟主链路无关)
python3 archive_sub.py
```

## 已知限制

- 归档池里的节点被当"应急下限"推送时**没有在当次重新验证**,只是最后已知可用的 URI。
  用它兜底总比完全没有强,但不保证能连通。日志和批次标签里会带 `⚠含归档节点`。
- `run_once.py` 假设 `subs-check -f config.yaml` 跑完一轮就退出。生成的 config 里已经
  不写 `check-interval` / `cron-expression` 也关掉了 web-ui,正常情况下它没有理由继续
  常驻;万一某个版本行为不同,`RUN_TIMEOUT`(默认 40 分钟)会兜住,不会永远卡死。
  **第一次装完请手动跑一次 `run_once.py` 确认它会正常结束。**
- GeoIP 只有 IPv4 库。纯 IPv6 的节点会落到"无法核实"分支,严格模式下会被丢弃。

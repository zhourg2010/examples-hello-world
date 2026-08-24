#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""clash_source.py — 把本地 Clash Verge Rev 当成节点来源。

用途:你在 Clash Verge Rev 里跑着一堆节点,想把"当下实测延迟达标"的那些直接推给 Deno,
不用再单独跑一轮 subs-check。用法是给 select_and_push.py 加一个开关:

    SOURCE=clash python3 select_and_push.py

后面的 US 严格核实、按协议轮转、上限 100、三层兜底、推送——全部跟 subs-check 那条路
共用同一份代码,这里只负责"从哪里拿候选节点 + 怎么判断它好用"。

## 两个数据来源,缺一不可

Clash 的 RESTful API **只给节点名和延迟,不给完整的连接参数**(server/port/uuid/password
一个都没有),光靠 API 重建不出分享链接。所以要两边都读:

  1. `clash-verge.yaml`(app 目录下的运行时合并配置)—— 这是 mihomo 内核当前真正加载的
     那份配置,里面的 `proxies:` 列表有完整参数,而且结构跟 subs-check 输出的 all.yaml
     完全一样,所以 select_and_push.py 的解析层一行都不用改。
  2. Clash API 的 `/proxies/{name}/delay` —— 实测延迟。按节点名跟上面那份对应起来。

## 连接方式:优先 unix socket

Clash Verge Rev 的 `enable_external_controller` **默认是关的**,也就是说默认情况下
mihomo 根本没有在监听 HTTP 端口,只开了 unix socket(macOS/Linux)或命名管道(Windows)。
所以这里优先走 unix socket —— macOS 和 Ubuntu 上你什么设置都不用改就能连上。

TCP 是备选(如果你自己在设置里开了"外部控制器"),默认地址是 `127.0.0.1:9097`
(注意不是常见的 9090,Clash Verge Rev 用的是 9097)。

Windows 上命名管道走不了 Python 标准库的 HTTP,只能用 TCP —— 需要你在
设置 → Clash 内核 里把"外部控制器"打开,脚本会在连不上的时候明确提示这一点。

## 环境变量

    CLASH_HOME          Clash Verge Rev 的数据目录。不设就按平台自动找。
    CLASH_API           手动指定控制器,如 "127.0.0.1:9097"。不设就从 config.yaml 读。
    CLASH_SECRET        手动指定 secret。不设就从 config.yaml 读。
    CLASH_PROFILE       手动指定含 proxies 的 YAML。不设就用 app 目录下的 clash-verge.yaml。
    CLASH_MAX_DELAY     延迟阈值(毫秒),默认 800。超过这个数的节点不要。
    CLASH_TEST_URL      测延迟用的 URL,默认 http://www.gstatic.com/generate_204
    CLASH_TEST_TIMEOUT  单个节点测延迟的超时(毫秒),默认 5000
    CLASH_CONCURRENCY   同时测延迟时的并发,默认 16
    CLASH_MIN_SPEED     测速阈值(MB/s),默认 0(=不测速,只按延迟筛)。设成 0.5 就是
                        "下载速度低于 0.5 MB/s 的不要"。开启后见下方"关于测速"。
    CLASH_SPEED_URL     测速下载地址,默认 Cloudflare 的 __down 接口
    CLASH_SPEED_SECONDS 每个节点最多测几秒,默认 5
    CLASH_MIXED_PORT    mihomo 的混合端口。不设就从 API 的 /configs 读。

## 关于测速:Clash 自己不产生速度数据

这一点必须说清楚,免得以后有人以为是这里少读了个字段:

  - **mihomo 的 REST API 里没有任何测速端点。** 逐节点能测的只有 `/proxies/{name}/delay`,
    返回的是延迟毫秒数,没有带宽。
  - **Clash Verge Rev 界面上那些"速度"全是连接列表的实时流量显示**,不是逐节点测速。
    它那个测试按钮测的也是延迟。

所以"速度大于 X"这个条件没法靠读 Clash 的结果拿到,只能自己驱动内核实测。做法是:

  1. 把内核切到 global 模式(`PATCH /configs {"mode":"global"}`)。global 模式下所有流量
     都走内置的 GLOBAL 选择器,不受用户自己那套分流规则影响——这一步是必须的,否则
     测速流量可能被规则判给 DIRECT,量出来的是直连速度而不是节点速度。
  2. 逐个把 GLOBAL 切到待测节点(`PUT /proxies/GLOBAL {"name": ...}`),
     通过 mihomo 的混合端口下载一段数据,算 MB/s。
  3. 无论成功失败,最后都把 GLOBAL 的选择和 mode 还原回测速前的样子。

**代价:测速期间你本机所有走 Clash 的流量都会跟着走当前被测的那个节点。**
这是没办法的事(一个内核同一时刻只能有一个 GLOBAL 选择),而且测速天然是串行的,
100 个节点大约要 8-10 分钟。所以测速默认是**关的**,要用得显式设 CLASH_MIN_SPEED。
"""

import os
import json
import socket
import http.client
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from common import IS_MACOS, IS_WINDOWS, log as _log

LOG = "push"


def log(msg):
    _log(LOG, msg)


APP_ID = "io.github.clash-verge-rev.clash-verge-rev"

MAX_DELAY = int(os.environ.get("CLASH_MAX_DELAY", "800"))
# 测速阈值,单位 MB/s。0 = 不测速(默认),只按延迟筛。
MIN_SPEED = float(os.environ.get("CLASH_MIN_SPEED", "0"))
SPEED_URL = os.environ.get("CLASH_SPEED_URL", "https://speed.cloudflare.com/__down?bytes=50000000")
SPEED_SECONDS = float(os.environ.get("CLASH_SPEED_SECONDS", "5"))
# Claude 解锁检测。subs-check 的 media-check 会给能用 Claude 的节点名加 "CL-" 标签,
# 不用 subs-check 就没这个信息了,所以这里自己测一遍。
CHECK_CLAUDE = os.environ.get("CLASH_CHECK_CLAUDE", "0").strip() not in ("0", "false", "no", "")
# 1 = 不能解锁 Claude 的节点直接不要;0 = 只作为排序优先级(跟 subs-check 那边的语义一致)
REQUIRE_CLAUDE = os.environ.get("CLASH_REQUIRE_CLAUDE", "0").strip() not in ("0", "false", "no", "")
CLAUDE_URL = os.environ.get("CLASH_CLAUDE_URL", "https://claude.ai/")
TEST_URL = os.environ.get("CLASH_TEST_URL", "http://www.gstatic.com/generate_204")
TEST_TIMEOUT = int(os.environ.get("CLASH_TEST_TIMEOUT", "5000"))
CONCURRENCY = int(os.environ.get("CLASH_CONCURRENCY", "16"))

# mihomo 对连不上的节点返回的延迟。API 那边通常直接返回错误,但有些版本会返回 0,
# 两种情况都当"不可用"处理。
UNREACHABLE = 0


class ClashSourceError(Exception):
    """来源不可用(找不到配置、连不上 API 等)。调用方应该据此中止本轮,而不是推一批空的。"""


# ---------------------------------------------------------------- 目录发现

def app_home() -> Path:
    """Clash Verge Rev 的数据目录。

    它用的是 Tauri 的 data_dir():
        macOS    ~/Library/Application Support/<APP_ID>
        Linux    $XDG_DATA_HOME 或 ~/.local/share/<APP_ID>
        Windows  %APPDATA%\\<APP_ID>          (Roaming,不是 Local)
    """
    override = os.environ.get("CLASH_HOME")
    if override:
        return Path(override).expanduser()

    if IS_MACOS:
        base = Path.home() / "Library" / "Application Support"
    elif IS_WINDOWS:
        base = Path(os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    return base / APP_ID


def _load_yaml(path: Path):
    import yaml
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f.read()) or {}


# ---------------------------------------------------------------- 连接信息

def controller_info() -> dict:
    """从 Clash Verge Rev 的 config.yaml 里读出控制器地址 / secret / unix socket 路径。

    读不到就退回默认值 —— 装完没动过设置的机器,config.yaml 里这几项本来就可能没写。
    """
    info = {"tcp": os.environ.get("CLASH_API", "").strip(),
            "secret": os.environ.get("CLASH_SECRET", "").strip(),
            "uds": ""}

    cfg_path = app_home() / "config.yaml"
    try:
        cfg = _load_yaml(cfg_path)
    except Exception:
        cfg = {}

    if not info["tcp"]:
        ctrl = str(cfg.get("external-controller") or "").strip()
        if ctrl.startswith(":"):
            ctrl = "127.0.0.1" + ctrl
        # 0.0.0.0 表示监听所有网卡,我们要连的是本机,换成 127.0.0.1
        if ctrl.startswith("0.0.0.0:"):
            ctrl = "127.0.0.1:" + ctrl.split(":", 1)[1]
        info["tcp"] = ctrl or "127.0.0.1:9097"   # Clash Verge Rev 的默认值是 9097,不是 9090

    if not info["secret"] and cfg.get("secret") is not None:
        info["secret"] = str(cfg.get("secret"))

    if not IS_WINDOWS:
        uds = str(cfg.get("external-controller-unix") or "").strip()
        if uds and Path(uds).exists():
            info["uds"] = uds

    return info


class _UdsConnection(http.client.HTTPConnection):
    """HTTP over unix socket。mihomo 的 external-controller-unix 提供的是同一套 REST API。"""

    def __init__(self, path, timeout=10):
        super().__init__("localhost", timeout=timeout)
        self._uds_path = path

    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        s.connect(self._uds_path)
        self.sock = s


class ClashClient:
    """极简 Clash API 客户端。用不到第三方 HTTP 库。"""

    def __init__(self, info: dict):
        self.info = info
        self.headers = {}
        if info.get("secret"):
            self.headers["Authorization"] = f"Bearer {info['secret']}"
        # 优先 unix socket:Clash Verge Rev 默认不开 HTTP 控制器,但 socket 一直是开的。
        self.mode = "uds" if info.get("uds") else "tcp"

    def _conn(self, timeout):
        if self.mode == "uds":
            return _UdsConnection(self.info["uds"], timeout=timeout)
        host, _, port = self.info["tcp"].rpartition(":")
        return http.client.HTTPConnection(host or "127.0.0.1", int(port or 9097), timeout=timeout)

    def get(self, path: str, timeout: float = 10):
        conn = self._conn(timeout)
        try:
            conn.request("GET", path, headers=self.headers)
            resp = conn.getresponse()
            body = resp.read()
            if resp.status != 200:
                raise ClashSourceError(f"HTTP {resp.status} {path}: {body[:200]!r}")
            return json.loads(body.decode("utf-8", "replace"))
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def _write(self, method: str, path: str, payload: dict, timeout: float = 10):
        conn = self._conn(timeout)
        try:
            body = json.dumps(payload).encode("utf-8")
            headers = dict(self.headers)
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(body))
            conn.request(method, path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            # 切换 selector 成功时 mihomo 返回 204 No Content,PATCH /configs 也是 204。
            if resp.status not in (200, 202, 204):
                raise ClashSourceError(f"HTTP {resp.status} {method} {path}: {data[:200]!r}")
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def put(self, path: str, payload: dict, timeout: float = 10):
        return self._write("PUT", path, payload, timeout)

    def patch(self, path: str, payload: dict, timeout: float = 10):
        return self._write("PATCH", path, payload, timeout)

    def describe(self) -> str:
        return (f"unix socket {self.info['uds']}" if self.mode == "uds"
                else f"http://{self.info['tcp']}")


def connect() -> ClashClient:
    info = controller_info()
    client = ClashClient(info)
    try:
        client.get("/version", timeout=5)
        log(f"--- 已连上 Clash 内核({client.describe()}) ---")
        return client
    except Exception as first:
        # unix socket 不通就退回试 TCP(用户可能自己开了外部控制器)
        if client.mode == "uds":
            client.mode = "tcp"
            try:
                client.get("/version", timeout=5)
                log(f"--- 已连上 Clash 内核({client.describe()},unix socket 不通已回退)---")
                return client
            except Exception:
                pass
        hint = ""
        if IS_WINDOWS:
            hint = ("\n       Windows 上必须走 HTTP:在 Clash Verge Rev 的"
                    " 设置 → Clash 内核 里打开「外部控制器」再试。")
        elif client.info.get("uds"):
            hint = "\n       Clash Verge Rev 没在运行?或者内核没起来?"
        else:
            hint = ("\n       没找到 unix socket。确认 Clash Verge Rev 正在运行;"
                    "或者在 设置 → Clash 内核 里打开「外部控制器」走 HTTP。")
        raise ClashSourceError(f"连不上 Clash 内核: {first}{hint}")


# ---------------------------------------------------------------- 节点

def load_proxies() -> list:
    """从 Clash Verge Rev 的运行时配置里读出完整的节点参数列表。

    读的是 `clash-verge.yaml`(app 目录下),那是 mihomo 内核当前真正加载的那份合并配置——
    比 profiles/ 下的原始订阅文件更准确:节点名跟 API 报的是 1:1 对得上的,不会因为
    profile 里配了改名/合并脚本而对不上号。
    """
    override = os.environ.get("CLASH_PROFILE")
    path = Path(override).expanduser() if override else (app_home() / "clash-verge.yaml")
    if not path.exists():
        raise ClashSourceError(
            f"找不到 Clash 运行时配置: {path}\n"
            f"       确认 Clash Verge Rev 装在默认位置并且至少成功启动过一次;"
            f"装在别处的话设 CLASH_HOME,或者直接用 CLASH_PROFILE 指定 YAML。")
    try:
        data = _load_yaml(path)
    except Exception as e:
        raise ClashSourceError(f"解析 {path} 失败: {e}")

    proxies = data.get("proxies") or []
    if not proxies:
        raise ClashSourceError(f"{path} 里没有 proxies 列表(内核可能还没加载任何订阅)。")
    log(f"--- 从 {path.name} 读到 {len(proxies)} 个节点 ---")
    return proxies


def measure_delays(client: ClashClient, names: list) -> dict:
    """并发对每个节点测一次实测延迟,返回 {节点名: 毫秒}。测不通的不会出现在结果里。

    用 /proxies/{name}/delay 逐个测,而不是 /group/{name}/delay 整组测——逐个测不依赖
    你在 GUI 里怎么分组,拿到的也是每个节点自己的数字。
    """
    q = urllib.parse.urlencode({"url": TEST_URL, "timeout": TEST_TIMEOUT})
    out = {}

    def one(name):
        path = f"/proxies/{urllib.parse.quote(name, safe='')}/delay?{q}"
        try:
            # 客户端超时给得比服务端宽一点,不然经常是我们自己先超时而不是拿到结果
            r = client.get(path, timeout=TEST_TIMEOUT / 1000.0 + 5)
            d = int(r.get("delay", 0))
            return name, (d if d > UNREACHABLE else None)
        except Exception:
            return name, None  # 超时/连不上/API 报错,都算这个节点当下不可用

    with ThreadPoolExecutor(max_workers=max(1, CONCURRENCY)) as pool:
        for name, delay in pool.map(one, names):
            if delay is not None:
                out[name] = delay
    return out


# ---------------------------------------------------------------- 测速

GLOBAL_GROUP = "GLOBAL"


def _mixed_port(client: ClashClient) -> int:
    """mihomo 的混合端口(HTTP+SOCKS 都在这个端口上)。测速的下载就从这里走。"""
    override = os.environ.get("CLASH_MIXED_PORT")
    if override:
        return int(override)
    try:
        cfg = client.get("/configs", timeout=5)
        port = int(cfg.get("mixed-port") or 0)
    except Exception:
        port = 0
    if not port:
        raise ClashSourceError(
            "拿不到 mihomo 的混合端口(mixed-port)。用 CLASH_MIXED_PORT 手动指定,"
            "或者确认 Clash Verge Rev 的混合端口是开着的。")
    return port


def _download_speed(port: int, timeout: float) -> float:
    """通过 mihomo 的混合端口下载一段数据,返回 MB/s。下不动就返回 0。

    只统计"第一个字节到达之后"的时间,不把 TLS 握手和首包等待算进带宽——
    否则慢握手的节点会被算成慢带宽,那是两码事(握手慢由延迟那一关负责筛)。
    """
    import time
    import urllib.request

    proxy = f"http://127.0.0.1:{port}"
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    req = urllib.request.Request(SPEED_URL, headers={"User-Agent": "nodepipe/1.0"})

    got = 0
    started = None
    try:
        with opener.open(req, timeout=timeout) as resp:
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                if started is None:
                    started = time.monotonic()   # 首字节到达才开始计时
                got += len(chunk)
                if time.monotonic() - started >= SPEED_SECONDS:
                    break
    except Exception:
        pass

    if not got or started is None:
        return 0.0
    elapsed = max(time.monotonic() - started, 0.001)
    return got / elapsed / 1024 / 1024


def _claude_ok(port: int, timeout: float) -> bool:
    """通过 mihomo 的混合端口访问 Claude,看这个节点所在地区能不能用。

    等价于 subs-check 的 media-check 给节点名打 "CL-" 标签那件事——不用 subs-check 就
    没人提供这个信息了,所以自己测。就是一次普通的 GET(跟浏览器打开页面做的事一样),
    每个节点只发一次。

    判定:地区被挡时 Cloudflare 会返回 403 / 451 或者一个明确写着不可用的页面;
    正常时返回 200。请求本身失败(超时、连不上)一律当成不可用。
    """
    import urllib.request
    import urllib.error

    proxy = f"http://127.0.0.1:{port}"
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    req = urllib.request.Request(CLAUDE_URL, headers={
        # 不带正常 UA 的话容易被当成爬虫拦掉,那就测不出真实的地区可用性了
        "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"),
        "Accept": "text/html,application/xhtml+xml",
    })
    try:
        with opener.open(req, timeout=timeout) as resp:
            if resp.status != 200:
                return False
            body = resp.read(8192).decode("utf-8", "replace").lower()
    except urllib.error.HTTPError as e:
        return False if e.code in (403, 451, 429) else False
    except Exception:
        return False

    # 地区被挡时页面里会有这类措辞。命中任意一条就算不可用。
    blocked_markers = ("not available in your", "unavailable in your",
                       "app.unavailable", "request blocked", "access denied")
    return not any(m in body for m in blocked_markers)


def probe_nodes(client: ClashClient, candidates: list) -> dict:
    """在**一趟** global 模式遍历里,对每个节点做所有启用了的逐节点探测。

    目前有两项,都必须"把内核切到这个节点"才能测:
      - 下载测速(CLASH_MIN_SPEED > 0)
      - Claude 解锁检测(CLASH_CHECK_CLAUDE=1)

    合成一趟是有意的:切内核 + 等生效本身就有固定开销,两项各跑一遍等于把最贵的部分
    做了两次。合起来之后,开了测速的情况下再加 Claude 检测几乎是免费的。

    必须切 global 模式才准:用户自己那套分流规则很可能把测试地址判给 DIRECT,那样量到的
    是直连结果,跟节点一点关系都没有。global 模式下所有流量无条件走内置的 GLOBAL
    选择器,把它切到谁就测谁。

    测完(哪怕中途出错或被 Ctrl-C)一定把 mode 和 GLOBAL 的选择还原回去 —— 不还原的话
    用户的 Clash 会停在 global 模式 + 某个随机节点上,分流规则全废。

    返回 {节点名: {"speed": MB/s 或 None, "claude": True/False 或 None}}
    """
    import time

    port = _mixed_port(client)

    # 记下现状,finally 里要还原
    try:
        cfg = client.get("/configs", timeout=5)
        old_mode = str(cfg.get("mode") or "rule")
    except Exception as e:
        raise ClashSourceError(f"读不到内核当前配置: {e}")
    try:
        g = client.get(f"/proxies/{GLOBAL_GROUP}", timeout=5)
        old_now = str(g.get("now") or "")
        allowed = set(g.get("all") or [])
    except Exception as e:
        raise ClashSourceError(f"读不到 GLOBAL 选择器: {e}(内核版本太老?)")

    names = [str(p.get("name", "")) for p in candidates if p.get("name")]
    testable = [n for n in names if n in allowed]
    skipped = len(names) - len(testable)

    jobs = []
    if MIN_SPEED > 0:
        jobs.append(f"测速(阈值 {MIN_SPEED} MB/s,每个最多 {SPEED_SECONDS:.0f} 秒)")
    if CHECK_CLAUDE:
        jobs.append("Claude 解锁检测" + ("(不通过就丢弃)" if REQUIRE_CLAUDE else "(只作排序优先级)"))
    per_node = (SPEED_SECONDS + 2 if MIN_SPEED > 0 else 0) + (3 if CHECK_CLAUDE else 0)

    log(f"--- 开始逐节点探测:{' + '.join(jobs)};共 {len(testable)} 个,"
        f"预计 {len(testable) * per_node / 60:.1f} 分钟 ---")
    log(f"    注意:探测期间本机走 Clash 的流量会跟着当前被测节点走,测完自动还原"
        f"(mode={old_mode},GLOBAL={old_now or '未选'})")
    if skipped:
        log(f"    {skipped} 个节点不在 GLOBAL 选择器里,跳过探测(通常是配置里被单独排除了)")

    out = {}
    try:
        client.patch("/configs", {"mode": "global"})
        for i, name in enumerate(testable, 1):
            try:
                client.put(f"/proxies/{GLOBAL_GROUP}", {"name": name})
            except Exception as e:
                log(f"    [{i}/{len(testable)}] {name}: 切换失败({e}),跳过")
                continue
            time.sleep(0.3)  # 给内核一点时间让切换生效,不然会量到上一个节点

            rec = {"speed": None, "claude": None}
            bits = []
            if MIN_SPEED > 0:
                rec["speed"] = _download_speed(port, timeout=SPEED_SECONDS + 10)
                bits.append(f"{'OK ' if rec['speed'] >= MIN_SPEED else '慢 '}{rec['speed']:6.2f} MB/s")
            if CHECK_CLAUDE:
                rec["claude"] = _claude_ok(port, timeout=10)
                bits.append("Claude✓" if rec["claude"] else "Claude✗")
            out[name] = rec
            log(f"    [{i}/{len(testable)}] {'  '.join(bits)}  {name}")
    finally:
        # 还原。这一步失败要大声说出来——用户的 Clash 会卡在 global 模式上。
        try:
            if old_now:
                client.put(f"/proxies/{GLOBAL_GROUP}", {"name": old_now})
            client.patch("/configs", {"mode": old_mode})
            log(f"--- 已还原内核状态(mode={old_mode},GLOBAL={old_now or '未变'})---")
        except Exception as e:
            log(f"!!! 还原内核状态失败: {e}")
            log(f"!!! 请手动把 Clash Verge Rev 的模式改回「{old_mode}」,否则分流规则不生效!")

    return out


def filter_by_delay(candidates: list) -> list:
    """对已经通过美国核实的候选做实测筛选:先延迟,再(可选)测速。

    在 US 核实**之后**才测,是为了少干活:一池子几百个节点里可能只有几十个是美国的,
    没必要对其余的也各测一遍——测速尤其贵,是串行的。

    两级筛的顺序也是有意的:延迟是并发的、几秒就测完一批,先用它把明显不通/太慢的
    刷掉;剩下的才进串行的测速环节。反过来做的话会在一堆根本连不通的节点上白等几分钟。

    留下来的节点会被塞上 `_delay`(毫秒)和 `_speed`(MB/s,没测速时不存在),
    select_and_push.py 的排序会优先用它们。
    """
    if not candidates:
        return []

    client = connect()
    names = [str(p.get("name", "")) for p in candidates if p.get("name")]
    log(f"--- 开始实测 {len(names)} 个美国节点的延迟"
        f"(阈值 {MAX_DELAY}ms,并发 {CONCURRENCY},测试地址 {TEST_URL})---")
    delays = measure_delays(client, names)

    kept = []
    too_slow = 0
    for p in candidates:
        name = str(p.get("name", ""))
        d = delays.get(name)
        if d is None:
            continue  # 测不通
        if d > MAX_DELAY:
            too_slow += 1
            continue
        p["_delay"] = d
        kept.append(p)

    kept.sort(key=lambda p: p["_delay"])
    log(f"--- 延迟筛选: {len(kept)} 个达标 / {too_slow} 个超过 {MAX_DELAY}ms / "
        f"{len(names) - len(delays)} 个测不通 ---")
    if kept:
        log(f"    最快 {kept[0]['_delay']}ms ({kept[0].get('name')}),"
            f"最慢 {kept[-1]['_delay']}ms ({kept[-1].get('name')})")

    # ---- 第二级:逐节点探测(测速 / Claude 解锁)。两项都关就直接返回 ----
    if not kept or (MIN_SPEED <= 0 and not CHECK_CLAUDE):
        return kept

    probes = probe_nodes(client, kept)

    final = []
    slow = 0
    no_claude = 0
    untested = 0
    for p in kept:
        name = str(p.get("name", ""))
        rec = probes.get(name)
        if rec is None:
            untested += 1
            continue  # 不在 GLOBAL 里或切换失败,没测成
        if MIN_SPEED > 0:
            if rec["speed"] is None or rec["speed"] < MIN_SPEED:
                slow += 1
                continue
            p["_speed"] = rec["speed"]
        if CHECK_CLAUDE:
            p["_claude"] = bool(rec["claude"])
            if REQUIRE_CLAUDE and not rec["claude"]:
                no_claude += 1
                continue
        final.append(p)

    # 排序:能解锁 Claude 的优先 → 快的优先。跟 select_and_push 里桶内排序的口径一致。
    final.sort(key=lambda p: (0 if p.get("_claude") else 1, -(p.get("_speed") or 0)))

    parts = [f"{len(final)} 个通过"]
    if MIN_SPEED > 0:
        parts.append(f"{slow} 个速度不达标(<{MIN_SPEED} MB/s)")
    if REQUIRE_CLAUDE:
        parts.append(f"{no_claude} 个 Claude 不可用")
    parts.append(f"{untested} 个没测成")
    log(f"--- 逐节点探测结果: {' / '.join(parts)} ---")
    if final and CHECK_CLAUDE:
        n_cl = sum(1 for p in final if p.get("_claude"))
        log(f"    其中 {n_cl} 个能解锁 Claude"
            + ("" if REQUIRE_CLAUDE else f",{len(final) - n_cl} 个不能(保留,但排在后面)"))
    if final and MIN_SPEED > 0:
        log(f"    最快 {final[0].get('_speed', 0):.2f} MB/s,"
            f"最慢 {min(p.get('_speed') or 0 for p in final):.2f} MB/s")
    return final

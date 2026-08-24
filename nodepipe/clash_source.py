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
    CLASH_CONCURRENCY   同时测几个,默认 16
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
    """极简 Clash API 客户端。只用得到 GET,所以不引第三方 HTTP 库。"""

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


def filter_by_delay(candidates: list) -> list:
    """对已经通过美国核实的候选做实测延迟筛选。

    在 US 核实**之后**才测延迟,是为了少打 API:一池子几百个节点里可能只有几十个是
    美国的,没必要对其余的也各测一次。

    每个留下来的节点会被塞一个 `_delay` 字段,select_and_push.py 的排序会优先用它
    (实测延迟比"历史出现次数"更能反映当下好不好用)。
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
    return kept

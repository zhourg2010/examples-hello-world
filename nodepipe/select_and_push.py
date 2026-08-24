#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""select_and_push.py — 从 subs-check 的测速结果里挑出美国节点,打包推给 Deno。

2026-08 大改,跟以前的版本有三处根本区别:

1. **只要美国节点。** 以前是"美>欧>亚"的排序偏好,别的地区排后面但还是会被推上去;
   现在非美国节点直接不进候选池。判定是**严格**的:节点名上的国家标签只用来做第一层
   粗筛,最终必须由本地 GeoIP 库核实服务器 IP 确实落在美国才算数。GeoIP 说不是美国
   → 丢弃;GeoIP 查不到这个 IP → 也丢弃(严格模式下"验证不了"等同于"不算数")。
   GeoIP 库整个不可用时(第一次跑就下载失败)**不推送**,保住 Deno 上一批好节点——
   宁可这一轮不更新,也不能把一池子没核实过国家的节点推给家人。

2. **上限 100,不再分 vless/other 两个固定配额。** 以前 vless 桶 30 + other 桶 30 再砍到
   50,是为了保证协议多样性。现在改成"按协议轮转取"(round-robin):各协议排好序后
   一人一个交替拿,拿满 100 为止。效果比固定配额好——某个协议节点少的时候,名额会
   自动让给别的协议,而不是像固定配额那样白白浪费掉。而且轮转天然保证了各协议都有
   代表,不会出现"Deno 那边 v2rayN 链接过滤掉 anytls 之后一个节点都不剩"的情况。

3. **/us 那条独立链路整个删掉了。** 既然主池已经全是美国节点,再单独维护一份
   us_archive.json + /push-us + 隐藏的 /us 链接就是纯粹的重复。美国节点的历史归档
   功能被合并进了本来就有的"三振出局"历史(node_history.json)。

保留没变的:三振出局历史 + 重测通道、last_good 缓存兜底、归档垫底、MIN_KEEP 安全阀、
末尾追加时间戳标记节点。

数据源有两条路,用 SOURCE 开关切换:
  SOURCE=subscheck (默认)  读 subs-check 的测速结果 all.yaml。定时任务走的是这条。
  SOURCE=clash             读本地 Clash Verge Rev 当前加载的节点 + 实测延迟筛选。
                           想把"自己在 Clash 里跑着、当下延迟达标"的节点直接推出去时用。
                           详见 clash_source.py。
两条路只在"从哪儿拿候选节点 + 怎么判断好不好用"这一步不同,后面的美国核实、轮转选点、
上限、三层兜底、推送全部共用同一份代码。

环境变量(由 common.load_env() 从 nodepipe/env 读入,也可以直接在命令行覆盖):
  PUSH_URL, PUSH_KEY        必填
  SOURCE                    subscheck(默认) | clash
  MAX_NODES                 推送节点数上限,默认 100
  MIN_KEEP                  少于这个数就不推送,保住上一批,默认 10
  SUBS_OUTPUT               subs-check 结果文件路径,默认 <HOME>/bin/output/all.yaml
  GEOIP_STRICT              默认 1(严格)。设成 0 会退化成"GeoIP 查不到就信节点名标签",
                            只在 GeoIP 库长期拉不下来又急着用的时候临时开,不建议常开。
"""

import os
import sys
import json
import socket
import base64
import datetime
import urllib.parse
import urllib.request
import urllib.error
from collections import Counter

from common import (
    HOME, OUTPUT_DIR, STATE_DIR, RETEST_DIR,
    ensure_dirs, load_env, log as _log, now_str,
)

import geoip
import node_cache

LOG = "push"


def log(msg):
    _log(LOG, msg)


load_env()
ensure_dirs()

PUSH_URL = os.environ.get("PUSH_URL", "").strip()
PUSH_KEY = os.environ.get("PUSH_KEY", "").strip()
OUTPUT = os.environ.get("SUBS_OUTPUT") or str(OUTPUT_DIR / "all.yaml")
MAX_NODES = int(os.environ.get("MAX_NODES", "100"))
MIN_KEEP = int(os.environ.get("MIN_KEEP", "10"))
GEOIP_STRICT = os.environ.get("GEOIP_STRICT", "1").strip() not in ("0", "false", "no", "")
SOURCE = os.environ.get("SOURCE", "subscheck").strip().lower()

# 历史节点"三振出局":连续几轮没在测活结果里出现,就从"每轮强制重测"名单里除名,
# 转入被动归档池(只有真正凑不够数的时候才作为垫底候选)。
HISTORY_MISS_LIMIT = 3
HISTORY_FILE = STATE_DIR / "node_history.json"
CACHE_FILE = STATE_DIR / "last_good.json"
# 写到 RETEST_DIR,由 run_once.py 起的本地文件服务对外提供,再作为一个 sub-url 喂回
# subs-check——下一轮它就会真的把这些节点拉去重测,而不只是凭旧缓存假设它们还活着。
# (以前是靠 subs-check 自带的 8199 web-ui 文件服务,那要求它必须常驻;改成自己起一个
#  只读的小文件服务后,三个平台上都不再需要常驻守护进程。)
RECENT_RETEST_FILE = RETEST_DIR / "recent_history.txt"


# ---------------------------------------------------------------- 节点名解析

def country_of(name: str) -> str:
    """从 subs-check 重命名后的节点名里取国家码(格式形如 US_24、GB_4、JP_5)。"""
    s = "".join(ch for ch in name if ch.isascii())  # 去掉国旗 emoji
    s = s.lstrip("|").strip()
    cc = ""
    for ch in s:
        if ch.isalpha():
            cc += ch
        else:
            break
    return cc.upper()[:2]


def has_cl(name: str) -> bool:
    """subs-check 的 media-check 给能解锁 Claude 的节点名里加 "CL-" 标签。

    只用来排序(能解锁的排前面),不当硬过滤——曾经把它当硬门槛,一次 media-check
    抖动就把节点清零过一次。
    """
    return "CL-" in name


# ---------------------------------------------------------------- 读写

def load_json(path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_json(path, data: dict):
    try:
        path = str(path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"WARN: 保存 {path} 失败: {e}")


def load_yaml(path: str):
    try:
        import yaml
    except ImportError:
        log("ERROR: 缺少 PyYAML。安装方式:")
        log("  macOS(MacPorts): sudo port install py312-yaml   /  (pip): pip3 install pyyaml")
        log("  Ubuntu:          sudo apt install python3-yaml  /  (pip): pip3 install pyyaml")
        log("  Windows:         py -m pip install pyyaml")
        sys.exit(1)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f.read())
        return (data or {}).get("proxies") or []
    except Exception as e:
        log(f"ERROR: 解析 {path} 失败: {e}")
        sys.exit(1)


# ---------------------------------------------------------------- URI 构造

def build_vless(p: dict) -> str:
    if p.get("type") != "vless":
        return ""
    uuid, server, port = p.get("uuid", ""), p.get("server", ""), p.get("port", "")
    if not (uuid and server and port):
        return ""

    q = {"encryption": "none"}
    net = p.get("network", "tcp")
    q["type"] = net

    reality = p.get("reality-opts") or {}
    if reality:
        q["security"] = "reality"
        if reality.get("public-key"):
            q["pbk"] = reality["public-key"]
        if reality.get("short-id"):
            q["sid"] = reality["short-id"]
    elif p.get("tls"):
        q["security"] = "tls"
    else:
        q["security"] = "none"

    sni = p.get("servername") or p.get("sni")
    if sni:
        q["sni"] = sni
    if p.get("client-fingerprint"):
        q["fp"] = p["client-fingerprint"]
    if p.get("flow"):
        q["flow"] = p["flow"]

    if net == "ws":
        ws = p.get("ws-opts") or {}
        if ws.get("path"):
            q["path"] = ws["path"]
        headers = ws.get("headers") or {}
        host = headers.get("Host") or headers.get("host")
        if host:
            q["host"] = host
    elif net == "grpc":
        g = p.get("grpc-opts") or {}
        if g.get("grpc-service-name"):
            q["serviceName"] = g["grpc-service-name"]

    query = urllib.parse.urlencode(q, safe="")
    frag = urllib.parse.quote(str(p.get("name", "")))
    return f"vless://{uuid}@{server}:{port}?{query}#{frag}"


def build_anytls(p: dict) -> str:
    if p.get("type") != "anytls":
        return ""
    password, server, port = p.get("password", ""), p.get("server", ""), p.get("port", "")
    if not (password and server and port):
        return ""

    q = {}
    sni = p.get("sni") or p.get("servername")
    if sni:
        q["sni"] = sni
    q["insecure"] = "1" if p.get("skip-cert-verify") else "0"

    auth = urllib.parse.quote(str(password), safe="")
    query = urllib.parse.urlencode(q, safe="")
    frag = urllib.parse.quote(str(p.get("name", "")))
    return f"anytls://{auth}@{server}:{port}/?{query}#{frag}"


def build_trojan(p: dict) -> str:
    if p.get("type") != "trojan":
        return ""
    password, server, port = p.get("password", ""), p.get("server", ""), p.get("port", "")
    if not (password and server and port):
        return ""

    q = {}
    sni = p.get("sni") or p.get("servername")
    if sni:
        q["sni"] = sni
    if p.get("skip-cert-verify"):
        q["allowInsecure"] = "1"

    net = p.get("network", "tcp")
    if net and net != "tcp":
        q["type"] = net
        if net == "ws":
            ws = p.get("ws-opts") or {}
            if ws.get("path"):
                q["path"] = ws["path"]
            headers = ws.get("headers") or {}
            host = headers.get("Host") or headers.get("host")
            if host:
                q["host"] = host
        elif net == "grpc":
            g = p.get("grpc-opts") or {}
            if g.get("grpc-service-name"):
                q["serviceName"] = g["grpc-service-name"]

    auth = urllib.parse.quote(str(password), safe="")
    query = urllib.parse.urlencode(q, safe="")
    frag = urllib.parse.quote(str(p.get("name", "")))
    return f"trojan://{auth}@{server}:{port}?{query}#{frag}"


BUILDERS = {"vless": build_vless, "anytls": build_anytls, "trojan": build_trojan}
# 轮转顺序。vless 放最前是因为它在所有目标客户端里的兼容性最好(Surge 除外,但 Surge
# 本来就只能吃 trojan);anytls 兼容性最窄(v2rayN/V2Box/Surge 都不支持),放最后。
PROTO_ORDER = ["vless", "trojan", "anytls"]


def identity_of(p: dict) -> str:
    return f"{p.get('type')}:{p.get('server')}:{p.get('port')}"


# ---------------------------------------------------------------- 美国核查

class UsVerifier:
    """严格的美国节点判定。

    两层:
      1. subs-check 自己的 iprisk 检测在节点名里打的国家标签 —— 便宜,先粗筛一遍,
         省得对一池子不相关的节点都去做 DNS 解析。
      2. 本地 GeoIP 库对该节点服务器的**真实 IP** 做权威核实。

    严格模式(默认)下,第二层查不出"US"就一律不要,包括"库里没有这个 IP 段"的情况——
    因为"验证不了"和"验证不通过"在只要美国节点这个前提下应该同等对待。
    唯一的例外是 GeoIP 库整个不可用,那种情况下不是丢几个节点的问题,是这一轮根本
    没有判据,由调用方决定整体中止(见 main 里的处理)。
    """

    def __init__(self):
        self.db_ready = geoip.ensure_geoip_db()
        self.rejected_by_geoip = 0
        self.rejected_unresolvable = 0
        self.rejected_by_tag = 0
        self._dns_cache = {}

    def _resolve(self, server: str):
        if server in self._dns_cache:
            return self._dns_cache[server]
        ip = None
        try:
            socket.inet_aton(server)   # 本来就是 IPv4 字面量
            ip = server
        except OSError:
            try:
                ip = socket.gethostbyname(server)
            except Exception:
                ip = None
        self._dns_cache[server] = ip
        return ip

    def is_us(self, p: dict) -> bool:
        name = str(p.get("name", ""))
        if country_of(name) != "US":
            self.rejected_by_tag += 1
            return False

        if not self.db_ready:
            # 调用方应该在建 UsVerifier 之后就检查 db_ready 并中止,走不到这里。
            # 万一走到了,宽松模式下信标签,严格模式下拒绝。
            return not GEOIP_STRICT

        ip = self._resolve(str(p.get("server", "")))
        if ip is None:
            self.rejected_unresolvable += 1
            return not GEOIP_STRICT

        real = geoip.country_of_ip(ip)
        if real == "US":
            return True
        if real is None:
            # 库里查不到这个 IP 段。严格模式下当作"没核实成功"→ 不要。
            self.rejected_unresolvable += 1
            return not GEOIP_STRICT
        self.rejected_by_geoip += 1
        return False

    def summary(self) -> str:
        return (f"标签非US {self.rejected_by_tag} 个 / GeoIP判定非US {self.rejected_by_geoip} 个 / "
                f"无法核实(域名解析不了或库里查不到) {self.rejected_unresolvable} 个")


# ---------------------------------------------------------------- 历史

def update_node_history(candidates: list) -> dict:
    """三振出局:

    - 本轮出现的节点 → streak_miss 归零,记下最新 URI/名字。
    - 历史里本轮没出现的 → streak_miss += 1。
    - streak_miss 在 1~(HISTORY_MISS_LIMIT-1) → 算"最近还活过",写进 recent_history.txt
      让 subs-check 下一轮把它带回去真正重测。
    - streak_miss >= HISTORY_MISS_LIMIT → 移出重测名单(不再每轮强制测),但记录保留,
      作为最后兜底的候选来源。
    """
    history = load_json(HISTORY_FILE)
    now = now_str()
    fresh_ids = set()

    for p in candidates:
        ident = identity_of(p)
        fresh_ids.add(ident)
        builder = BUILDERS.get(p.get("type"))
        uri = builder(p) if builder else ""
        if not uri:
            continue
        entry = history.get(ident, {})
        entry.update({
            "proto": p.get("type"),
            "last_uri": uri,
            "last_name": str(p.get("name", "")),
            "last_seen": now,
            "streak_miss": 0,
            "appearances": entry.get("appearances", 0) + 1,
        })
        history[ident] = entry

    for ident, entry in history.items():
        if ident not in fresh_ids:
            entry["streak_miss"] = entry.get("streak_miss", 0) + 1

    save_json(HISTORY_FILE, history)

    retest_lines = [
        e["last_uri"] for ident, e in history.items()
        if ident not in fresh_ids
        and 0 < e.get("streak_miss", 0) < HISTORY_MISS_LIMIT
        and e.get("last_uri")
    ]
    try:
        RECENT_RETEST_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(RECENT_RETEST_FILE, "w", encoding="utf-8") as f:
            if retest_lines:
                f.write("\n".join(retest_lines) + "\n")
        log(f"--- 三振出局历史: {len(retest_lines)} 个'最近还活过'的节点已排进下一轮重测名单 ---")
    except Exception as e:
        log(f"WARN: 写 {RECENT_RETEST_FILE} 失败: {e}")

    return history


def archived_uris(history: dict, exclude_ids: set, limit: int) -> list:
    """从三振出局归档池里取最后已知可用的 URI 当垫底候选(**未在本轮重新验证过**)。

    只有"本轮新鲜结果 + last_good 缓存"两层都凑不够数时才会用到。
    注意归档里的节点当初入库时是核实过美国的(能进 history 就说明进过 candidates),
    所以这里不需要再筛一次国家。
    """
    if limit <= 0:
        return []
    items = [
        (ident, e) for ident, e in history.items()
        if e.get("streak_miss", 0) >= HISTORY_MISS_LIMIT
        and ident not in exclude_ids
        and e.get("last_uri")
    ]
    # 出现次数多的排前面:反复出现过说明背后的机器/线路更长期稳定。
    items.sort(key=lambda kv: -kv[1].get("appearances", 0))
    return [e["last_uri"] for _, e in items[:limit]]


# ---------------------------------------------------------------- 选点

def round_robin(buckets: dict, limit: int) -> list:
    """按协议轮转取节点,取满 limit 个为止。

    buckets: {协议: [已排好序的 proxy dict, ...]}
    某个协议先取完了就跳过它,剩下的名额自动让给还有货的协议——这是它比"每协议固定
    配额"强的地方:配额制下 anytls 只有 3 个的时候,剩下 27 个名额是白白浪费掉的。
    """
    out = []
    idx = {k: 0 for k in buckets}
    while len(out) < limit:
        progressed = False
        for proto in PROTO_ORDER:
            pool = buckets.get(proto) or []
            i = idx.get(proto, 0)
            if i < len(pool):
                out.append(pool[i])
                idx[proto] = i + 1
                progressed = True
                if len(out) >= limit:
                    break
        if not progressed:
            break  # 所有协议都取完了
    return out


def sort_key(p: dict, stats: dict):
    """桶内排序:能解锁 Claude 的优先 → 快/稳的优先 → 名字。

    第二档用什么衡量"快/稳",取决于数据源:
      - SOURCE=clash 时每个节点都带着刚刚实测出来的延迟(_delay),那当然用延迟——
        它反映的是"此时此刻好不好用",比任何历史统计都准。
      - SOURCE=subscheck 时没有逐节点的延迟数字,退回用累计出现次数:反复出现过的
        节点背后的机器/线路更长期稳定。
    """
    name = str(p.get("name", ""))
    delay = p.get("_delay")
    if delay is not None:
        return (0 if has_cl(name) else 1, int(delay), name)
    appearances = stats.get(identity_of(p), {}).get("appearances", 0)
    return (0 if has_cl(name) else 1, -appearances, name)


# ---------------------------------------------------------------- 主流程

def main():
    if not PUSH_URL or not PUSH_KEY:
        log("ERROR: PUSH_URL / PUSH_KEY 没设置。中止。")
        sys.exit(1)
    if SOURCE not in ("subscheck", "clash"):
        log(f"ERROR: 未知的 SOURCE={SOURCE}(可用: subscheck | clash)")
        sys.exit(1)

    log(f"===== {now_str()} 选点开始(数据源 {SOURCE},只要美国节点,上限 {MAX_NODES}) =====")

    if SOURCE == "clash":
        try:
            import clash_source
            proxies = clash_source.load_proxies()
        except Exception as e:
            # 来源不可用时不能"推一批空的"——那等于把家里的订阅清掉。中止,保住上一批。
            log(f"ERROR: 读不到本地 Clash 的节点: {e}")
            log("       本轮跳过推送,保留 Deno 上一批节点。")
            sys.exit(1)
    else:
        if not os.path.exists(OUTPUT):
            log(f"ERROR: 找不到 subs-check 的输出文件: {OUTPUT}")
            sys.exit(1)
        proxies = load_yaml(OUTPUT)

    typed = [p for p in proxies if p.get("type") in BUILDERS]
    if not typed:
        log("候选里没有 vless/anytls/trojan 节点,没什么可推的。")
        sys.exit(0)

    verifier = UsVerifier()
    if not verifier.db_ready:
        if GEOIP_STRICT:
            # 严格模式下没有 GeoIP 库就等于没有判据。这时候推送等于把一池子没核实过
            # 国家的节点发给家人,不如不推——Deno 上一批节点还在,家里不会断网。
            log("ERROR: GeoIP 库不可用(下载失败且本地没有任何缓存副本)。"
                "严格模式下无法核实节点是否真在美国,本轮跳过推送,保留 Deno 上一批节点。")
            log("       想临时降级成'只信节点名标签'的话:GEOIP_STRICT=0 再跑一次。")
            sys.exit(1)
        log("WARN: GeoIP 库不可用,已按 GEOIP_STRICT=0 降级成只信 subs-check 的国家标签。"
            "这一轮没有做独立的 IP 核实。")

    candidates = [p for p in typed if verifier.is_us(p)]
    log(f"--- 测速通过 {len(typed)} 个,其中确认在美国的 {len(candidates)} 个 "
        f"(排除: {verifier.summary()}) ---")

    if not candidates:
        log("ERROR: 一个美国节点都没有。本轮跳过推送,保留 Deno 上一批节点。")
        sys.exit(1)

    # Clash 源:对已经确认在美国的节点再做一次实测延迟筛选。
    # 放在 US 核实之后是为了少打 API——一池子几百个节点里可能只有几十个是美国的。
    if SOURCE == "clash":
        try:
            candidates = clash_source.filter_by_delay(candidates)
        except Exception as e:
            log(f"ERROR: 实测延迟失败: {e}")
            log("       本轮跳过推送,保留 Deno 上一批节点。")
            sys.exit(1)
        if not candidates:
            log("ERROR: 没有一个美国节点的实测延迟达标。本轮跳过推送,保留 Deno 上一批节点。")
            sys.exit(1)

    # 记一笔"这些节点这次也出现了",拿到累计出现次数用于稳定性排序。
    try:
        stability = node_cache.record_and_stats(candidates)
    except Exception as e:
        log(f"WARN: node_cache 记录失败({e}),这轮排序退化成不考虑稳定性,不影响推送。")
        stability = {}

    history = update_node_history(candidates)

    buckets = {}
    for proto in PROTO_ORDER:
        pool = [p for p in candidates if p.get("type") == proto]
        pool.sort(key=lambda p: sort_key(p, stability))
        buckets[proto] = pool

    picked = round_robin(buckets, MAX_NODES)

    fresh_uris = []
    for p in picked:
        uri = BUILDERS[p["type"]](p)
        if uri:
            fresh_uris.append(uri)
            n = str(p.get("name", ""))
            appear = stability.get(identity_of(p), {}).get("appearances", 0)
            log(f"  [{'CL' if has_cl(n) else '--'}][{p.get('type'):<6}][见过{appear:>3}次] {n}")

    # ---- 三层兜底 ----
    cache = load_json(CACHE_FILE)
    used_cache = False
    uris = fresh_uris
    if not uris:
        uris = cache.get("uris", [])
        if uris:
            used_cache = True
            log(f"WARN: 本轮一个 URI 都没构造出来,回退到 {cache.get('ts','?')} 的 "
                f"{len(uris)} 个缓存节点。")

    # 归档垫底是**应急下限**,不是用来把数量填满到上限的。
    # MAX_NODES=100 是"最多推这么多",不是"必须凑够这么多"——如果哪天美国节点只测出
    # 30 个,那就推 30 个,不该再塞 70 个本轮根本没验证过的旧节点进去充数(那样家人
    # 客户端里会有一大半是连不上的死节点,反而更难用)。
    # 只有跌破 MIN_KEEP 这条安全线、眼看要触发"跳过推送"的时候,才拿归档补到 MIN_KEEP。
    used_archive = 0
    if len(uris) < MIN_KEEP:
        fill = archived_uris(history, {identity_of(p) for p in picked}, MIN_KEEP - len(uris))
        if fill:
            used_archive = len(fill)
            uris = uris + fill
            log(f"WARN: 新鲜节点只有 {len(uris) - used_archive} 个,低于安全线 MIN_KEEP={MIN_KEEP},"
                f"用 {used_archive} 个归档节点(本轮未重新验证)补到下限。")

    uris = uris[:MAX_NODES]

    proto_all = Counter(p.get("type") for p in candidates)
    proto_picked = Counter(p.get("type") for p in picked)
    log(f"--- 美国节点池: vless={proto_all.get('vless',0)} trojan={proto_all.get('trojan',0)} "
        f"anytls={proto_all.get('anytls',0)} (共 {len(candidates)}) ---")
    log(f"--- 本次选中: vless={proto_picked.get('vless',0)} trojan={proto_picked.get('trojan',0)} "
        f"anytls={proto_picked.get('anytls',0)} | 归档垫底 +{used_archive} | 合计 {len(uris)} ---")

    if len(uris) < MIN_KEEP:
        log(f"ERROR: 只凑出 {len(uris)} 个节点(低于 MIN_KEEP={MIN_KEEP})。"
            "跳过推送,保留 Deno 上一批节点。")
        sys.exit(1)

    # ---- 末尾的时间戳标记节点 ----
    note = ""
    if used_cache:
        note += " ⚠全部为缓存"
    if used_archive:
        note += " ⚠含归档节点"
    stamp = datetime.datetime.now().strftime("🇺🇸US 更新于 %Y-%m-%d %H:%M") + note
    marker = ("vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1"
              f"?encryption=none&security=none&type=tcp#{urllib.parse.quote(stamp)}")
    payload = uris + [marker]
    log(f"  [标记] {stamp}")

    body = base64.b64encode(("\n".join(payload) + "\n").encode("utf-8"))
    req = urllib.request.Request(
        PUSH_URL, data=body, method="POST",
        headers={"Authorization": f"Bearer {PUSH_KEY}", "Content-Type": "text/plain; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            log(f"PUSH OK HTTP {resp.status}: {resp.read().decode('utf-8', 'ignore')[:200]}")
    except urllib.error.HTTPError as e:
        log(f"PUSH 失败 HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:200]}")
        sys.exit(1)
    except Exception as e:
        log(f"PUSH 出错: {e}")
        sys.exit(1)

    # 推送成功之后才更新缓存和统计——推失败时不该把"这批是好的"这个结论记下来。
    if fresh_uris:
        save_json(CACHE_FILE, {"uris": fresh_uris, "ts": now_str()})

    csv_path = HOME / "logs" / "history.csv"
    try:
        new_file = not csv_path.exists()
        with open(csv_path, "a", encoding="utf-8") as cf:
            if new_file:
                cf.write("time,us_available,pushed,vless,trojan,anytls,archive_filled\n")
            cf.write(f"{now_str()},{len(candidates)},{len(uris)},"
                     f"{proto_picked.get('vless',0)},{proto_picked.get('trojan',0)},"
                     f"{proto_picked.get('anytls',0)},{used_archive}\n")
    except Exception as e:
        log(f"WARN: 写 history.csv 失败: {e}")


if __name__ == "__main__":
    main()

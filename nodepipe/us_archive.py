#!/opt/local/bin/python3.12
# -*- coding: utf-8 -*-
# us_archive.py — "美国节点组"(/us 隐藏链接)的连通性探测 + 清理 + 推送。
#
# 跟主流程(select_and_push.py)是两条独立的路:
#   - select_and_push.py 每次 subs-check 测活+测速通过、且经本地 GeoIP 库核实过服务器
#     IP 真的在美国的节点,记一笔"刚成功"到 state/us_archive.json。
#   - 这个脚本单独对档案里*所有*历史US节点做一次轻量 TCP 连通性探测(不是完整的协议
#     握手/认证测试——那个需要针对 vless/anytls/trojan 各自实现真实握手,复杂度和出错
#     面都大得多;用户明确认可了"能连通就算"这个简化版标准),按最近一次成功时间排序,
#     取前 US_TOP_N 个推给 Deno。
#
# 档案不是永久无限增长的:一个节点如果连续 US_ARCHIVE_MAX_AGE_DAYS 天(默认180天/半年)
# 都没有成功过一次(不管是 subs-check 测活成功,还是这里的 TCP 探测成功),就判定这个
# 节点/机场大概率已经不存在了,从档案里彻底删掉,避免文件无限膨胀。半年这个阈值足够宽松,
# 不会误删只是暂时不稳定的节点。
#
# 用法:python3 us_archive.py   (从 force_retest.sh 里在主推送之后调用)

import os
import sys
import json
import socket
import base64
import datetime
import urllib.parse
import urllib.request
import urllib.error

US_ARCHIVE_FILE = os.path.expanduser("~/nodepipe/state/us_archive.json")
LOGFILE = os.path.expanduser("~/nodepipe/logs/us_archive.log")
US_TOP_N = int(os.environ.get("US_TOP_N", "50"))
PING_TIMEOUT = float(os.environ.get("US_PING_TIMEOUT", "3"))
US_ARCHIVE_MAX_AGE_DAYS = int(os.environ.get("US_ARCHIVE_MAX_AGE_DAYS", "180"))

PUSH_URL = os.environ.get("PUSH_URL", "").strip()
PUSH_KEY = os.environ.get("PUSH_KEY", "").strip()


def log(msg):
    try:
        os.makedirs(os.path.dirname(LOGFILE), exist_ok=True)
        with open(LOGFILE, "a", encoding="utf-8") as f:
            f.write(str(msg) + "\n")
    except Exception:
        pass
    print(msg)


def load_archive() -> dict:
    try:
        with open(US_ARCHIVE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_archive(data: dict):
    try:
        os.makedirs(os.path.dirname(US_ARCHIVE_FILE), exist_ok=True)
        with open(US_ARCHIVE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"WARN: failed to save {US_ARCHIVE_FILE}: {e}")


def server_port_of(uri: str):
    # vless/anytls/trojan 都是标准 URL 形式(scheme://[auth@]host:port/...?...),urlsplit 能直接解析。
    try:
        u = urllib.parse.urlsplit(uri)
        if u.hostname and u.port:
            return u.hostname, u.port
    except Exception:
        pass
    return None, None


def tcp_reachable(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def push_us_url() -> str:
    # 复用主推送同一个 PUSH_URL,把路径的 /push 换成 /push-us,不用再单独配一个环境变量。
    if PUSH_URL.endswith("/push"):
        return PUSH_URL[: -len("/push")] + "/push-us"
    # 兜底:PUSH_URL 格式跟预期不一样时,直接在末尾拼,好过完全推不出去。
    return PUSH_URL.rstrip("/") + "-us"


def main():
    if not PUSH_URL or not PUSH_KEY:
        log("ERROR: PUSH_URL / PUSH_KEY not set. Abort.")
        sys.exit(1)

    archive = load_archive()
    if not archive:
        log("US archive is empty (no US node has been seen by select_and_push.py yet). Nothing to do.")
        sys.exit(0)

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    checked = 0
    reachable = 0
    for ident, entry in archive.items():
        uri = entry.get("uri", "")
        host, port = server_port_of(uri)
        if not host or not port:
            continue
        checked += 1
        if tcp_reachable(host, port, PING_TIMEOUT):
            entry["last_ok"] = now
            entry["last_checked"] = now
            reachable += 1
        else:
            entry["last_checked"] = now
    save_archive(archive)
    log(f"--- probed {checked} archived US node(s), {reachable} reachable this pass ---")

    # 清理:last_ok 超过 US_ARCHIVE_MAX_AGE_DAYS 天还没成功过的,判定基本不会再活了,彻底删掉——
    # 不然档案文件会随着时间推移无限膨胀(旧机场关停、订阅商换IP之类的情况会一直堆积)。
    cutoff = datetime.datetime.now() - datetime.timedelta(days=US_ARCHIVE_MAX_AGE_DAYS)
    pruned = []
    for ident, entry in list(archive.items()):
        last_ok_str = entry.get("last_ok", "")
        try:
            last_ok_dt = datetime.datetime.strptime(last_ok_str, "%Y-%m-%d %H:%M")
        except Exception:
            last_ok_dt = None  # last_ok 字段格式不对/缺失,保守起见不删(留着总比误删强)
        if last_ok_dt is not None and last_ok_dt < cutoff:
            pruned.append(ident)
            del archive[ident]
    if pruned:
        save_archive(archive)
        log(f"--- pruned {len(pruned)} node(s) with no success in {US_ARCHIVE_MAX_AGE_DAYS}+ days "
            f"(archive now holds {len(archive)}) ---")

    # 按最近一次成功时间排序(不管这次成功是 select_and_push.py 那边测活通过刷新的,
    # 还是这里 TCP 探测刷新的,都是同一个 last_ok 字段,谁新就排前面),取前 N 个。
    ranked = sorted(
        archive.items(),
        key=lambda kv: kv[1].get("last_ok", ""),
        reverse=True,
    )
    top = ranked[:US_TOP_N]
    if not top:
        log("No US nodes have ever succeeded. Skipping push (keeping whatever /us already has).")
        sys.exit(0)

    uris = [e["uri"] for _, e in top if e.get("uri")]

    stamp = "🇺🇸US节点组 更新于 " + now
    marker_frag = urllib.parse.quote(stamp)
    marker_uri = (
        "vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1"
        f"?encryption=none&security=none&type=tcp#{marker_frag}"
    )
    uris.append(marker_uri)

    raw = ("\n".join(uris) + "\n").encode("utf-8")
    body = base64.b64encode(raw)
    req = urllib.request.Request(
        push_us_url(), data=body, method="POST",
        headers={"Authorization": f"Bearer {PUSH_KEY}", "Content-Type": "text/plain; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            log(f"PUSH-US OK HTTP {resp.status}: {resp.read().decode('utf-8','ignore')[:200]} "
                f"(pushed {len(top)} of {len(archive)} archived US nodes)")
    except urllib.error.HTTPError as e:
        log(f"PUSH-US FAIL HTTP {e.code}: {e.read().decode('utf-8','ignore')[:200]}")
        sys.exit(1)
    except Exception as e:
        log(f"PUSH-US ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

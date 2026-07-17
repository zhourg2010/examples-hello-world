#!/opt/local/bin/python3.12
# -*- coding: utf-8 -*-
# Reads subs-check output (clash yaml), rebuilds vless:// / anytls:// / trojan:// URIs,
# picks up to PICK_VLESS vless nodes + PICK_OTHER anytls/trojan nodes (each bucket
# sorted by region priority US > Europe > Asia > other, no cross-bucket backfill),
# and POSTs the newline-joined list to the Deno /push endpoint.
# Aborts (keeps last good push) if fewer than MIN_KEEP nodes survive filtering.
#
# All secrets come from environment variables (set by select_and_push.sh):
#   PUSH_URL, PUSH_KEY, SUBS_OUTPUT (optional), PICK_VLESS (optional), PICK_OTHER (optional), MIN_KEEP (optional)

import os
import sys
import base64
import urllib.parse
import urllib.request
import urllib.error

PUSH_URL = os.environ.get("PUSH_URL", "").strip()
PUSH_KEY = os.environ.get("PUSH_KEY", "").strip()
OUTPUT = os.environ.get("SUBS_OUTPUT", os.path.expanduser("~/nodepipe/bin/output/all.yaml"))
PICK_VLESS = int(os.environ.get("PICK_VLESS", "10"))
PICK_OTHER = int(os.environ.get("PICK_OTHER", "10"))
MIN_KEEP = int(os.environ.get("MIN_KEEP", "5"))
LOGFILE = os.path.expanduser("~/nodepipe/logs/push.log")

# Region priority by country code found in node name (subs-check rename format: e.g. US_24, GB_4, JP_5)
US = {"US"}
EUROPE = {"GB", "ES", "DE", "FR", "NL", "IT", "SE", "CH", "PL", "RU", "TR", "IE", "FI", "NO", "DK", "AT", "BE", "PT", "RO", "UA"}
ASIA = {"JP", "KR", "TW", "SG", "MY", "TH", "VN", "PH", "ID", "IN"}
EXCLUDE = {"HK", "MO"}  # never select Hong Kong / Macau by country code
# Defense-in-depth: some nodes keep a Chinese/English HK-MO label even when
# subs-check's rename didn't produce a clean country-code prefix.
EXCLUDE_KEYWORDS = ("香港", "澳门", "HONG KONG", "HONGKONG", "MACAU", "MACAO")


def log(msg):
    try:
        with open(LOGFILE, "a", encoding="utf-8") as f:
            f.write(str(msg) + "\n")
    except Exception:
        pass
    print(msg)


def country_of(name: str) -> str:
    # name looks like "🇺🇸US_24|529KB/s|43%|CL-US" -> extract the CC after flag, before _ or |
    s = "".join(ch for ch in name if ch.isascii())  # drop flag emoji
    s = s.lstrip("|").strip()
    # take leading letters
    cc = ""
    for ch in s:
        if ch.isalpha():
            cc += ch
        else:
            break
    return cc.upper()[:2]


def region_rank(name: str) -> int:
    cc = country_of(name)
    if cc in US:
        return 1
    if cc in EUROPE:
        return 2
    if cc in ASIA:
        return 3
    return 4


def is_excluded(name: str) -> bool:
    # Layer 1: clean country-code prefix (subs-check's normal rename output).
    if country_of(name) in EXCLUDE:
        return True
    # Layer 2: keyword fallback, in case a node's name never got a clean
    # country-code prefix but still carries an HK/MO label some other way.
    upper = name.upper()
    return any(kw in name or kw in upper for kw in EXCLUDE_KEYWORDS)


STATE_DIR = os.path.expanduser("~/nodepipe/state")
CACHE_FILE = os.path.join(STATE_DIR, "last_good.json")


def load_cache() -> dict:
    try:
        import json
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_cache(data: dict):
    try:
        import json
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"WARN: failed to save bucket cache: {e}")


def load_yaml(path: str):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    try:
        import yaml
        data = yaml.safe_load(text)
        return data.get("proxies") or []
    except Exception as e:
        log(f"PyYAML not available or parse failed: {e}")
        log("Install with: sudo port install py312-yaml")
        sys.exit(1)


def build_vless(p: dict) -> str:
    # Rebuild a vless:// URI from a clash mihomo proxy dict.
    if p.get("type") != "vless":
        return ""
    uuid = p.get("uuid", "")
    server = p.get("server", "")
    port = p.get("port", "")
    name = str(p.get("name", ""))
    if not (uuid and server and port):
        return ""

    q = {"encryption": "none"}

    net = p.get("network", "tcp")
    q["type"] = net

    # security: reality / tls / none
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
    fp = p.get("client-fingerprint")
    if fp:
        q["fp"] = fp
    if p.get("flow"):
        q["flow"] = p["flow"]

    # transport-specific
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
    frag = urllib.parse.quote(name)
    return f"vless://{uuid}@{server}:{port}?{query}#{frag}"


def build_anytls(p: dict) -> str:
    # anytls:// URI per https://github.com/anytls/anytls-go/blob/main/docs/uri_scheme.md
    #   anytls://[password@]host[:port]/?[sni=...]&[insecure=0|1]#name
    if p.get("type") != "anytls":
        return ""
    password = p.get("password", "")
    server = p.get("server", "")
    port = p.get("port", "")
    name = str(p.get("name", ""))
    if not (password and server and port):
        return ""

    q = {}
    sni = p.get("sni") or p.get("servername")
    if sni:
        q["sni"] = sni
    q["insecure"] = "1" if p.get("skip-cert-verify") else "0"

    auth = urllib.parse.quote(str(password), safe="")
    query = urllib.parse.urlencode(q, safe="")
    frag = urllib.parse.quote(name)
    return f"anytls://{auth}@{server}:{port}/?{query}#{frag}"


def build_trojan(p: dict) -> str:
    # Rebuild a trojan:// URI from a clash mihomo proxy dict.
    if p.get("type") != "trojan":
        return ""
    password = p.get("password", "")
    server = p.get("server", "")
    port = p.get("port", "")
    name = str(p.get("name", ""))
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
    frag = urllib.parse.quote(name)
    return f"trojan://{auth}@{server}:{port}?{query}#{frag}"


BUILDERS = {"vless": build_vless, "anytls": build_anytls, "trojan": build_trojan}


def main():
    if not PUSH_URL or not PUSH_KEY:
        log("ERROR: PUSH_URL / PUSH_KEY not set. Abort.")
        sys.exit(1)
    if not os.path.exists(OUTPUT):
        log(f"ERROR: output not found: {OUTPUT}")
        sys.exit(1)

    proxies = load_yaml(OUTPUT)
    candidates = [p for p in proxies
                  if p.get("type") in BUILDERS
                  and not is_excluded(str(p.get("name", "")))]
    if not candidates:
        log("No vless/anytls/trojan nodes in output. Nothing to push.")
        sys.exit(0)

    # 两个独立配额桶:vless 一桶,anytls+trojan 合并一桶("其他")。
    # 各自按地区优先级排序、各自截取,互相不补齐——某一桶不够就是不够。
    vless_pool = [p for p in candidates if p.get("type") == "vless"]
    other_pool = [p for p in candidates if p.get("type") in ("anytls", "trojan")]
    vless_pool.sort(key=lambda p: region_rank(str(p.get("name", ""))))
    other_pool.sort(key=lambda p: region_rank(str(p.get("name", ""))))
    vless_picked = vless_pool[:PICK_VLESS]
    other_picked = other_pool[:PICK_OTHER]

    def build_list(picked_list):
        out = []
        for p in picked_list:
            builder = BUILDERS[p.get("type")]
            uri = builder(p)
            if uri:
                out.append(uri)
                log(f"  [{region_rank(str(p.get('name','')))}] [{p.get('type')}] {p.get('name','')}")
        return out

    log(f"--- picking {len(vless_picked)+len(other_picked)} of {len(candidates)} available "
        f"(vless bucket {min(len(vless_pool),PICK_VLESS)}/{len(vless_pool)}, "
        f"other bucket {min(len(other_pool),PICK_OTHER)}/{len(other_pool)}) ---")
    vless_uris_fresh = build_list(vless_picked)
    other_uris_fresh = build_list(other_picked)

    # 某个桶这次是空的(比如上游今天没有vless节点了)就用上次成功时缓存的那个桶顶上,
    # 而不是让依赖那个协议的标签链接(比如 v2box/v2rayn 只要 vless+trojan)直接变空。
    # 缓存是"按桶"存的,不是按整体——other桶有货不代表vless桶也有货。
    cache = load_cache()
    used_vless_fallback = False
    used_other_fallback = False
    vless_uris = vless_uris_fresh
    if not vless_uris:
        vless_uris = cache.get("vless", [])
        if vless_uris:
            used_vless_fallback = True
            log(f"WARN: vless bucket empty this run, falling back to {len(vless_uris)} cached vless node(s) "
                f"from {cache.get('vless_ts', '?')}")
    other_uris = other_uris_fresh
    if not other_uris:
        other_uris = cache.get("other", [])
        if other_uris:
            used_other_fallback = True
            log(f"WARN: other(anytls/trojan) bucket empty this run, falling back to {len(other_uris)} "
                f"cached node(s) from {cache.get('other_ts', '?')}")

    uris = vless_uris + other_uris

    from collections import Counter
    region_tally = Counter(region_rank(str(p.get("name", ""))) for p in candidates)
    us_n, eu_n, as_n, ot_n = region_tally.get(1, 0), region_tally.get(2, 0), region_tally.get(3, 0), region_tally.get(4, 0)
    proto_tally = Counter(p.get("type") for p in candidates)
    proto_picked_tally = Counter(p.get("type") for p in (vless_picked + other_picked))
    log(f"--- pool had: vless={proto_tally.get('vless',0)} anytls={proto_tally.get('anytls',0)} "
        f"trojan={proto_tally.get('trojan',0)} (total {len(candidates)}) ---")
    log(f"--- picked breakdown: vless={proto_picked_tally.get('vless',0)} "
        f"anytls={proto_picked_tally.get('anytls',0)} trojan={proto_picked_tally.get('trojan',0)} "
        f"| US={us_n} EU={eu_n} ASIA={as_n} other={ot_n} ---")

    # Safety guard: if too few nodes survive filtering, don't push a starved
    # list — keep whatever the Deno side already has (better than breaking
    # everyone's connection with e.g. 2 nodes). Checked BEFORE the timestamp
    # marker below, so the marker itself never counts toward MIN_KEEP.
    if len(uris) < MIN_KEEP:
        log(f"ERROR: only {len(uris)} nodes built (< MIN_KEEP={MIN_KEEP}). "
            f"Skipping push, keeping last good set on Deno.")
        sys.exit(1)

    # 追加一个"时间戳假节点"到列表最后:不是真实可用节点(指向 127.0.0.1,连不通),
    # 纯粹是给家人在客户端节点列表里一眼看出"这批节点是什么时候推的"——
    # 免得以为是"每天自动更新"实际上已经很久没变。名字就是这次运行的时间。
    real_uri_count = len(uris)  # 记下真实节点数,供下面 CSV 记录用(假节点不算数)
    import datetime
    fallback_note = ""
    if used_vless_fallback and used_other_fallback:
        fallback_note = " ⚠全部为缓存"
    elif used_vless_fallback:
        fallback_note = " ⚠vless为缓存"
    elif used_other_fallback:
        fallback_note = " ⚠其他为缓存"
    stamp = datetime.datetime.now().strftime("更新于 %Y-%m-%d %H:%M") + fallback_note
    marker_frag = urllib.parse.quote(stamp)
    marker_uri = f"vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?encryption=none&security=none&type=tcp#{marker_frag}"
    uris.append(marker_uri)
    log(f"  [marker] appended timestamp node: {stamp}")

    # base64-encode the list (standard subscription format for v2rayN/Shadowrocket;
    # sing-box/clash conversion on the Deno side base64-decodes first, so this works for all)
    raw = ("\n".join(uris) + "\n").encode("utf-8")
    body = base64.b64encode(raw)
    req = urllib.request.Request(
        PUSH_URL, data=body, method="POST",
        headers={"Authorization": f"Bearer {PUSH_KEY}", "Content-Type": "text/plain; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            log(f"PUSH OK HTTP {resp.status}: {resp.read().decode('utf-8','ignore')[:200]}")

            # 只有这次真的测出新鲜节点的桶才覆盖缓存;用了兜底的桶保持原样不变,
            # 留着继续给下一次兜底用,直到哪天上游真的又有货了才会刷新。
            now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
            if vless_uris_fresh:
                cache["vless"] = vless_uris_fresh
                cache["vless_ts"] = now_str
            if other_uris_fresh:
                cache["other"] = other_uris_fresh
                cache["other_ts"] = now_str
            save_cache(cache)

            csv_path = os.path.expanduser("~/nodepipe/logs/history.csv")
            new_file = not os.path.exists(csv_path)
            with open(csv_path, "a", encoding="utf-8") as cf:
                if new_file:
                    cf.write("time,available,picked,us,eu,asia,other,vless,anytls,trojan\n")
                cf.write(
                    f"{now_str},"
                    f"{len(candidates)},{real_uri_count},{us_n},{eu_n},{as_n},{ot_n},"
                    f"{proto_tally.get('vless',0)},{proto_tally.get('anytls',0)},{proto_tally.get('trojan',0)}\n"
                )
    except urllib.error.HTTPError as e:
        log(f"PUSH FAIL HTTP {e.code}: {e.read().decode('utf-8','ignore')[:200]}")
        sys.exit(1)
    except Exception as e:
        log(f"PUSH ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/opt/local/bin/python3.12
# -*- coding: utf-8 -*-
# Reads subs-check output (clash yaml), rebuilds vless:// / anytls:// / trojan:// URIs,
# picks up to PICK_VLESS vless nodes + PICK_OTHER anytls/trojan nodes (each bucket
# sorted by CL- (Claude unlock) first, then region priority US > Europe > Asia > other,
# no cross-bucket backfill from fresh results), trims the combined total to GENERAL_CAP,
# and POSTs the newline-joined list to the Deno /push endpoint.
# Aborts (keeps last good push) if fewer than MIN_KEEP nodes survive filtering.
#
# All secrets come from environment variables (set by select_and_push.sh):
#   PUSH_URL, PUSH_KEY, SUBS_OUTPUT (optional), PICK_VLESS (optional), PICK_OTHER (optional),
#   GENERAL_CAP (optional), MIN_KEEP (optional)

import os
import sys
import base64
import urllib.parse
import urllib.request
import urllib.error

PUSH_URL = os.environ.get("PUSH_URL", "").strip()
PUSH_KEY = os.environ.get("PUSH_KEY", "").strip()
OUTPUT = os.environ.get("SUBS_OUTPUT", os.path.expanduser("~/nodepipe/bin/output/all.yaml"))
PICK_VLESS = int(os.environ.get("PICK_VLESS", "30"))
PICK_OTHER = int(os.environ.get("PICK_OTHER", "30"))
GENERAL_CAP = int(os.environ.get("GENERAL_CAP", "50"))
MIN_KEEP = int(os.environ.get("MIN_KEEP", "10"))
LOGFILE = os.path.expanduser("~/nodepipe/logs/push.log")

# 历史节点"三振出局"参数：连续几次没在测活结果里出现，就从"每次强制重测"名单里除名，
# 转入被动归档池（只有真正凑不够数的时候才作为垫底候选）。
HISTORY_MISS_LIMIT = 3
HISTORY_FILE = os.path.expanduser("~/nodepipe/state/node_history.json")
# 写到 subs-check 的 output-dir 下,靠它自带的 8199 文件服务对外提供,
# 再把这个 URL 加进 sub-urls,下一轮 subs-check 就会真的把这些节点纳入重测。
RECENT_RETEST_FILE = os.path.expanduser("~/nodepipe/bin/output/recent_history.txt")

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
    s = "".join(ch for ch in name if ch.isascii())  # drop flag emoji
    s = s.lstrip("|").strip()
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


def has_cl(name: str) -> bool:
    # subs-check 的 media-check 给解锁 Claude 的节点名里加 "CL-" 标签。
    # 不再拿它当硬过滤(那样一次 media-check 抖动就可能清零所有节点),
    # 只用来在同一个桶内把"已验证能用 Claude"的节点排到前面。
    return "CL-" in name


def sort_key(p: dict):
    name = str(p.get("name", ""))
    return (0 if has_cl(name) else 1, region_rank(name))


def is_excluded(name: str) -> bool:
    if country_of(name) in EXCLUDE:
        return True
    upper = name.upper()
    return any(kw in name or kw in upper for kw in EXCLUDE_KEYWORDS)


STATE_DIR = os.path.expanduser("~/nodepipe/state")
CACHE_FILE = os.path.join(STATE_DIR, "last_good.json")


def load_json(path: str) -> dict:
    try:
        import json
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_json(path: str, data: dict):
    try:
        import json
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"WARN: failed to save {path}: {e}")


def load_cache() -> dict:
    return load_json(CACHE_FILE)


def save_cache(data: dict):
    save_json(CACHE_FILE, data)


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


def identity_of(p: dict) -> str:
    return f"{p.get('type')}:{p.get('server')}:{p.get('port')}"


def bucket_of(p: dict) -> str:
    return "vless" if p.get("type") == "vless" else "other"


def update_node_history(candidates: list) -> dict:
    """
    三振出局逻辑：
    - 本轮出现的节点 -> streak_miss 归零，记下最新 URI/名字。
    - 历史记录里本轮没出现的 -> streak_miss += 1。
    - streak_miss 在 1~(HISTORY_MISS_LIMIT-1) 之间 -> 视为"最近三次内还活过"，
      写入 recent_history.txt 让 subs-check 下一轮把它带回去真正重测。
    - streak_miss >= HISTORY_MISS_LIMIT -> 移出重测名单（不再每轮强制测），
      但记录本身保留在 history 里，作为最后兜底的候选来源。
    """
    history = load_json(HISTORY_FILE)
    now = __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M")
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
            "bucket": bucket_of(p),
            "last_uri": uri,
            "last_name": str(p.get("name", "")),
            "last_seen": now,
            "streak_miss": 0,
            "appearances": entry.get("appearances", 0) + 1,
        })
        history[ident] = entry

    for ident, entry in history.items():
        if ident in fresh_ids:
            continue
        entry["streak_miss"] = entry.get("streak_miss", 0) + 1

    save_json(HISTORY_FILE, history)

    retest_lines = []
    for ident, entry in history.items():
        if ident in fresh_ids:
            continue
        miss = entry.get("streak_miss", 0)
        if 0 < miss < HISTORY_MISS_LIMIT and entry.get("last_uri"):
            retest_lines.append(entry["last_uri"])

    try:
        os.makedirs(os.path.dirname(RECENT_RETEST_FILE), exist_ok=True)
        with open(RECENT_RETEST_FILE, "w", encoding="utf-8") as f:
            if retest_lines:
                f.write("\n".join(retest_lines) + "\n")
        log(f"--- node history: {len(retest_lines)} recently-alive node(s) queued for retest "
            f"via recent_history.txt ---")
    except Exception as e:
        log(f"WARN: failed to write {RECENT_RETEST_FILE}: {e}")

    return history


def archived_uris_for_bucket(history: dict, bucket: str, exclude_ids: set, limit: int) -> list:
    """从三振出局归档池里取最后已知可用的 URI 当垫底候选(未在本轮重新验证过)。
    只有前面'新鲜结果 + last_good 桶缓存'两层都还凑不够数时才会用到。"""
    if limit <= 0:
        return []
    items = [
        (ident, e) for ident, e in history.items()
        if e.get("bucket") == bucket
        and e.get("streak_miss", 0) >= HISTORY_MISS_LIMIT
        and ident not in exclude_ids
        and e.get("last_uri")
    ]
    items.sort(key=lambda kv: region_rank(kv[1].get("last_name", "")))
    return [e["last_uri"] for _, e in items[:limit]]


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

    history = update_node_history(candidates)

    vless_pool = [p for p in candidates if p.get("type") == "vless"]
    other_pool = [p for p in candidates if p.get("type") in ("anytls", "trojan")]
    vless_pool.sort(key=sort_key)
    other_pool.sort(key=sort_key)
    vless_picked = vless_pool[:PICK_VLESS]
    other_picked = other_pool[:PICK_OTHER]

    def build_list(picked_list):
        out = []
        for p in picked_list:
            builder = BUILDERS[p.get("type")]
            uri = builder(p)
            if uri:
                out.append(uri)
                log(f"  [{'CL' if has_cl(str(p.get('name',''))) else '--'}]"
                    f"[{region_rank(str(p.get('name','')))}] [{p.get('type')}] {p.get('name','')}")
        return out

    log(f"--- picking up to {PICK_VLESS}+{PICK_OTHER} (general cap {GENERAL_CAP}) of {len(candidates)} available "
        f"(vless bucket {min(len(vless_pool),PICK_VLESS)}/{len(vless_pool)}, "
        f"other bucket {min(len(other_pool),PICK_OTHER)}/{len(other_pool)}) ---")
    vless_uris_fresh = build_list(vless_picked)
    other_uris_fresh = build_list(other_picked)

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

    used_archive_vless = 0
    used_archive_other = 0
    if len(vless_uris) < PICK_VLESS:
        picked_ids = {identity_of(p) for p in vless_picked}
        fill = archived_uris_for_bucket(history, "vless", picked_ids, PICK_VLESS - len(vless_uris))
        if fill:
            used_archive_vless = len(fill)
            vless_uris = vless_uris + fill
            log(f"WARN: vless bucket still short, topping up with {len(fill)} archived (unretested) node(s)")
    if len(other_uris) < PICK_OTHER:
        picked_ids = {identity_of(p) for p in other_picked}
        fill = archived_uris_for_bucket(history, "other", picked_ids, PICK_OTHER - len(other_uris))
        if fill:
            used_archive_other = len(fill)
            other_uris = other_uris + fill
            log(f"WARN: other bucket still short, topping up with {len(fill)} archived (unretested) node(s)")

    uris = vless_uris + other_uris

    if len(uris) > GENERAL_CAP:
        def uri_region(u: str) -> int:
            try:
                frag = urllib.parse.unquote(u.rsplit("#", 1)[-1])
            except Exception:
                frag = ""
            return region_rank(frag)
        uris.sort(key=uri_region)
        dropped = len(uris) - GENERAL_CAP
        uris = uris[:GENERAL_CAP]
        log(f"--- combined total {len(vless_uris)+len(other_uris)} exceeds GENERAL_CAP={GENERAL_CAP}, "
            f"dropped {dropped} lowest-region-priority node(s) ---")

    from collections import Counter
    region_tally = Counter(region_rank(str(p.get("name", ""))) for p in candidates)
    us_n, eu_n, as_n, ot_n = region_tally.get(1, 0), region_tally.get(2, 0), region_tally.get(3, 0), region_tally.get(4, 0)
    proto_tally = Counter(p.get("type") for p in candidates)
    proto_picked_tally = Counter(p.get("type") for p in (vless_picked + other_picked))
    log(f"--- pool had: vless={proto_tally.get('vless',0)} anytls={proto_tally.get('anytls',0)} "
        f"trojan={proto_tally.get('trojan',0)} (total {len(candidates)}) ---")
    log(f"--- picked breakdown: vless={proto_picked_tally.get('vless',0)} "
        f"anytls={proto_picked_tally.get('anytls',0)} trojan={proto_picked_tally.get('trojan',0)} "
        f"| US={us_n} EU={eu_n} ASIA={as_n} other={ot_n} "
        f"| archive-filled: vless+{used_archive_vless} other+{used_archive_other} ---")

    if len(uris) < MIN_KEEP:
        log(f"ERROR: only {len(uris)} nodes built (< MIN_KEEP={MIN_KEEP}). "
            f"Skipping push, keeping last good set on Deno.")
        sys.exit(1)

    real_uri_count = len(uris)
    import datetime
    fallback_note = ""
    if used_vless_fallback and used_other_fallback:
        fallback_note = " ⚠全部为缓存"
    elif used_vless_fallback:
        fallback_note = " ⚠vless为缓存"
    elif used_other_fallback:
        fallback_note = " ⚠其他为缓存"
    if used_archive_vless or used_archive_other:
        fallback_note += " ⚠含归档节点"
    stamp = datetime.datetime.now().strftime("更新于 %Y-%m-%d %H:%M") + fallback_note
    marker_frag = urllib.parse.quote(stamp)
    marker_uri = f"vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?encryption=none&security=none&type=tcp#{marker_frag}"
    uris.append(marker_uri)
    log(f"  [marker] appended timestamp node: {stamp}")

    raw = ("\n".join(uris) + "\n").encode("utf-8")
    body = base64.b64encode(raw)
    req = urllib.request.Request(
        PUSH_URL, data=body, method="POST",
        headers={"Authorization": f"Bearer {PUSH_KEY}", "Content-Type": "text/plain; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            log(f"PUSH OK HTTP {resp.status}: {resp.read().decode('utf-8','ignore')[:200]}")

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
                    cf.write("time,available,picked,us,eu,asia,other,vless,anytls,trojan,archive_filled\n")
                cf.write(
                    f"{now_str},"
                    f"{len(candidates)},{real_uri_count},{us_n},{eu_n},{as_n},{ot_n},"
                    f"{proto_tally.get('vless',0)},{proto_tally.get('anytls',0)},{proto_tally.get('trojan',0)},"
                    f"{used_archive_vless+used_archive_other}\n"
                )
    except urllib.error.HTTPError as e:
        log(f"PUSH FAIL HTTP {e.code}: {e.read().decode('utf-8','ignore')[:200]}")
        sys.exit(1)
    except Exception as e:
        log(f"PUSH ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/opt/local/bin/python3.12
# -*- coding: utf-8 -*-
# Reads subs-check output (clash yaml), rebuilds vless:// / anytls:// / trojan:// URIs,
# picks up to PICK_TOTAL nodes with priority US > Europe > Asia (then others),
# and POSTs the newline-joined list to the Deno /push endpoint.
# Aborts (keeps last good push) if fewer than MIN_KEEP nodes survive filtering.
#
# All secrets come from environment variables (set by select_and_push.sh):
#   PUSH_URL, PUSH_KEY, SUBS_OUTPUT (optional), PICK_TOTAL (optional), MIN_KEEP (optional)

import os
import sys
import base64
import urllib.parse
import urllib.request
import urllib.error

PUSH_URL = os.environ.get("PUSH_URL", "").strip()
PUSH_KEY = os.environ.get("PUSH_KEY", "").strip()
OUTPUT = os.environ.get("SUBS_OUTPUT", os.path.expanduser("~/nodepipe/bin/output/all.yaml"))
PICK_TOTAL = int(os.environ.get("PICK_TOTAL", "15"))
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

    # sort by region priority; within same region keep subs-check order (already quality-sorted)
    candidates.sort(key=lambda p: region_rank(str(p.get("name", ""))))
    picked = candidates[:PICK_TOTAL]

    uris = []
    log(f"--- picking {len(picked)} of {len(candidates)} available ---")
    for p in picked:
        builder = BUILDERS[p.get("type")]
        uri = builder(p)
        if uri:
            uris.append(uri)
            log(f"  [{region_rank(str(p.get('name','')))}] [{p.get('type')}] {p.get('name','')}")

    from collections import Counter
    region_tally = Counter(region_rank(str(p.get("name", ""))) for p in candidates)
    us_n, eu_n, as_n, ot_n = region_tally.get(1, 0), region_tally.get(2, 0), region_tally.get(3, 0), region_tally.get(4, 0)
    proto_tally = Counter(p.get("type") for p in candidates)
    proto_picked_tally = Counter(p.get("type") for p in picked)
    log(f"--- protocol breakdown: pool {dict(proto_tally)} | picked {dict(proto_picked_tally)} ---")

    # Safety guard: if too few nodes survive filtering, don't push a starved
    # list — keep whatever the Deno side already has (better than breaking
    # everyone's connection with e.g. 2 nodes).
    if len(uris) < MIN_KEEP:
        log(f"ERROR: only {len(uris)} nodes built (< MIN_KEEP={MIN_KEEP}). "
            f"Skipping push, keeping last good set on Deno.")
        sys.exit(1)

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
            import datetime
            csv_path = os.path.expanduser("~/nodepipe/logs/history.csv")
            new_file = not os.path.exists(csv_path)
            with open(csv_path, "a", encoding="utf-8") as cf:
                if new_file:
                    cf.write("time,available,picked,us,eu,asia,other,vless,anytls,trojan\n")
                cf.write(
                    f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')},"
                    f"{len(candidates)},{len(uris)},{us_n},{eu_n},{as_n},{ot_n},"
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

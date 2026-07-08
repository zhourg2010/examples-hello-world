#!/opt/local/bin/python3.12
# -*- coding: utf-8 -*-
# Reads subs-check output (clash yaml), rebuilds vless:// URIs,
# picks up to PICK_TOTAL nodes with priority US > Europe > Asia (then others),
# and POSTs the newline-joined vless list to the Deno /push endpoint.
#
# All secrets come from environment variables (set by select_and_push.sh):
#   PUSH_URL, PUSH_KEY, SUBS_OUTPUT (optional), PICK_TOTAL (optional)

import os
import sys
import base64
import urllib.parse
import urllib.request
import urllib.error

PUSH_URL = os.environ.get("PUSH_URL", "").strip()
PUSH_KEY = os.environ.get("PUSH_KEY", "").strip()
OUTPUT = os.environ.get("SUBS_OUTPUT", os.path.expanduser("~/nodepipe/bin/output/all.yaml"))
PICK_TOTAL = int(os.environ.get("PICK_TOTAL", "10"))
LOGFILE = os.path.expanduser("~/nodepipe/logs/push.log")

# Region priority by country code found in node name (subs-check rename format: e.g. US_24, GB_4, JP_5)
US = {"US"}
EUROPE = {"GB", "ES", "DE", "FR", "NL", "IT", "SE", "CH", "PL", "RU", "TR", "IE", "FI", "NO", "DK", "AT", "BE", "PT", "RO", "UA"}
ASIA = {"JP", "KR", "TW", "SG", "MY", "TH", "VN", "PH", "ID", "IN"}
EXCLUDE = {"HK", "MO"}  # never select Hong Kong / Macau


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


def main():
    if not PUSH_URL or not PUSH_KEY:
        log("ERROR: PUSH_URL / PUSH_KEY not set. Abort.")
        sys.exit(1)
    if not os.path.exists(OUTPUT):
        log(f"ERROR: output not found: {OUTPUT}")
        sys.exit(1)

    proxies = load_yaml(OUTPUT)
    vless_nodes = [p for p in proxies if p.get("type") == "vless"
                   and country_of(str(p.get("name",""))) not in EXCLUDE]
    if not vless_nodes:
        log("No vless nodes in output. Nothing to push.")
        sys.exit(0)

    # sort by region priority; within same region keep subs-check order (already quality-sorted)
    vless_nodes.sort(key=lambda p: region_rank(str(p.get("name", ""))))
    picked = vless_nodes[:PICK_TOTAL]

    uris = []
    log(f"--- picking {len(picked)} of {len(vless_nodes)} available ---")
    for p in picked:
        uri = build_vless(p)
        if uri:
            uris.append(uri)
            log(f"  [{region_rank(str(p.get('name','')))}] {p.get('name','')}")

    from collections import Counter
    tally = Counter(region_rank(str(p.get("name", ""))) for p in vless_nodes)
    us_n, eu_n, as_n, ot_n = tally.get(1, 0), tally.get(2, 0), tally.get(3, 0), tally.get(4, 0)

    if not uris:
        log("Failed to build any vless URI. Abort.")
        sys.exit(1)

    # base64-encode the list (standard subscription format for v2rayN/Shadowrocket;
    # sing-box conversion on the Deno side base64-decodes first, so this works for both)
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
                    cf.write("time,available,picked,us,eu,asia,other\n")
                cf.write(f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')},{len(vless_nodes)},{len(uris)},{us_n},{eu_n},{as_n},{ot_n}\n")
    except urllib.error.HTTPError as e:
        log(f"PUSH FAIL HTTP {e.code}: {e.read().decode('utf-8','ignore')[:200]}")
        sys.exit(1)
    except Exception as e:
        log(f"PUSH ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

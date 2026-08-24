#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""archive_sub.py — 把上游订阅源的原始内容归档一份。只增不删,供以后手工翻旧节点。

取代原来的 archive_sub.sh(bash + curl 专有)。

跟测活/推送那条主链路完全无关,是个独立的小工具:哪天想找"上个月那个特别快的节点
现在还在不在",可以来 archive/ 目录里翻。跑不跑都不影响订阅正常工作。

用法:
    python3 archive_sub.py
"""

import sys
import datetime
import urllib.request
import urllib.error

from common import HOME, ensure_dirs, load_env, log as _log
import os

LOG = "archive"


def log(msg):
    _log(LOG, f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}")


def main():
    ensure_dirs()
    load_env()

    sub_url = os.environ.get("SUB_URL", "").strip()
    if not sub_url:
        log("ERROR: SUB_URL 没设置(应该在 nodepipe/env 里)。")
        sys.exit(1)

    archive_dir = HOME / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M")

    ok = 0
    urls = [u.strip() for u in sub_url.split(",") if u.strip()]
    for i, url in enumerate(urls, 1):
        # 多个订阅源各存一个文件,文件名带序号,避免互相覆盖。
        out = archive_dir / (f"sub_{ts}.txt" if len(urls) == 1 else f"sub_{ts}_{i}.txt")
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                data = resp.read()
            if not data:
                log(f"归档失败(内容为空): 第 {i} 个源")
                continue
            out.write_bytes(data)
            log(f"已归档: {out}({len(data)} 字节)")
            ok += 1
        except Exception as e:
            log(f"归档失败: 第 {i} 个源 — {e}")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

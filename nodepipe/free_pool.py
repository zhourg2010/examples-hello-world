#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""free_pool.py — 把 Deno 上的免费节点池拉到本地,交给 subs-check 去实测。

为什么要有这一步
--------------
免费节点池是在服务端(Deno Deploy)定期抓的,抓到的是**没实测过**的候选:免费节点大半
是死的,而 Deno Deploy 上没有代理内核、拨不了这些节点,活性/速度/严格美国 GeoIP 这些
它一样都判断不了。这些活儿本来就在本地这一侧 —— subs-check 已经在做了。

所以这个脚本只做一件很小的事:把池子拉下来,写成一个本地文件,让 subs-check 把它当成
一个**普通订阅源**去测。走的是 run_once.py 里那个已经在跑的本地只读文件服务
(127.0.0.1:8299),跟"三振出局重测名单"用的是同一套机制,不用再造一个。

拉下来的节点名字里已经带好了 FREE 前导词(服务端 free/naming.ts 在入库时打的),
一路测下来、被选中、推回 Deno、最后到家人客户端里,前缀都还在。

用法:
    python3 free_pool.py            # 拉一次,写到 RETEST_DIR/free_pool.txt
    python3 free_pool.py --dry      # 只看拉到多少,不写文件

环境变量(nodepipe/env 里配):
    PUSH_URL       必填。跟推送用的是同一个域名,这里会把末尾的 /push 换成 /free/pool
    PUSH_KEY       必填。免费池接口复用推送密钥鉴权
    FREE_LIMIT     最多拉几条,默认 400
    FREE_PER_CRED  每套凭据最多几条,默认 3
    FREE_DAYS      只要最近几天还出现过的,默认 7
    FREE_PROTOS    协议白名单,逗号分隔,留空是全部
"""

import os
import sys
import base64
import urllib.parse
import urllib.request
import urllib.error

from common import RETEST_DIR, ensure_dirs, load_env, log as _log

LOG = "free"

# subs-check 会去拉这个文件名。改的话 gen_config.py 里那条 sub-url 要一起改。
POOL_FILE = "free_pool.txt"


def log(msg):
    _log(LOG, msg)


def pool_url() -> str:
    """从 PUSH_URL 推出免费池接口地址。

    两者永远在同一个部署上,让用户再配一个 FREE_URL 纯属多一个能配错的地方。
    """
    push = os.environ.get("PUSH_URL", "").strip()
    if not push:
        return ""
    p = urllib.parse.urlsplit(push)
    return urllib.parse.urlunsplit((p.scheme, p.netloc, "/free/pool", "", ""))


def fetch_pool() -> str:
    """拉池子,返回一行一个的分享链接文本。失败抛异常,由调用方决定怎么处理。"""
    base = pool_url()
    key = os.environ.get("PUSH_KEY", "").strip()
    if not base:
        raise RuntimeError("没有配置 PUSH_URL,推不出免费池的地址")
    if not key:
        raise RuntimeError("没有配置 PUSH_KEY,免费池接口需要它鉴权")

    q = {
        "limit": os.environ.get("FREE_LIMIT", "400"),
        "perCred": os.environ.get("FREE_PER_CRED", "3"),
        "days": os.environ.get("FREE_DAYS", "7"),
        "format": "uris",
    }
    protos = os.environ.get("FREE_PROTOS", "").strip()
    if protos:
        q["protos"] = protos

    url = f"{base}?{urllib.parse.urlencode(q)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def main():
    load_env()
    ensure_dirs()
    dry = "--dry" in sys.argv

    try:
        text = fetch_pool()
    except urllib.error.HTTPError as e:
        # 401 单独说一句,不然只看到个数字很难想到是密钥的事
        hint = "(PUSH_KEY 跟服务端不一致?)" if e.code == 401 else ""
        log(f"ERROR: 拉免费池失败 HTTP {e.code} {hint}")
        return 1
    except Exception as e:
        log(f"ERROR: 拉免费池失败: {e}")
        return 1

    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        # 空池子不算错:可能是刚部署还没抓过,也可能是所有源今天都挂了。
        # 但**不能**把空文件写下去覆盖上一份 —— 那样这一轮 subs-check 就白测了。
        log("WARN: 池子是空的,保留上一次的文件不动")
        return 0

    log(f"拉到 {len(lines)} 条免费节点")
    if dry:
        for l in lines[:5]:
            log(f"  {l[:100]}")
        return 0

    # subs-check 吃标准订阅(整段 base64),跟 recent_history.txt 那条路一致
    out = RETEST_DIR / POOL_FILE
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = base64.b64encode("\n".join(lines).encode("utf-8")).decode("ascii")
    out.write_text(payload, encoding="utf-8")
    log(f"已写入 {out}({len(lines)} 条),下一轮 subs-check 会把它当订阅源测一遍")
    return 0


if __name__ == "__main__":
    sys.exit(main())

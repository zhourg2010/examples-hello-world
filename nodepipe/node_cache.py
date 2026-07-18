#!/opt/local/bin/python3.12
# -*- coding: utf-8 -*-
# node_cache.py — 追踪每个节点(按 type:server:port 识别)的出现历史。
# 给"连接稳定性/寿命"这个维度用:一个节点在最近这么多轮推送里反复出现,
# 说明它背后的机器/线路是长期稳定的,不是昙花一现的临时IP。
#
# 只负责记录和查询,不做任何筛选/推送决策——select_and_push.py 调用它,
# 拿到统计结果后自己决定怎么用(现在的用法是拼进节点名字里,当一个"|"badge)。

import os
import sqlite3
import datetime

DB_PATH = os.path.expanduser("~/nodepipe/state/node_cache.db")


def _connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS nodes (
            identity TEXT PRIMARY KEY,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            appearances INTEGER NOT NULL DEFAULT 0
        )
    """)
    return conn


def identity_of(proto: str, server: str, port) -> str:
    return f"{proto}:{server}:{port}"


def record_and_stats(candidates: list) -> dict:
    """
    candidates: 本轮测速通过、待选的 proxy dict 列表(subs-check clash yaml 解出来的),
    每个至少要有 type/server/port。

    每条记一笔"这次也出现了"(appearances 累加,first_seen 只在第一次出现时写入),
    返回 {identity: {"appearances": int, "first_seen_days_ago": int}}。
    """
    now = datetime.datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    conn = _connect()
    stats = {}
    try:
        for p in candidates:
            proto = str(p.get("type", ""))
            server = str(p.get("server", ""))
            port = p.get("port", "")
            if not (proto and server and port):
                continue
            ident = identity_of(proto, server, port)
            row = conn.execute(
                "SELECT first_seen, appearances FROM nodes WHERE identity=?", (ident,)
            ).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO nodes (identity, first_seen, last_seen, appearances) VALUES (?,?,?,1)",
                    (ident, now_str, now_str),
                )
                first_seen, appearances = now_str, 1
            else:
                first_seen, appearances = row[0], row[1] + 1
                conn.execute(
                    "UPDATE nodes SET last_seen=?, appearances=? WHERE identity=?",
                    (now_str, appearances, ident),
                )
            first_dt = datetime.datetime.strptime(first_seen, "%Y-%m-%d %H:%M:%S")
            days_ago = max(0, (now - first_dt).days)
            stats[ident] = {"appearances": appearances, "first_seen_days_ago": days_ago}
        conn.commit()
    finally:
        conn.close()
    return stats


def prune_stale(keep_days: int = 60):
    """清掉太久没再见过的记录(比如订阅源早就不提供的老节点),免得数据库一直涨。
    可选调用,不调用不影响主流程,不会导致数据丢失(只清真正很久没出现的)。"""
    conn = _connect()
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=keep_days)).strftime("%Y-%m-%d %H:%M:%S")
    try:
        conn.execute("DELETE FROM nodes WHERE last_seen < ?", (cutoff,))
        conn.commit()
    finally:
        conn.close()

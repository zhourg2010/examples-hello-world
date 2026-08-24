// db.ts — Neon Postgres:日志归档 + 看板查询。
// 连接串放环境变量 DATABASE_URL(不入代码)。Neon 没配置时整个日志归档自动降级,不影响订阅。

import { neon } from "jsr:@neon/serverless";
import { getUnarchivedLogs, type LogEntry, setFlushedSeq, trimLogs } from "./kv.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL") ?? "";
export const dbEnabled = !!DATABASE_URL;
// deno-lint-ignore no-explicit-any
const sql: any = dbEnabled ? neon(DATABASE_URL) : null;

const FLUSH_THRESHOLD = 50; // 攒够这么多未归档就刷一次

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (!sql || tableReady) return;
  await sql`CREATE TABLE IF NOT EXISTS access_log (
    seq BIGINT PRIMARY KEY,
    username TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    ip TEXT,
    ua TEXT
  )`;
  // tag 是 2026-08 加的(记录访问的是哪条格式链接)。已经建好的表用 ADD COLUMN 补上,
  // IF NOT EXISTS 保证重复执行无害;老数据这一列是 NULL,查询侧当"未知"处理。
  await sql`ALTER TABLE access_log ADD COLUMN IF NOT EXISTS tag TEXT`;
  await sql`ALTER TABLE access_log ADD COLUMN IF NOT EXISTS hwid TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_access_user_ts ON access_log (username, ts DESC)`;
  tableReady = true;
}

// 检查并刷入(由 subscribe 在记录后异步调用)
export async function maybeFlush(): Promise<void> {
  // 未配置 Neon:退化为滚动裁剪,不归档
  if (!sql) {
    await trimLogs(false);
    return;
  }
  const pending: LogEntry[] = await getUnarchivedLogs();
  if (pending.length < FLUSH_THRESHOLD) return;

  await ensureTable();
  const maxSeq = pending[pending.length - 1].seq;

  // 批量插入,主键(seq)冲突忽略 → 幂等,重复刷入无害
  await sql.transaction(
    pending.map((p: LogEntry) =>
      sql`INSERT INTO access_log (seq, username, ts, ip, ua, tag, hwid)
          VALUES (${p.seq}, ${p.username}, to_timestamp(${p.ts / 1000}), ${p.ip}, ${p.ua},
                  ${p.tag ?? ""}, ${p.hwid ?? ""})
          ON CONFLICT (seq) DO NOTHING`
    ),
  );

  await setFlushedSeq(maxSeq); // 成功后才推进游标
  await trimLogs(true);        // 归档成功才允许裁剪这批
}

// ========== 看板查询 ==========
export interface UserStats {
  total: number;
  days: Array<{ day: string; n: number }>;   // 近7天每日计数
  ips: Array<{ ip: string; n: number; last: string }>; // 近30天IP
  uas: string[];                              // 近30天出现过的 client 类型
}

export async function userStats(username: string): Promise<UserStats | null> {
  if (!sql) return null;
  await ensureTable();
  const days = await sql`
    SELECT to_char(date_trunc('day', ts),'MM-DD') AS day, count(*)::int AS n
    FROM access_log
    WHERE username = ${username} AND ts >= now() - interval '7 days'
    GROUP BY 1 ORDER BY 1`;
  const ips = await sql`
    SELECT ip, count(*)::int AS n, to_char(max(ts),'YYYY-MM-DD HH24:MI') AS last
    FROM access_log
    WHERE username = ${username} AND ts >= now() - interval '30 days'
    GROUP BY ip ORDER BY max(ts) DESC LIMIT 20`;
  const uas = await sql`
    SELECT DISTINCT ua FROM access_log
    WHERE username = ${username} AND ts >= now() - interval '30 days'`;
  const total = await sql`SELECT count(*)::int AS n FROM access_log WHERE username = ${username}`;
  return {
    total: total[0]?.n ?? 0,
    days: days as Array<{ day: string; n: number }>,
    ips: ips as Array<{ ip: string; n: number; last: string }>,
    uas: (uas as Array<{ ua: string }>).map((r) => r.ua),
  };
}

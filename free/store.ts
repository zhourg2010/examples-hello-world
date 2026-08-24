// free/store.ts — 免费节点池的存储层。Neon Postgres。
//
// 关于"服务器端的 SQLite"
// ----------------------
// 这个服务跑在 Deno Deploy 上,**没有可持久化的文件系统**:isolate 是无状态的,冷启动
// 会换一台机器,写到本地的 .db 文件下一次请求就不见了。所以服务器端的 SQLite 文件这条路
// 在当前部署形态下走不通 —— 不是麻烦,是根本存不住。
//
// 能持久化的只有两样:Deno KV(已经用来存节点池和设备)和 Neon Postgres(已经用来归档
// 访问日志,连接串就是现成的 DATABASE_URL)。这里选 Neon,原因:
//   - 免费池是几千行带多个维度的记录,要按 cred_id 分组、按 last_seen 排序、按来源统计,
//     这是关系型查询,KV 的键值扫描做起来很别扭
//   - DATABASE_URL 已经配好了,不用新开任何基础设施
//   - 抓取战报要留历史,方便看某个源是从哪天开始坏的
//
// 本地那份 SQLite(nodepipe/node_cache.py)保持不动,它记的是另一件事(节点在历次推送里
// 的出现次数),两者不冲突。
//
// 没配 DATABASE_URL 时整个模块降级成"什么都不做":抓取会照跑并把结果报给调用方,
// 只是不落库。跟 db.ts 的降级策略一致,不会因为免费池把订阅主链路带崩。

import { neon } from "jsr:@neon/serverless";

const DATABASE_URL = Deno.env.get("DATABASE_URL") ?? "";
export const freeStoreEnabled = !!DATABASE_URL;
// deno-lint-ignore no-explicit-any
const sql: any = freeStoreEnabled ? neon(DATABASE_URL) : null;

export interface FreeNode {
  uriHash: string;
  uri: string;
  proto: string;
  name: string;
  server: string;
  port: number;
  endpointId: string;
  credId: string;
  sourceId: string;
}

export interface PoolRow extends FreeNode {
  firstSeen: string;
  lastSeen: string;
  seenCount: number;
}

let ready = false;
async function ensureTables(): Promise<void> {
  if (!sql || ready) return;
  await sql`CREATE TABLE IF NOT EXISTS free_node (
    uri_hash    TEXT PRIMARY KEY,
    uri         TEXT NOT NULL,
    proto       TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    server      TEXT NOT NULL,
    port        INTEGER NOT NULL,
    endpoint_id TEXT NOT NULL,
    cred_id     TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    seen_count  INTEGER NOT NULL DEFAULT 1
  )`;
  // cred_id 上的索引是给"每套凭据最多取几条"那个限流用的(见 identity.ts 里 CF 扇出那段)
  await sql`CREATE INDEX IF NOT EXISTS idx_free_cred ON free_node (cred_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_free_last ON free_node (last_seen DESC)`;
  // 每轮抓取的战报。留着是为了能回答"这个源是从哪天开始不出货的"——免费源说没就没,
  // 没有历史的话只能看到"今天为止都是 0",看不出是今天坏的还是坏了半个月。
  await sql`CREATE TABLE IF NOT EXISTS free_harvest (
    id        BIGSERIAL PRIMARY KEY,
    ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_id TEXT NOT NULL,
    ok        BOOLEAN NOT NULL,
    parsed    INTEGER NOT NULL DEFAULT 0,
    kept      INTEGER NOT NULL DEFAULT 0,
    err       TEXT NOT NULL DEFAULT ''
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_free_harvest_ts ON free_harvest (ts DESC)`;
  ready = true;
}

/** URI 的 SHA-256,当主键。URI 本身可能上千字符(vmess 的 base64),不适合直接做索引键。 */
export async function hashUri(uri: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uri));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 一条 INSERT 塞多少行。Neon 走 HTTP,一次请求一个语句,所以用 unnest 批量插比
// 一行一条快几个数量级;但单条语句的参数体积也不能无限大,分批。
const CHUNK = 500;

/**
 * 批量写入/更新。已经存在的(同一条 URI)只更新 last_seen 和 seen_count。
 *
 * seen_count 是个有用的稳定性信号:一个节点连着十几轮抓取都在,说明背后的机器是长期
 * 在跑的;只出现过一次的多半是别人测试完就撤了。跟 node_cache.py 里 appearances 一个意思。
 */
export async function upsertNodes(nodes: FreeNode[]): Promise<number> {
  if (!sql || nodes.length === 0) return 0;
  await ensureTables();
  let n = 0;
  for (let i = 0; i < nodes.length; i += CHUNK) {
    const b = nodes.slice(i, i + CHUNK);
    await sql`
      INSERT INTO free_node (uri_hash, uri, proto, name, server, port, endpoint_id, cred_id, source_id)
      SELECT * FROM unnest(
        ${b.map((x) => x.uriHash)}::text[],
        ${b.map((x) => x.uri)}::text[],
        ${b.map((x) => x.proto)}::text[],
        ${b.map((x) => x.name)}::text[],
        ${b.map((x) => x.server)}::text[],
        ${b.map((x) => x.port)}::int[],
        ${b.map((x) => x.endpointId)}::text[],
        ${b.map((x) => x.credId)}::text[],
        ${b.map((x) => x.sourceId)}::text[]
      )
      ON CONFLICT (uri_hash) DO UPDATE SET
        last_seen  = now(),
        seen_count = free_node.seen_count + 1,
        source_id  = EXCLUDED.source_id`;
    n += b.length;
  }
  return n;
}

export async function recordHarvest(
  sourceId: string,
  ok: boolean,
  parsed: number,
  kept: number,
  err: string,
): Promise<void> {
  if (!sql) return;
  await ensureTables();
  await sql`INSERT INTO free_harvest (source_id, ok, parsed, kept, err)
            VALUES (${sourceId}, ${ok}, ${parsed}, ${kept}, ${err.slice(0, 500)})`;
}

function toRow(r: Record<string, unknown>): PoolRow {
  return {
    uriHash: String(r.uri_hash),
    uri: String(r.uri),
    proto: String(r.proto),
    name: String(r.name ?? ""),
    server: String(r.server),
    port: Number(r.port),
    endpointId: String(r.endpoint_id),
    credId: String(r.cred_id),
    sourceId: String(r.source_id),
    firstSeen: String(r.first_seen),
    lastSeen: String(r.last_seen),
    seenCount: Number(r.seen_count),
  };
}

/**
 * 取节点池,给下游实测用。
 *
 * perCred 是**这个函数存在的理由**:每套凭据最多取几条。不限的话,一个源的 CF 扇出
 * (同一套凭据 × 一千多个边缘 IP)会把整个返回集占满,别的源一条都排不进来。
 * 排序用 seen_count DESC —— 反复出现过的优先,它们更可能还活着。
 */
export async function getPool(
  opts: { limit?: number; perCred?: number; protos?: string[]; freshDays?: number } = {},
): Promise<PoolRow[]> {
  if (!sql) return [];
  await ensureTables();
  const limit = opts.limit ?? 2000;
  const perCred = opts.perCred ?? 3;
  const freshDays = opts.freshDays ?? 7;
  const protos = opts.protos ?? [];

  const rows = await sql`
    SELECT * FROM (
      SELECT *, row_number() OVER (
        PARTITION BY cred_id ORDER BY seen_count DESC, last_seen DESC
      ) AS rn
      FROM free_node
      WHERE last_seen >= now() - (${freshDays}::int * interval '1 day')
        AND (${protos.length === 0}::boolean OR proto = ANY(${protos}::text[]))
    ) t
    WHERE rn <= ${perCred}
    ORDER BY seen_count DESC, last_seen DESC
    LIMIT ${limit}`;
  return (rows as Record<string, unknown>[]).map(toRow);
}

export interface PoolStats {
  total: number;
  creds: number;
  byProto: Array<{ proto: string; n: number }>;
  bySource: Array<{ source: string; n: number; last: string }>;
  recent: Array<{ ts: string; source: string; ok: boolean; parsed: number; kept: number; err: string }>;
}

export async function poolStats(): Promise<PoolStats | null> {
  if (!sql) return null;
  await ensureTables();
  const total = await sql`SELECT count(*)::int AS n, count(DISTINCT cred_id)::int AS c FROM free_node`;
  const byProto = await sql`SELECT proto, count(*)::int AS n FROM free_node GROUP BY proto ORDER BY n DESC`;
  const bySource = await sql`
    SELECT source_id AS source, count(*)::int AS n, to_char(max(last_seen),'MM-DD HH24:MI') AS last
    FROM free_node GROUP BY source_id ORDER BY n DESC`;
  const recent = await sql`
    SELECT to_char(ts,'MM-DD HH24:MI') AS ts, source_id AS source, ok, parsed, kept, err
    FROM free_harvest ORDER BY ts DESC LIMIT 40`;
  return {
    total: total[0]?.n ?? 0,
    creds: total[0]?.c ?? 0,
    byProto: byProto as PoolStats["byProto"],
    bySource: bySource as PoolStats["bySource"],
    recent: recent as PoolStats["recent"],
  };
}

/** 清掉很久没再出现的节点。免费源的节点寿命普遍很短,不清的话表会一直涨。 */
export async function prune(keepDays = 30): Promise<number> {
  if (!sql) return 0;
  await ensureTables();
  const r = await sql`
    WITH d AS (DELETE FROM free_node WHERE last_seen < now() - (${keepDays}::int * interval '1 day') RETURNING 1)
    SELECT count(*)::int AS n FROM d`;
  await sql`DELETE FROM free_harvest WHERE ts < now() - interval '90 days'`;
  return r[0]?.n ?? 0;
}

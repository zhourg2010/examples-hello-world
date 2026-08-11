// kv.ts — 所有数据库(Deno KV)操作收口在此。
// 别的文件不直接碰 KV,一律调用这里的函数。将来改存储结构只动这一个文件。

import { NODE_HISTORY } from "./config.ts";

const kv = await Deno.openKv();

// ---------- 类型 ----------
export interface Device {
  username: string;
  id: string;
  enabled: boolean;
  note?: string;
  format?: "base64" | "singbox" | "clash"; // 默认订阅返回格式(不带客户端标签的旧链接走这个),默认 base64
  created?: number;
  lastSeen?: number; // 最后一次拉订阅的时间(功能3:访问侦测)
  hits?: number;     // 累计拉取次数
  usEnabled?: boolean; // 是否激活了 /us 隐藏链接(美国节点组,默认关闭,后台按钮/建设备时勾选开启)
}

// ---------- 设备 ----------
export async function listDevices(): Promise<Device[]> {
  const out: Device[] = [];
  for await (const e of kv.list<Omit<Device, "username">>({ prefix: ["device"] })) {
    out.push({ username: String(e.key[1]), ...e.value });
  }
  out.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  return out;
}

export async function getDevice(username: string): Promise<Device | null> {
  const r = await kv.get<Omit<Device, "username">>(["device", username]);
  return r.value ? { username, ...r.value } : null;
}

export async function addDevice(username: string, id: string, note: string, format: "base64" | "singbox" | "clash" = "base64", usEnabled = false): Promise<boolean> {
  if (!username) return false;
  if ((await kv.get(["device", username])).value) return false; // 已存在
  await kv.set(["device", username], { id, enabled: true, note, format, usEnabled, created: Date.now(), hits: 0 });
  return true;
}

export async function setDevice(username: string, patch: Partial<Device>): Promise<void> {
  const cur = await getDevice(username);
  if (!cur) return;
  const { username: _u, ...rest } = { ...cur, ...patch };
  await kv.set(["device", username], rest);
}

export async function deleteDevice(username: string): Promise<void> {
  await kv.delete(["device", username]);
}

// 功能3:记录一次成功的订阅拉取(异步、尽力而为,不阻塞返回)
export async function recordHit(username: string): Promise<void> {
  const cur = await getDevice(username);
  if (!cur) return;
  const { username: _u, ...rest } = cur;
  await kv.set(["device", username], {
    ...rest,
    lastSeen: Date.now(),
    hits: (cur.hits ?? 0) + 1,
  });
}

// ---------- 节点 ----------
export async function getNodes(): Promise<string> {
  return (await kv.get<string>(["nodes"])).value ?? "";
}

export async function getNodesUpdated(): Promise<number> {
  return (await kv.get<number>(["nodes_updated"])).value ?? 0;
}

// ---------- US 节点组(/us 隐藏链接,见 routes/subscribe.ts + nodepipe/us_archive.py) ----------
// 跟主节点池是完全独立的另一份数据:Mac mini 那边有一份永久保留的"历史美国节点档案",
// 按最近一次成功(subs-check 测活通过 或 TCP 探测能连上)排序取前50推到这里。
// 不留历史版本——真正的数据源头是 Mac mini 上的 us_archive.json,这里只是镜像。
export async function getUsNodes(): Promise<string> {
  return (await kv.get<string>(["us_nodes"])).value ?? "";
}

export async function getUsNodesUpdated(): Promise<number> {
  return (await kv.get<number>(["us_nodes_updated"])).value ?? 0;
}

export async function saveUsNodes(content: string): Promise<void> {
  await kv.set(["us_nodes"], content);
  await kv.set(["us_nodes_updated"], Date.now());
}

// 功能1:保存节点前,先把当前版本存一份历史快照(用于恢复上一版)。
//
// 之前的实现是把全部历史快照塞进*同一个* KV value(一个 string[] 数组),NODE_HISTORY=5
// 意味着最多同时存5份完整快照在一个 value 里——GENERAL_CAP 从10提到50之后,单份快照
// 本身变大了几倍,5份加起来就超过了 Deno KV 单个 value 65536 字节的硬上限,导致 saveNodes
// 直接抛 "Value too large" 把整次 /push 搞挂(这是2026-08已经在生产上真实炸过一次的bug)。
// 现在改成:每份快照各自存成独立的 key(["nodes_history", 时间戳]),上限不再是"5份快照
// 加起来"而是"每一份快照自己"要小于65536字节——不管以后节点数量/GENERAL_CAP怎么调整,
// 历史记录这块都不会再因为累积而撞上限。
async function nextHistorySeq(): Promise<number> {
  // 用严格递增的序号而不是时间戳排序——时间戳精度是毫秒,两次保存离得够近(比如手动连续
  // 点了两次"强制重测")会撞上同一毫秒,排序就会乱,进而删错该保留的记录(测试时真的复现过)。
  // 序号不依赖系统时钟精度,永远严格递增。
  const res = await kv.get<number>(["nodes_history_seq"]);
  const next = (res.value ?? 0) + 1;
  await kv.set(["nodes_history_seq"], next);
  return next;
}

async function trimHistory(): Promise<void> {
  const entries: { key: Deno.KvKey; seq: number }[] = [];
  for await (const e of kv.list<string>({ prefix: ["nodes_history"] })) {
    const seq = e.key[1] as number;
    entries.push({ key: e.key, seq });
  }
  entries.sort((a, b) => b.seq - a.seq); // 新的在前
  const toDelete = entries.slice(NODE_HISTORY);
  for (const e of toDelete) {
    await kv.delete(e.key);
  }
}

export async function saveNodes(content: string): Promise<void> {
  const prev = await getNodes();
  if (prev) {
    await kv.set(["nodes_history", await nextHistorySeq()], prev);
    await trimHistory();
  }
  await kv.set(["nodes"], content);
  await kv.set(["nodes_updated"], Date.now());
}

export async function getNodeHistory(): Promise<string[]> {
  const entries: { seq: number; value: string }[] = [];
  for await (const e of kv.list<string>({ prefix: ["nodes_history"] })) {
    if (e.value != null) entries.push({ seq: e.key[1] as number, value: e.value });
  }
  entries.sort((a, b) => b.seq - a.seq); // 新的在前,跟原来数组语义(unshift)保持一致
  return entries.map((e) => e.value);
}

// 恢复上一版:把最近的历史取出设为当前,当前再压回历史
export async function restorePrevNodes(): Promise<boolean> {
  const entries: { key: Deno.KvKey; seq: number; value: string }[] = [];
  for await (const e of kv.list<string>({ prefix: ["nodes_history"] })) {
    if (e.value != null) entries.push({ key: e.key, seq: e.key[1] as number, value: e.value });
  }
  if (entries.length === 0) return false;
  entries.sort((a, b) => b.seq - a.seq);
  const latest = entries[0];

  const cur = await getNodes();
  await kv.set(["nodes"], latest.value);
  await kv.set(["nodes_updated"], Date.now());
  await kv.delete(latest.key);
  if (cur) {
    await kv.set(["nodes_history", await nextHistorySeq()], cur);
  }
  await trimHistory();
  return true;
}

// ---------- 季度邮件标记 ----------
export async function claimQuarterFlag(quarter: string): Promise<boolean> {
  const key = ["sent", quarter];
  if ((await kv.get(key)).value) return false;
  const r = await kv.atomic().check({ key, versionstamp: null }).set(key, true).commit();
  return r.ok;
}

// ---------- 备份(功能2:导出/恢复) ----------
export interface Backup {
  version: 1;
  exportedAt: number;
  devices: Device[];
  nodes: string;
}

export async function exportBackup(): Promise<Backup> {
  return {
    version: 1,
    exportedAt: Date.now(),
    devices: await listDevices(),
    nodes: await getNodes(),
  };
}

// 恢复:用备份覆盖现有设备与节点(谨慎操作)
export async function importBackup(b: Backup): Promise<{ devices: number }> {
  if (!b || b.version !== 1 || !Array.isArray(b.devices)) {
    throw new Error("备份格式不正确");
  }
  // 清掉现有设备
  for await (const e of kv.list({ prefix: ["device"] })) await kv.delete(e.key);
  for (const d of b.devices) {
    const { username, ...rest } = d;
    await kv.set(["device", username], rest);
  }
  await kv.set(["nodes"], b.nodes ?? "");
  await kv.set(["nodes_updated"], Date.now());
  return { devices: b.devices.length };
}

// ========== 领取日志(KV 缓冲层,配合 Neon 归档) ==========
// 设计:每次领取写一条到 KV,带单调递增 seq。
// flushed_seq = 已归档进 Neon 的最大 seq。未归档 = seq > flushed_seq。
// 裁剪:只删"已归档且在最近100条之外"的;未归档绝不删(防 Neon 故障丢数据)。

export interface LogEntry {
  seq: number;
  username: string;
  ts: number;
  ip: string;
  ua: string;
}

const KEEP_RECENT = 100;

// 原子递增 seq 并写入一条日志
export async function appendLog(username: string, ip: string, ua: string): Promise<void> {
  while (true) {
    const cur = await kv.get<number>(["log_seq"]);
    const seq = (cur.value ?? 0) + 1;
    const r = await kv.atomic()
      .check(cur)
      .set(["log_seq"], seq)
      .set(["log", seq], { username, ts: Date.now(), ip, ua })
      .commit();
    if (r.ok) break; // 冲突则重试
  }
}

export async function getLogState(): Promise<{ logSeq: number; flushedSeq: number }> {
  const logSeq = (await kv.get<number>(["log_seq"])).value ?? 0;
  const flushedSeq = (await kv.get<number>(["flushed_seq"])).value ?? 0;
  return { logSeq, flushedSeq };
}

// 取所有未归档日志(按 seq 升序)
export async function getUnarchivedLogs(): Promise<LogEntry[]> {
  const { flushedSeq } = await getLogState();
  const out: LogEntry[] = [];
  for await (const e of kv.list<Omit<LogEntry, "seq">>({ prefix: ["log"] })) {
    const seq = Number(e.key[1]);
    if (seq > flushedSeq) out.push({ seq, ...e.value });
  }
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

// 推进归档游标(只前进不后退)
export async function setFlushedSeq(seq: number): Promise<void> {
  const cur = (await kv.get<number>(["flushed_seq"])).value ?? 0;
  if (seq > cur) await kv.set(["flushed_seq"], seq);
}

// 某用户最近 n 条领取记录(从 KV 缓冲取,最多扫 ~100 条)
export async function getRecentLogsForUser(username: string, n: number): Promise<LogEntry[]> {
  const all: LogEntry[] = [];
  for await (const e of kv.list<Omit<LogEntry, "seq">>({ prefix: ["log"] })) {
    if (e.value.username === username) all.push({ seq: Number(e.key[1]), ...e.value });
  }
  all.sort((a, b) => b.seq - a.seq);
  return all.slice(0, n);
}

// 裁剪日志。dbEnabled=true:只删已归档且超出最近100条的;false:退化为滚动保留最近100
export async function trimLogs(dbEnabled: boolean): Promise<void> {
  const { logSeq, flushedSeq } = await getLogState();
  const keepFrom = logSeq - KEEP_RECENT;
  for await (const e of kv.list({ prefix: ["log"] })) {
    const seq = Number(e.key[1]);
    if (seq > keepFrom) continue;                 // 最近100条保留
    if (dbEnabled && seq > flushedSeq) continue;  // 未归档保留(防丢)
    await kv.delete(e.key);
  }
}

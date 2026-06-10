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
  created?: number;
  lastSeen?: number; // 最后一次拉订阅的时间(功能3:访问侦测)
  hits?: number;     // 累计拉取次数
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

export async function addDevice(username: string, id: string, note: string): Promise<boolean> {
  if (!username) return false;
  if ((await kv.get(["device", username])).value) return false; // 已存在
  await kv.set(["device", username], { id, enabled: true, note, created: Date.now(), hits: 0 });
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

// 功能1:保存节点前,先把当前版本压入历史(用于恢复上一版)
export async function saveNodes(content: string): Promise<void> {
  const prev = await getNodes();
  if (prev) {
    const hist = (await kv.get<string[]>(["nodes_history"])).value ?? [];
    hist.unshift(prev);
    await kv.set(["nodes_history"], hist.slice(0, NODE_HISTORY));
  }
  await kv.set(["nodes"], content);
  await kv.set(["nodes_updated"], Date.now());
}

export async function getNodeHistory(): Promise<string[]> {
  return (await kv.get<string[]>(["nodes_history"])).value ?? [];
}

// 恢复上一版:把最近的历史取出设为当前,当前再压回历史
export async function restorePrevNodes(): Promise<boolean> {
  const hist = (await kv.get<string[]>(["nodes_history"])).value ?? [];
  if (hist.length === 0) return false;
  const prev = hist.shift()!;
  const cur = await getNodes();
  await kv.set(["nodes"], prev);
  await kv.set(["nodes_updated"], Date.now());
  if (cur) hist.unshift(cur);
  await kv.set(["nodes_history"], hist.slice(0, NODE_HISTORY));
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

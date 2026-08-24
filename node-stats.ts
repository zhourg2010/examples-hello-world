// node-stats.ts — 从 Mac mini 推上来的原始节点列表(base64)里解析出:
// 各协议数量(不含时间戳假节点),以及那个假节点名字里编码的"这批是什么时候推的/是否用了缓存兜底"。
// 给状态页(status pane)和后台链接列表的"实际节点数"用。

import { b64decode } from "./singbox.ts";
import { ALL_PROTOS, type Proto } from "./formats.ts";

export interface NodeStats {
  byProto: Record<Proto, number>;
  total: number; // 真实节点数,不含时间戳假节点
  batchLabel: string | null; // 从假节点名解出来的,如 "更新于 2026-08-24 10:30 ⚠含归档节点"
}

// 时间戳假节点固定用这个 uuid+server 前缀(见 nodepipe/select_and_push.py 里的 marker_uri)
const MARKER_PREFIX = "vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1";
// 后台"停用"的节点会加这个前缀(见 ui.ts),统计里不应该把它们算进协议计数。
const OFF_PREFIX = "#OFF# ";

export function emptyStats(): NodeStats {
  return { byProto: { vless: 0, anytls: 0, trojan: 0, vmess: 0, ss: 0 }, total: 0, batchLabel: null };
}

export function computeNodeStats(raw: string): NodeStats {
  const stats = emptyStats();

  let text = raw.trim();
  if (!/(vmess|vless|trojan|anytls|ss|ssr):\/\//i.test(text)) {
    const dec = b64decode(text);
    if (dec) text = dec;
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.startsWith(OFF_PREFIX)) continue; // 已停用,不计入统计
    if (line.startsWith(MARKER_PREFIX)) {
      const h = line.indexOf("#");
      if (h >= 0) {
        try { stats.batchLabel = decodeURIComponent(line.slice(h + 1)); } catch { stats.batchLabel = line.slice(h + 1); }
      }
      continue; // 假节点本身不算进协议统计
    }
    for (const p of ALL_PROTOS) {
      if (line.startsWith(`${p}://`)) { stats.byProto[p]++; stats.total++; break; }
    }
  }

  return stats;
}

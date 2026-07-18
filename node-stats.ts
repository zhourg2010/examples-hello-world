// node-stats.ts — 从 Mac mini 推上来的原始节点列表(base64)里解析出:
// 各协议数量(不含时间戳假节点),以及那个假节点名字里编码的"这批是什么时候推的/是否用了缓存兜底"。
// 给状态页(status pane)用。

import { b64decode } from "./singbox.ts";

export interface NodeStats {
  vless: number;
  anytls: number;
  trojan: number;
  total: number; // 真实节点数,不含时间戳假节点
  batchLabel: string | null; // 从假节点名解出来的,如 "更新于 2026-07-18 06:00 ⚠vless为缓存"
}

// 时间戳假节点固定用这个 uuid+server 前缀(见 nodepipe/select_and_push.py 里的 marker_uri)
const MARKER_PREFIX = "vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1";

export function computeNodeStats(raw: string): NodeStats {
  let text = raw.trim();
  if (!/(vmess|vless|trojan|anytls|ss|ssr):\/\//i.test(text)) {
    const dec = b64decode(text);
    if (dec) text = dec;
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let vless = 0, anytls = 0, trojan = 0;
  let batchLabel: string | null = null;

  for (const line of lines) {
    if (line.startsWith(MARKER_PREFIX)) {
      const h = line.indexOf("#");
      if (h >= 0) {
        try { batchLabel = decodeURIComponent(line.slice(h + 1)); } catch { batchLabel = line.slice(h + 1); }
      }
      continue; // 假节点本身不算进协议统计
    }
    if (line.startsWith("vless://")) vless++;
    else if (line.startsWith("anytls://")) anytls++;
    else if (line.startsWith("trojan://")) trojan++;
  }

  return { vless, anytls, trojan, total: vless + anytls + trojan, batchLabel };
}

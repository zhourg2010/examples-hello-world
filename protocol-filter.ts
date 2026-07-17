// protocol-filter.ts — 按协议前缀筛选节点列表。
// 用途:某些客户端(如 V2Box/Xray-core、v2rayN 当前版本)不支持 anytls,
// 给它们的订阅链接需要把 anytls:// 节点摘掉,只保留 vless:// / trojan:// 等。
// 输入输出都是"标准订阅格式"(整段 base64),跟 kv.ts 里存的、subscribe.ts 原来直接返回的格式一致。

import { b64decode } from "./singbox.ts";

export function filterAndReencode(raw: string, allowedPrefixes: string[]): string {
  let text = raw.trim();
  if (!allowedPrefixes.some((p) => text.startsWith(p)) && !/(vmess|vless|trojan|anytls|ss|ssr):\/\//i.test(text)) {
    const dec = b64decode(text);
    if (dec) text = dec;
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const kept = lines.filter((l) => allowedPrefixes.some((p) => l.startsWith(p)));
  const joined = kept.join("\n") + (kept.length ? "\n" : "");
  // 节点 URI 全部是百分号编码过的 ASCII,btoa 可以直接用,不需要处理多字节字符。
  return btoa(joined);
}

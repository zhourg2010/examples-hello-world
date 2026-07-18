// protocol-filter.ts — 按协议前缀筛选节点列表。
// 用途:某些客户端(如 V2Box/Xray-core、v2rayN 当前版本)不支持 anytls,
// 给它们的订阅链接需要把 anytls:// 节点摘掉,只保留 vless:// / trojan:// 等。
// 输入输出都是"标准订阅格式"(整段 base64),跟 kv.ts 里存的、subscribe.ts 原来直接返回的格式一致。

import { b64decode } from "./singbox.ts";

// 后台"节点内容"编辑器里禁用某个节点时,给这一行加这个前缀存回去(而不是真的删掉/单独另存)。
// 好处:管理页能继续看到并重新启用它;其它所有解析器(singbox.ts/clash.ts/这个文件自己的过滤)
// 认不出这个前缀,天然会跳过——只有"面向客户端的原始 base64 格式"需要显式再过滤一层,见 stripDisabled()。
export const OFF_PREFIX = "#OFF# ";

// 面向客户端的订阅内容(不管哪种格式)在返回前都要先过一遍这个,把禁用节点物理剔除掉,
// 不能只是在管理页面"看起来"禁用。
export function stripDisabled(raw: string): string {
  let text = raw.trim();
  if (!text) return raw;
  const looksEncoded = !/(vmess|vless|trojan|anytls|ss|ssr):\/\//i.test(text) && !text.startsWith(OFF_PREFIX);
  if (looksEncoded) {
    const dec = b64decode(text);
    if (dec) text = dec;
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const kept = lines.filter((l) => !l.startsWith(OFF_PREFIX));
  if (kept.length === lines.length) return raw; // 没有禁用节点,原样返回,省一次编解码
  const joined = kept.join("\n") + (kept.length ? "\n" : "");
  return btoa(joined);
}

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

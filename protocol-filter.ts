// protocol-filter.ts — 按协议前缀筛选节点列表 + 按订阅类型截断节点数量上限。
// 用途:某些客户端(如 V2Box/Xray-core、v2rayN 当前版本)不支持 anytls,
// 给它们的订阅链接需要把 anytls:// 节点摘掉,只保留 vless:// / trojan:// 等。
// 输入输出都是"标准订阅格式"(整段 base64),跟 kv.ts 里存的、subscribe.ts 原来直接返回的格式一致。

import { b64decode } from "./singbox.ts";

// 时间戳假节点(select_and_push.py 追加的,指向 127.0.0.1:1,连不通,纯粹告诉家人
// "这批是什么时候推的")。截断节点数量时要把它单独摘出来,截完之后再放回末尾,
// 不能被当成普通节点一起被数量上限砍掉——不然被截断的链接就再也看不到更新时间了。
const MARKER_RE = /@127\.0\.0\.1:1[/?]/;

function decodeToLines(raw: string): string[] {
  let text = raw.trim();
  if (!/(vmess|vless|trojan|anytls|ss|ssr):\/\//i.test(text)) {
    const dec = b64decode(text);
    if (dec) text = dec;
  }
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function reencode(lines: string[]): string {
  const joined = lines.join("\n") + (lines.length ? "\n" : "");
  // 节点 URI 全部是百分号编码过的 ASCII,btoa 可以直接用,不需要处理多字节字符。
  return btoa(joined);
}

// 后台"停用"某个节点时,ui.ts 存回 KV 前会给那一行加上 OFF_PREFIX 前缀(不是真的删除,
// 方便随时再启用)。任何返回给客户端的订阅内容,在别的处理之前都先经过这里,把这些行
// 整个剔除——不然 default/singbox/clash 这几条不做协议前缀过滤的链接会直接把
// "#OFF# vless://..." 这种半吊子行原样吐给客户端,不仅停用不生效,还会把下游解析搞坏。
const OFF_PREFIX = "#OFF# ";

export function stripDisabled(raw: string): string {
  const lines = decodeToLines(raw);
  const kept = lines.filter((l) => !l.startsWith(OFF_PREFIX));
  return reencode(kept);
}

export function filterAndReencode(raw: string, allowedPrefixes: string[]): string {
  const lines = decodeToLines(raw);
  const kept = lines.filter((l) => allowedPrefixes.some((p) => l.startsWith(p)));
  return reencode(kept);
}

// 按"订阅类型"的节点数量上限截断(default 链接 50 / 每个客户端标签链接 30,见 subscribe.ts)。
// 时间戳标记节点不计入上限,也不会被截掉。
export function capNodeCount(raw: string, limit: number): string {
  const lines = decodeToLines(raw);
  const markers = lines.filter((l) => MARKER_RE.test(l));
  const real = lines.filter((l) => !MARKER_RE.test(l));
  const kept = real.length > limit ? real.slice(0, limit) : real;
  return reencode([...kept, ...markers]);
}

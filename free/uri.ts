// free/uri.ts — Clash proxy 字典 → 分享链接 URI。
//
// 为什么要转成 URI 而不是把 Clash 字典原样存起来
// --------------------------------------------
// 分享链接是这个仓库里的**通用中间格式**:KV 里存的是 base64 的 URI 列表,/push 收的是
// 它,formats.ts 下面 clash / sing-box / surge / QuantumultX / Loon 全部都是从它渲染出来的。
// 免费节点只要落成 URI,后面整条链路一行都不用改就能用上。存 Clash 字典的话,等于要在
// 每个渲染器旁边再开一条"从字典渲染"的支路,两套逻辑迟早会走偏。
//
// 这里的实现刻意跟 nodepipe/select_and_push.py 里的 build_vless / build_anytls /
// build_trojan **保持字段一致**(同样的 query 参数名、同样的取值优先级),这样不管节点
// 是本地测速推上来的还是免费源抓来的,落到客户端里长得一模一样。
//
// 协议范围:只做 vless / trojan / vmess / ss / anytls 这五个 —— 也就是 formats.ts 里
// Proto 已经定义、下游每个渲染器都认的那五个。免费源里还有 hysteria2 / tuic / hysteria /
// http,**故意不做**:它们要能一路走到客户端,得先把 Proto 联合类型、五个渲染器、
// protocol-filter 全部拓宽,那是另一件事,不该顺手塞进来。抓取时会把丢掉的数量按协议
// 记下来(见 harvest.ts 的 droppedByProto),想加的时候一眼能看到值不值得。

import type { Proxy } from "./parse.ts";
import type { Proto } from "../formats.ts";

/** 这里能转的协议。跟 formats.ts 的 ALL_PROTOS 对齐。 */
export const SUPPORTED: readonly Proto[] = ["vless", "trojan", "vmess", "ss", "anytls"];

function s(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

/** Clash 里 shadowsocks 的 type 写作 "ss";别的源偶尔写全称。统一成 formats.ts 的口径。 */
export function normalizeType(raw: unknown): Proto | "" {
  const t = s(raw).toLowerCase();
  if (t === "ss" || t === "shadowsocks") return "ss";
  if (t === "vless" || t === "trojan" || t === "vmess" || t === "anytls") return t;
  return "";
}

function qs(q: Record<string, string>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== "") u.set(k, v);
  return u.toString();
}

function frag(p: Proxy): string {
  return encodeURIComponent(s(p.name));
}

/** ws / grpc / h2 的传输层参数,vless 和 trojan 共用同一套写法。 */
function transportParams(p: Proxy, net: string, q: Record<string, string>): void {
  if (net === "ws") {
    const ws = (p["ws-opts"] ?? {}) as Record<string, unknown>;
    if (ws.path) q.path = s(ws.path);
    const h = (ws.headers ?? {}) as Record<string, unknown>;
    const host = s(h.Host) || s(h.host);
    if (host) q.host = host;
  } else if (net === "grpc") {
    const g = (p["grpc-opts"] ?? {}) as Record<string, unknown>;
    if (g["grpc-service-name"]) q.serviceName = s(g["grpc-service-name"]);
  }
}

function buildVless(p: Proxy): string {
  const uuid = s(p.uuid), server = s(p.server), port = s(p.port);
  if (!uuid || !server || !port) return "";
  const net = s(p.network) || "tcp";
  const q: Record<string, string> = { encryption: "none", type: net };

  const reality = (p["reality-opts"] ?? {}) as Record<string, unknown>;
  if (reality && Object.keys(reality).length) {
    q.security = "reality";
    if (reality["public-key"]) q.pbk = s(reality["public-key"]);
    if (reality["short-id"]) q.sid = s(reality["short-id"]);
  } else if (p.tls) {
    q.security = "tls";
  } else {
    q.security = "none";
  }

  const sni = s(p.servername) || s(p.sni);
  if (sni) q.sni = sni;
  if (p["client-fingerprint"]) q.fp = s(p["client-fingerprint"]);
  if (p.flow) q.flow = s(p.flow);
  transportParams(p, net, q);
  return `vless://${uuid}@${server}:${port}?${qs(q)}#${frag(p)}`;
}

function buildTrojan(p: Proxy): string {
  const pw = s(p.password), server = s(p.server), port = s(p.port);
  if (!pw || !server || !port) return "";
  const q: Record<string, string> = {};
  const sni = s(p.sni) || s(p.servername);
  if (sni) q.sni = sni;
  if (p["skip-cert-verify"]) q.allowInsecure = "1";
  const net = s(p.network) || "tcp";
  if (net && net !== "tcp") {
    q.type = net;
    transportParams(p, net, q);
  }
  return `trojan://${encodeURIComponent(pw)}@${server}:${port}?${qs(q)}#${frag(p)}`;
}

function buildAnytls(p: Proxy): string {
  const pw = s(p.password), server = s(p.server), port = s(p.port);
  if (!pw || !server || !port) return "";
  const q: Record<string, string> = {};
  const sni = s(p.sni) || s(p.servername);
  if (sni) q.sni = sni;
  q.insecure = p["skip-cert-verify"] ? "1" : "0";
  return `anytls://${encodeURIComponent(pw)}@${server}:${port}/?${qs(q)}#${frag(p)}`;
}

/** UTF-8 安全的 base64(节点名里有中文,btoa 直接吃会抛 InvalidCharacterError)。 */
function b64utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function buildVmess(p: Proxy): string {
  const id = s(p.uuid), add = s(p.server), port = s(p.port);
  if (!id || !add || !port) return "";
  const net = s(p.network) || "tcp";
  const ws = (p["ws-opts"] ?? {}) as Record<string, unknown>;
  const wsH = (ws.headers ?? {}) as Record<string, unknown>;
  const grpc = (p["grpc-opts"] ?? {}) as Record<string, unknown>;

  // 字段名是 vmess 分享链接的既定写法(v/ps/add/port/id/aid/scy/net/host/path/tls/sni/fp),
  // 跟 singbox.ts 的 parseVmess 读的是同一套 —— 改这里要同步看那边。
  const o: Record<string, unknown> = {
    v: "2",
    ps: s(p.name),
    add,
    port: String(port),
    id,
    aid: String(p.alterId ?? p.alterid ?? 0),
    scy: s(p.cipher) || "auto",
    net,
    type: "none",
    host: net === "ws" ? (s(wsH.Host) || s(wsH.host)) : s(p.servername),
    path: net === "grpc" ? s(grpc["grpc-service-name"]) : (s(ws.path) || ""),
    tls: p.tls ? "tls" : "",
  };
  if (p.servername) o.sni = s(p.servername);
  if (p["client-fingerprint"]) o.fp = s(p["client-fingerprint"]);
  // 注意:vmess 分享链接**不带 #fragment**。节点名在 JSON 里的 ps 字段,链接本体是
  // 纯 base64;后面挂一个 #name 会被解码方连着一起 base64 解码,整条链接直接解析失败。
  // (singbox.ts 的 parseVmess 就是 b64decode(uri.slice(8)),不剥 # —— 真实数据上验过,
  //  带 # 的话 62 个 vmess 一个都活不下来。)
  return `vmess://${b64utf8(JSON.stringify(o))}`;
}

function buildSS(p: Proxy): string {
  const method = s(p.cipher), pw = s(p.password), server = s(p.server), port = s(p.port);
  if (!method || !server || !port) return "";
  // SIP002 的用户信息部分:base64(method:password)。singbox.ts 的 parseSS 两种写法都认,
  // 这里挑兼容性最好的那种(base64 用户信息 + @host:port)。
  return `ss://${b64utf8(`${method}:${pw}`)}@${server}:${port}#${frag(p)}`;
}

const BUILDERS: Record<Proto, (p: Proxy) => string> = {
  vless: buildVless,
  trojan: buildTrojan,
  anytls: buildAnytls,
  vmess: buildVmess,
  ss: buildSS,
};

/**
 * 转成分享链接。转不了(协议不在支持范围、或缺关键字段)返回空串。
 * 调用方应该把空串当"跳过"处理并计数,不要静默丢。
 */
export function toUri(p: Proxy): string {
  const t = normalizeType(p.type);
  if (!t) return "";
  try {
    return BUILDERS[t](p);
  } catch {
    return "";
  }
}

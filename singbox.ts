// singbox.ts — base64 节点列表 → sing-box 客户端 JSON。
// 支持 vmess / vless(含 reality) / trojan / shadowsocks(ss)。自动跳过 ssr 及无法解析的节点。
// 设计:服务器实时转换,用户那头只维护 base64 一份。

// deno-lint-ignore-file no-explicit-any
type Outbound = Record<string, any> & { tag: string; type: string };

function b64decode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/").trim();
  while (s.length % 4) s += "=";
  try {
    return decodeURIComponent(escape(atob(s)));
  } catch {
    try { return atob(s); } catch { return ""; }
  }
}

function nameOr(fallback: string, raw?: string): string {
  const n = (raw ?? "").trim();
  return n || fallback;
}

function q(search: string): Record<string, string> {
  const p: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) p[k] = v;
  return p;
}

function parseVmess(uri: string, idx: number): Outbound | null {
  const json = b64decode(uri.slice(8));
  if (!json) return null;
  let o: any;
  try { o = JSON.parse(json); } catch { return null; }
  if (!o.add || !o.port || !o.id) return null;
  const ob: Outbound = {
    type: "vmess",
    tag: nameOr(`vmess-${idx}`, o.ps),
    server: String(o.add),
    server_port: Number(o.port),
    uuid: String(o.id),
    alter_id: Number(o.aid ?? 0),
    security: o.scy || "auto",
  };
  if (String(o.tls || "") === "tls") {
    ob.tls = { enabled: true, server_name: o.sni || o.host || o.add, utls: { enabled: true, fingerprint: o.fp || "chrome" } };
  }
  const net = String(o.net || "tcp");
  if (net === "ws") ob.transport = { type: "ws", path: o.path || "/", ...(o.host ? { headers: { Host: [o.host] } } : {}) };
  else if (net === "grpc") ob.transport = { type: "grpc", service_name: o.path || "" };
  else if (net === "h2" || net === "http") ob.transport = { type: "http", ...(o.host ? { host: [o.host] } : {}), path: o.path || "/" };
  return ob;
}

function parseVless(uri: string, idx: number): Outbound | null {
  try {
    const u = new URL(uri);
    const p = q(u.search.slice(1));
    const ob: Outbound = {
      type: "vless",
      tag: nameOr(`vless-${idx}`, decodeURIComponent(u.hash.slice(1))),
      server: u.hostname,
      server_port: Number(u.port),
      uuid: decodeURIComponent(u.username),
    };
    if (!ob.server || !ob.server_port || !ob.uuid) return null;
    if (p.flow) ob.flow = p.flow;
    const sec = p.security || "none";
    if (sec === "tls" || sec === "reality") {
      ob.tls = { enabled: true, server_name: p.sni || p.host || u.hostname, utls: { enabled: true, fingerprint: p.fp || "chrome" } };
      if (sec === "reality") ob.tls.reality = { enabled: true, public_key: p.pbk || "", short_id: p.sid || "" };
    }
    const net = p.type || "tcp";
    if (net === "ws") ob.transport = { type: "ws", path: p.path || "/", ...(p.host ? { headers: { Host: [p.host] } } : {}) };
    else if (net === "grpc") ob.transport = { type: "grpc", service_name: p.serviceName || p.path || "" };
    else if (net === "http" || net === "h2") ob.transport = { type: "http", ...(p.host ? { host: [p.host] } : {}), path: p.path || "/" };
    return ob;
  } catch { return null; }
}

function parseTrojan(uri: string, idx: number): Outbound | null {
  try {
    const u = new URL(uri);
    const p = q(u.search.slice(1));
    const ob: Outbound = {
      type: "trojan",
      tag: nameOr(`trojan-${idx}`, decodeURIComponent(u.hash.slice(1))),
      server: u.hostname,
      server_port: Number(u.port),
      password: decodeURIComponent(u.username),
      tls: { enabled: true, server_name: p.sni || p.host || u.hostname, utls: { enabled: true, fingerprint: p.fp || "chrome" } },
    };
    if (!ob.server || !ob.server_port || !ob.password) return null;
    const net = p.type || "tcp";
    if (net === "ws") ob.transport = { type: "ws", path: p.path || "/", ...(p.host ? { headers: { Host: [p.host] } } : {}) };
    else if (net === "grpc") ob.transport = { type: "grpc", service_name: p.serviceName || p.path || "" };
    return ob;
  } catch { return null; }
}

function parseSS(uri: string, idx: number): Outbound | null {
  try {
    let rest = uri.slice(5);
    let name = "";
    const h = rest.indexOf("#");
    if (h >= 0) { name = decodeURIComponent(rest.slice(h + 1)); rest = rest.slice(0, h); }
    const qi = rest.indexOf("?");
    if (qi >= 0) rest = rest.slice(0, qi); // 丢弃 plugin 等(sing-box obfs 另算,这里简化)
    let method = "", password = "", server = "", port = 0;
    if (rest.includes("@")) {
      const at = rest.lastIndexOf("@");
      const userPart = rest.slice(0, at);
      const hostPart = rest.slice(at + 1);
      const dec = b64decode(userPart) || decodeURIComponent(userPart);
      const c = dec.indexOf(":");
      method = dec.slice(0, c); password = dec.slice(c + 1);
      const lc = hostPart.lastIndexOf(":");
      server = hostPart.slice(0, lc); port = Number(hostPart.slice(lc + 1));
    } else {
      const dec = b64decode(rest);
      const at = dec.lastIndexOf("@");
      const cred = dec.slice(0, at); const hostPart = dec.slice(at + 1);
      const c = cred.indexOf(":");
      method = cred.slice(0, c); password = cred.slice(c + 1);
      const lc = hostPart.lastIndexOf(":");
      server = hostPart.slice(0, lc); port = Number(hostPart.slice(lc + 1));
    }
    if (!server || !port || !method) return null;
    return { type: "shadowsocks", tag: nameOr(`ss-${idx}`, name), server, server_port: port, method, password };
  } catch { return null; }
}

export function parseNodes(input: string): Outbound[] {
  let text = input.trim();
  if (!/(vmess|vless|trojan|ss|ssr):\/\//i.test(text)) {
    const dec = b64decode(text);
    if (dec) text = dec; // 输入是整段 base64,先解码
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: Outbound[] = [];
  let i = 0;
  for (const line of lines) {
    let ob: Outbound | null = null;
    if (line.startsWith("vmess://")) ob = parseVmess(line, i);
    else if (line.startsWith("vless://")) ob = parseVless(line, i);
    else if (line.startsWith("trojan://")) ob = parseTrojan(line, i);
    else if (line.startsWith("ss://")) ob = parseSS(line, i);
    // ssr:// 及其它 → 跳过
    if (ob) { out.push(ob); i++; }
  }
  return out;
}

export function toSingboxJson(input: string): string {
  const nodes = parseNodes(input);

  // tag 去重(sing-box 要求唯一)
  const seen = new Map<string, number>();
  for (const n of nodes) {
    if (seen.has(n.tag)) { const c = seen.get(n.tag)! + 1; seen.set(n.tag, c); n.tag = `${n.tag}-${c}`; }
    else seen.set(n.tag, 0);
  }
  const proxyTags = nodes.map((n) => n.tag);

  const config = {
    log: { level: "warn", timestamp: true },
    dns: {
      servers: [
        { tag: "remote", address: "tls://8.8.8.8" },
        { tag: "local", address: "223.5.5.5", detour: "direct" },
      ],
      rules: [{ outbound: "any", server: "local" }],
      strategy: "prefer_ipv4",
    },
    inbounds: [
      { type: "tun", tag: "tun-in", inet4_address: "172.19.0.1/30", auto_route: true, strict_route: true, stack: "system", sniff: true },
      { type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 },
    ],
    outbounds: [
      { type: "selector", tag: "select", outbounds: ["auto", ...proxyTags, "direct"], default: "auto" },
      { type: "urltest", tag: "auto", outbounds: proxyTags, url: "http://www.gstatic.com/generate_204", interval: "3m", tolerance: 50 },
      ...nodes,
      { type: "direct", tag: "direct" },
      { type: "dns", tag: "dns-out" },
    ],
    route: {
      rules: [
        { protocol: "dns", outbound: "dns-out" },
        { ip_is_private: true, outbound: "direct" },
      ],
      final: "select",
      auto_detect_interface: true,
    },
  };
  return JSON.stringify(config, null, 2);
}

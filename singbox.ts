// singbox.ts — base64 节点列表 → sing-box 客户端 JSON。
// 支持 vmess / vless(含 reality) / trojan / anytls / shadowsocks(ss)。自动跳过 ssr 及无法解析的节点。
// 设计:服务器实时转换,用户那头只维护 base64 一份。

// deno-lint-ignore-file no-explicit-any
type Outbound = Record<string, any> & { tag: string; type: string };

export function b64decode(s: string): string {
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

function parseAnytls(uri: string, idx: number): Outbound | null {
  // anytls://[password@]host[:port]/?[sni=...]&[insecure=0|1]#name
  // https://github.com/anytls/anytls-go/blob/main/docs/uri_scheme.md
  try {
    const u = new URL(uri);
    const p = q(u.search.slice(1));
    const ob: Outbound = {
      type: "anytls",
      tag: nameOr(`anytls-${idx}`, decodeURIComponent(u.hash.slice(1))),
      server: u.hostname,
      server_port: Number(u.port) || 443,
      password: decodeURIComponent(u.username),
    };
    if (!ob.server || !ob.password) return null;
    ob.tls = {
      enabled: true,
      server_name: p.sni || u.hostname,
      insecure: p.insecure === "1",
    };
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
  if (!/(vmess|vless|trojan|anytls|ss|ssr):\/\//i.test(text)) {
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
    else if (line.startsWith("anytls://")) ob = parseAnytls(line, i);
    else if (line.startsWith("ss://")) ob = parseSS(line, i);
    // ssr:// 及其它 → 跳过
    if (ob) { out.push(ob); i++; }
  }
  return out;
}

// sing-box 客户端配置骨架。字段按 sing-box 1.12/1.13 的 schema 写(1.11 之前的老写法多处已移除)。
//
// 2026-08 修掉的三个真问题(之前的版本会直接起不来或者规则完全不生效):
//  1. DoH 服务器写了 detour:"proxy",但 outbounds 里根本没有 tag 叫 proxy 的出站
//     (只有 select/auto/direct 和各节点名)。sing-box 校验出站引用时找不到就 FATAL,
//     整个配置起不来。现在指向真实存在的 select。
//  2. dns.rules 里用 domain:["geosite:cn"] / ["geosite:geolocation-!cn"]。geosite: 这个
//     前缀语法在 1.8 就废弃、1.12 已经彻底移除;写在 domain 字段里不会报错,但会被当成
//     一个"字面域名 geosite:cn"去精确匹配,永远匹配不上——两条规则等于完全没写,
//     所有查询都掉到 final 上。现在换成自包含的 domain_suffix 规则,不依赖任何
//     需要联网下载的远程 rule-set(远程 rule-set 首次下载失败会多出一个启动失败点,
//     对"发给家人直接用"的订阅来说不划算)。
//  3. type:"https" 的 DNS 服务器 server 写的是域名(dns.google),按 1.12 的新格式必须
//     有 domain_resolver 才能解析它自己(1.14 起是硬性要求)。现在显式指到 local。
const CN_DNS_SUFFIXES = [
  "cn", "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "baidu.com", "qq.com", "taobao.com", "tmall.com", "jd.com", "alipay.com",
  "aliyun.com", "alicdn.com", "bilibili.com", "weibo.com", "163.com",
  "126.com", "sohu.com", "sina.com.cn", "douyin.com", "bytedance.com",
  "xiaomi.com", "mi.com", "huawei.com", "wechat.com", "qpic.cn", "qlogo.cn",
];

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
    // urltest 的测速结果和 selector 选中的节点存盘,客户端重启后不用从头再测一遍。
    experimental: { cache_file: { enabled: true, store_fakeip: false } },
    dns: {
      // 1.12+ 的新 DNS server 格式(type + server,不再往 address 里塞 scheme 前缀)。
      servers: [
        {
          type: "https",
          tag: "remote",
          server: "dns.google",
          server_port: 443,
          path: "/dns-query",
          // 走代理查询,避免境外域名被本地 DNS 污染。必须指向真实存在的出站 tag。
          detour: "select",
          // server 是域名,需要先有人把它解析成 IP。指到 local(直连的 223.5.5.5),
          // 不会形成"要查 dns.google 得先查 dns.google"的死循环。
          domain_resolver: "local",
        },
        // 不写 detour —— sing-box 1.12+ 里把 detour 指向一个没有任何特殊配置的普通
        // direct 出站会被判定为"没有意义"直接 FATAL 拒绝启动。不写本来就是默认直连。
        { type: "udp", tag: "local", server: "223.5.5.5" },
      ],
      rules: [
        // 国内域名交给国内 DNS,解析快、拿得到就近 CDN。
        { domain_suffix: CN_DNS_SUFFIXES, server: "local" },
      ],
      // 其余(境外域名)默认走代理里的 DoH。这跟改之前正好相反——之前 final 是 local,
      // 加上那两条失效的 geosite 规则,实际效果是所有查询明文发给 223.5.5.5。
      final: "remote",
      strategy: "prefer_ipv4",
    },
    inbounds: [
      // sniff/domain_strategy 这些字段 1.13.0 已经从 inbound 里移除,改到 route.rules 里用 action 表达(见下)。
      { type: "tun", tag: "tun-in", address: ["172.19.0.1/30"], auto_route: true, strict_route: true, stack: "system" },
      { type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 },
    ],
    outbounds: [
      { type: "selector", tag: "select", outbounds: ["auto", ...proxyTags, "direct"], default: "auto" },
      { type: "urltest", tag: "auto", outbounds: proxyTags, url: "http://www.gstatic.com/generate_204", interval: "3m", tolerance: 50 },
      ...nodes,
      { type: "direct", tag: "direct" },
      // 注意:不再需要单独的 { type: "dns", tag: "dns-out" } 出站 —— "特殊出站" 写法
      // 1.13.0 已移除,DNS 劫持现在直接用下面 route.rules 里的 hijack-dns action。
    ],
    route: {
      rules: [
        // 替代原来 inbound.sniff:true(两个入站都要嗅探,所以不加 inbound 过滤条件)
        { action: "sniff" },
        // 替代原来的 dns 特殊出站 + protocol:"dns"路由规则组合
        { protocol: "dns", action: "hijack-dns" },
        { ip_is_private: true, outbound: "direct" },
      ],
      // 替代原来 dns.rules 里 { outbound: "any", server: "local" } 这条已废弃的写法:
      // 各出站自己做域名解析(比如给节点的 server 字段解析IP)时,默认走本地 DNS。
      default_domain_resolver: { server: "local" },
      final: "select",
      auto_detect_interface: true,
    },
  };
  return JSON.stringify(config, null, 2);
}

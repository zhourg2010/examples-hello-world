// free/identity.ts — 给免费节点算两种身份,用来去重。
//
// 为什么要两种
// -----------
// 拿真实数据量过一遍就知道了。Sub-Config-Extractor 的一个聚合文件里有 6037 个节点,
// 其中 6000 个是 vmess。看上去很壮观,实际上:
//
//     不同的 server 地址   1014 个   ← 全是 Cloudflare 的边缘 IP(104.18.x / 104.21.x)
//     不同的 uuid             4 个
//     不同的 servername       5 个
//
// 也就是说这 6000 条背后其实只有 **4 套凭据**,套在一千多个 CF 任播 IP 上。CF 的边缘 IP
// 是任播的,连哪个都一样落到同一台后端机器。如果按 `type:server:port` 去重(节点池里
// 原来那套 identity 就是这么算的),这 6000 条会**一条都去不掉**,整个免费池瞬间被一个源的
// CF 扇出淹没,别的源一个节点都挤不进来。
//
// 所以这里分开算:
//   endpointId    type:server:port —— "同一个连接目标",跟老的 node_cache 口径一致
//   credentialId  协议 + 密钥 + 真正落地的主机名 + 端口 + 路径 —— "同一个服务"
//
// 入库时两个都存;选点时按 credentialId 限流(一套凭据最多留几条),这样 CF 扇出会被
// 压成几条代表,而不是把池子占满。**不是直接丢掉**:同一套凭据下不同的 CF IP 速度确实
// 有差别,留几条备选是有意义的,只是不能留一千条。

import type { Proxy } from "./parse.ts";

function s(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

/** "同一个连接目标"。跟 nodepipe/node_cache.py 的 identity_of 口径保持一致。 */
export function endpointId(p: Proxy): string {
  return `${s(p.type)}:${s(p.server)}:${s(p.port)}`.toLowerCase();
}

/**
 * "同一个服务"。取协议 + 密钥 + 真正落地的主机名 + 端口 + 路径。
 *
 * 主机名优先取 servername/sni/ws 的 Host 头 —— 对 CDN 前置的节点来说,server 字段是
 * CDN 的边缘 IP(会变、会有一千个),Host/SNI 才是真正指向后端的那个名字。取不到才退回
 * server 本身(直连节点没有 CDN 前置,这时候 server 就是真正的落地地址)。
 */
export function credentialId(p: Proxy): string {
  const type = s(p.type).toLowerCase();
  // 各协议的"密钥"字段名不统一:vmess/vless/tuic 用 uuid,trojan/ss/hysteria2/anytls 用
  // password,hysteria 用 auth-str,http/socks 用 username+password。
  const secret = s(p.uuid) || s(p.password) || s(p["auth-str"]) || s(p.auth) ||
    (s(p.username) ? `${s(p.username)}/${s(p.password)}` : "");

  const wsOpts = (p["ws-opts"] ?? {}) as Record<string, unknown>;
  const wsHeaders = (wsOpts.headers ?? {}) as Record<string, unknown>;
  const host = s(p.servername) || s(p.sni) || s(p.host) ||
    s(wsHeaders.Host) || s(wsHeaders.host) || s(p.server);

  const path = s(wsOpts.path) || s((p["grpc-opts"] as Record<string, unknown> ?? {})["grpc-service-name"]) ||
    s(p["h2-opts"] ? (p["h2-opts"] as Record<string, unknown>).path : "");

  return `${type}|${secret}|${host.toLowerCase()}|${s(p.port)}|${path}`;
}

// ---------------------------------------------------------------- 明显没用的

/**
 * 一眼就知道连不通的条目。免费源里这种垃圾不少,提前扔掉能省下后面一整轮实测的时间。
 *
 * 判据都是**结构性**的,不涉及"这个节点现在活不活"——活不活只能实测,这里不猜。
 * 比如聚合源的第一条永远是 `{name: "[Trojan] 测试节点", server: a, port: 1}`,
 * server 是单个字母 "a",端口 1,这是生成脚本留下的占位符,不是节点。
 */
export function isJunk(p: Proxy): string | null {
  const server = s(p.server);
  const port = Number(p.port);
  const type = s(p.type).toLowerCase();

  if (!server) return "没有 server";
  if (!Number.isInteger(port) || port < 1 || port > 65535) return `端口不合法(${s(p.port)})`;
  // 占位符:server 短到不可能是域名也不是 IP
  if (server.length < 4 && !/^\d/.test(server)) return `server 像占位符(${server})`;
  if (!/[.:]/.test(server)) return `server 既不含点也不含冒号,不是域名或 IP(${server})`;
  // 本地地址:推给家人也连不上
  if (/^(127\.|0\.0\.0\.0|localhost$|::1$|10\.|192\.168\.|169\.254\.)/i.test(server)) {
    return `私有/本地地址(${server})`;
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(server)) return `私有地址(${server})`;
  if (!type) return "没有 type";
  // proxy-groups 有时会被当成 proxies 捞进来
  if (type === "select" || type === "url-test" || type === "fallback" || type === "load-balance") {
    return `这是代理组不是节点(${type})`;
  }
  return null;
}

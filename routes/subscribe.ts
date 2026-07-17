// routes/subscribe.ts — 家人拉订阅:/l/{username}/{id}[/{clientTag}]
//
// 不带 clientTag(旧链接,兼容):按设备后台设置的 format 返回,全量协议池,行为不变。
// 带 clientTag:该客户端的"格式 + 协议子集"由 CLIENT_TAGS 表决定,覆盖设备的默认 format。
//   这是给同一台设备可能装了多个 App(比如 sing-box + V2Box 互相备用)的场景——
//   不用在后台来回切换格式,直接给两条不同后缀的链接即可。

import { appendLog, getDevice, getNodes, recordHit } from "../kv.ts";
import { maybeFlush } from "../db.ts";
import { toSingboxJson } from "../singbox.ts";
import { toClashYaml } from "../clash.ts";
import { filterAndReencode } from "../protocol-filter.ts";

type ClientFormat = "base64" | "singbox" | "clash";

interface ClientTagSpec {
  format: ClientFormat;
  // null = 全协议,不过滤;否则只保留这些前缀开头的节点行
  allowedPrefixes: string[] | null;
}

const CLIENT_TAGS: Record<string, ClientTagSpec> = {
  singbox: { format: "singbox", allowedPrefixes: null },
  clash: { format: "clash", allowedPrefixes: null },
  openclash: { format: "clash", allowedPrefixes: null },
  // V2Box(Xray-core)不支持 anytls,只给 vless/trojan
  v2box: { format: "base64", allowedPrefixes: ["vless://", "trojan://"] },
  // v2rayN 当前版本 anytls 支持不稳定,先按 vless/trojan 处理
  v2rayn: { format: "base64", allowedPrefixes: ["vless://", "trojan://"] },
};

function renderByFormat(format: ClientFormat, nodes: string): Response {
  if (format === "singbox") {
    return new Response(toSingboxJson(nodes), { headers: { "content-type": "application/json; charset=utf-8" } });
  }
  if (format === "clash") {
    return new Response(toClashYaml(nodes), { headers: { "content-type": "text/yaml; charset=utf-8" } });
  }
  return new Response(nodes, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function handleSubscribe(parts: string[], req: Request): Promise<Response> {
  // parts = ["l", username, id, clientTag?]
  const username = decodeURIComponent(parts[1]);
  const dev = await getDevice(username);
  if (!dev || !dev.enabled || dev.id !== parts[2]) {
    return new Response("Not Found", { status: 404 });
  }

  recordHit(username).catch(() => {});
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  const ua = req.headers.get("user-agent") ?? "?";
  appendLog(username, ip, ua).then(() => maybeFlush()).catch(() => {});

  const rawNodes = await getNodes();
  const tag = parts[3] ? decodeURIComponent(parts[3]).toLowerCase() : "";
  const spec = tag ? CLIENT_TAGS[tag] : undefined;

  if (tag && !spec) {
    return new Response("Unknown client tag", { status: 404 });
  }

  if (spec) {
    const nodes = spec.allowedPrefixes ? filterAndReencode(rawNodes, spec.allowedPrefixes) : rawNodes;
    return renderByFormat(spec.format, nodes);
  }

  // 无标签:旧行为,走设备后台设置的默认格式,全量协议池
  return renderByFormat((dev.format ?? "base64") as ClientFormat, rawNodes);
}

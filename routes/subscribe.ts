// routes/subscribe.ts — 家人拉订阅:/l/{username}/{id}[/{clientTag}]
//
// 不带 clientTag(旧链接,兼容):按设备后台设置的默认格式返回。
// 带 clientTag:该客户端的"格式 + 协议子集"由 formats.ts 的登记表决定,覆盖设备的默认格式。
//   这是给同一台设备可能装了多个 App(比如 sing-box + Surge 互相备用)的场景——
//   不用在后台来回切换格式,直接给两条不同后缀的链接即可。
//
// 2026-08 起节点池本身就只有美国节点了(Mac 端 select_and_push.py 做的严格 GeoIP 筛选),
// 所以以前那条隐藏的 /us "美国节点组"链接已经没有存在意义,连同 /push-us、KV 里的
// us_nodes、设备上的 usEnabled 开关一起整条链路都删掉了。

import { appendLog, getDevice, getNodes, getServiceState, recordHit } from "../kv.ts";
import { maybeFlush } from "../db.ts";
import { NODE_CAP } from "../config.ts";
import { FORMATS, renderFormat } from "../formats.ts";
import { capNodeCount, stripDisabled } from "../protocol-filter.ts";

export async function handleSubscribe(parts: string[], req: Request): Promise<Response> {
  // 服务总开关。关掉时**先**返回,在查设备之前 —— 这样"链接对不对"根本不参与判断,
  // 对外的响应跟随便敲一个不存在的链接完全一样(同样的 404、同样的正文、同样没有
  // 任何额外响应头),看不出这个域名上到底有没有服务。
  //
  // 关掉时也不记访问日志:日志的用途是"谁在用哪条链接",而这会儿谁也没拿到东西。
  // 顺带也免得别人靠反复请求在你后台刷出一堆记录。
  if (!(await getServiceState()).up) {
    return new Response("Not Found", { status: 404 });
  }

  // parts = ["l", username, id, clientTag?]
  const username = decodeURIComponent(parts[1]);
  const dev = await getDevice(username);
  if (!dev || !dev.enabled || dev.id !== parts[2]) {
    return new Response("Not Found", { status: 404 });
  }

  const tag = parts[3] ? decodeURIComponent(parts[3]).toLowerCase() : "";
  if (tag && !FORMATS[tag]) {
    return new Response("Unknown client tag", { status: 404 });
  }

  recordHit(username).catch(() => {});
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  const ua = req.headers.get("user-agent") ?? "?";
  // 记下访问的是哪条格式链接,后台才能在每条链接下面列出"谁在用它"。
  // 记日志放在标签校验**之后**:访问了不存在的后缀本来就会 404,没必要记一笔。
  // X-HWID:客户端**主动**发来的硬件标识。目前只见过 Karing 支持(按订阅的开关,默认关)。
  // 我们不去索取,发了才记 —— HTTP 本身没有任何字段能给出主机名或设备 ID,这是唯一途径。
  // 截断一下,避免有人拿超长的头把 KV 记录撑爆。
  const hwid = (req.headers.get("x-hwid") ?? "").trim().slice(0, 64);
  appendLog(username, ip, ua, tag, hwid).then(() => maybeFlush()).catch(() => {});

  // 数量上限在这里统一截一次。Mac 端 MAX_NODES 已经控制在 100 以内了,这里再截是
  // 防御性的——就算上游哪天推了超量的池子,Deno 这边也不会把超量的都吐给客户端。
  // 时间戳标记节点不计入上限,也不会被截掉。
  const nodes = capNodeCount(stripDisabled(await getNodes()), NODE_CAP);

  return renderFormat(tag || dev.format, nodes);
}

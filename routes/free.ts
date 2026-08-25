// routes/free.ts — 免费节点池的三个入口。
//
//   GET  {ADMIN_PATH}/free           后台面板:池子现状 + 各源战报 + 手动抓一轮的按钮
//   POST {ADMIN_PATH}/free/harvest   手动触发一轮抓取(登录态鉴权)
//   GET  /free/pool                  给本地实测端拉池子用(PUSH_KEY 鉴权)
//
// 为什么拉池子的接口要鉴权:池子里存的是完整的分享链接,含 uuid / 密码。虽然这些节点
// 本来就是公开来源抓的,但把一个"聚合了几千条可用节点的接口"挂在公网上无鉴权,等于替
// 别人做了个免费的聚合服务,白白消耗这些节点的带宽,也会让我们这个域名很快被盯上。
// 复用 PUSH_KEY 而不是新开一个密钥:本地端本来就有它,不用再配一份。

import { isAuthed } from "../auth.ts";
import { harvestAll } from "../free/harvest.ts";
import { freeStoreEnabled, getPool, poolStats, prune } from "../free/store.ts";
import { freePanel } from "../free/ui.ts";

const PUSH_KEY = Deno.env.get("PUSH_KEY") ?? "";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** 后台面板 + 手动抓取。 */
export async function handleFreeAdmin(req: Request, url: URL): Promise<Response> {
  if (!await isAuthed(req)) return new Response("Unauthorized", { status: 401 });

  if (req.method === "POST" && url.pathname.endsWith("/harvest")) {
    const report = await harvestAll();
    return json(report);
  }
  if (req.method === "POST" && url.pathname.endsWith("/prune")) {
    const n = await prune();
    return json({ ok: true, pruned: n });
  }

  const stats = await poolStats();
  return new Response(freePanel(stats), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * 给本地实测端拉池子。
 *
 * 返回的是**未经实测**的候选节点 —— 免费节点里大部分是死的,这一点没法在服务端解决:
 * Deno Deploy 上没有代理内核,拨不了这些节点,判断不了活没活。活性、速度、以及那道严格的
 * 美国 GeoIP 核实,全部由本地端(nodepipe 或客户端里的 mihomo)负责。这里只管"把候选
 * 攒齐、去重、限流"。
 *
 * 查询参数:
 *   limit     最多返回几条,默认 500
 *   perCred   每套凭据最多几条,默认 3(见 free/identity.ts 里 CF 扇出那段)
 *   protos    逗号分隔的协议白名单,不填就是全部
 *   days      只要最近几天还出现过的,默认 7
 *   format    uris(默认,每行一条分享链接) | base64(整段 base64,跟 /push 的格式一致) | json
 */
export async function handleFreePool(req: Request, url: URL): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!PUSH_KEY || token !== PUSH_KEY) return new Response("Unauthorized", { status: 401 });
  if (!freeStoreEnabled) {
    return json({ error: "未配置 DATABASE_URL,免费池没有存储后端" }, 503);
  }

  const q = url.searchParams;
  const rows = await getPool({
    // 下限也要夹。原来只有 Math.min(…, 5000),负数会原样传进 SQL,
    // Postgres 对 LIMIT -5 是直接报错("LIMIT must not be negative")、整个接口 500。
    // 接口本身有 PUSH_KEY 鉴权,不是安全问题,但没道理让一个手滑的参数把接口打挂。
    limit: Math.min(Math.max(1, Number(q.get("limit") ?? 500) || 500), 5000),
    perCred: Math.max(1, Number(q.get("perCred") ?? 3) || 3),
    protos: (q.get("protos") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    freshDays: Math.max(1, Number(q.get("days") ?? 7) || 7),
  });

  const format = q.get("format") ?? "uris";
  if (format === "json") return json({ count: rows.length, nodes: rows });

  const text = rows.map((r) => r.uri).join("\n") + (rows.length ? "\n" : "");
  if (format === "base64") {
    return new Response(btoa(text), { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

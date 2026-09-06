// routes/push.ts — 节点池的读写口,给本地实测端 / rClash 用。
//
//   POST /push   推一批节点上来(覆盖式,自带历史版本)
//   GET  /push   把当前这批读回去
//
// 都用 PUSH_KEY 鉴权(跟 SEED 分开)。
//
// GET 是给 rClash 的「拉回来 → 排序/合并 → 再推回去」用的。为什么不让它直接读订阅链接:
// 那些链接经过了协议过滤、数量截断、停用剔除,拿回去的是**加工过的结果**,再推回来就
// 把加工固化了(比如某条链接只发 vless,拉回去再推,别的协议就永久没了)。这里给的是
// **原样**的池子,停用行也带着 #OFF# 前缀原样返回,一个字节不改。

import { getNodes, getNodesUpdated, saveNodes } from "../kv.ts";

const PUSH_KEY = Deno.env.get("PUSH_KEY") ?? "";

/** 把 KV 里存的那一坨(base64 或明文)还原成一行行的明文。 */
function toLines(raw: string): string[] {
  const t = (raw ?? "").trim();
  if (!t) return [];
  // 已经是明文列表(协议前缀或停用标记开头)就不解码
  if (/^(vmess|vless|trojan|anytls|ss|ssr):\/\//i.test(t) || t.startsWith("#OFF# ")) {
    return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  try {
    return atob(t).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    // 解不开就当明文处理 —— 总比抛异常让整个接口 500 强
    return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
}

export async function handlePush(req: Request, url?: URL): Promise<Response> {
  // 鉴权:Authorization: Bearer <PUSH_KEY>
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!PUSH_KEY || token !== PUSH_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ---- 读回当前池子 ----
  if (req.method === "GET") {
    const lines = toLines(await getNodes());
    const updatedAt = await getNodesUpdated();
    const format = url?.searchParams.get("format") ?? "uris";

    if (format === "json") {
      return new Response(
        JSON.stringify({
          updatedAt,
          count: lines.filter((l) => !l.startsWith("#OFF# ")).length,
          // 停用状态一并给出去 —— 客户端要是原样推回来,停用的还是停用的,
          // 不会因为走了一趟就被悄悄启用
          nodes: lines.map((l) =>
            l.startsWith("#OFF# ")
              ? { uri: l.slice("#OFF# ".length), disabled: true }
              : { uri: l, disabled: false }
          ),
        }, null, 2),
        { headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    const text = lines.join("\n") + (lines.length ? "\n" : "");
    if (format === "base64") {
      return new Response(btoa(text), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = (await req.text()).trim();
  if (!body) return new Response("Empty body", { status: 400 });

  // 安全阈值:防止推空导致全家断网。少于 1 行直接拒绝。
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return new Response("No nodes", { status: 400 });

  // saveNodes 自带历史版本,推送出问题可在后台"恢复上一版"
  await saveNodes(body);

  return new Response(
    JSON.stringify({ ok: true, count: lines.length, at: new Date().toISOString() }),
    { headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

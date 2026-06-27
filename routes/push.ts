// routes/push.ts — 接收本地测速引擎推送的最优节点,写入 KV nodes。
// 用独立环境变量 PUSH_KEY 鉴权(跟 SEED 分开)。Mac mini 上的脚本带此密钥 POST。

import { saveNodes } from "../kv.ts";

const PUSH_KEY = Deno.env.get("PUSH_KEY") ?? "";

export async function handlePush(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // 鉴权:Authorization: Bearer <PUSH_KEY>
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!PUSH_KEY || token !== PUSH_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

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

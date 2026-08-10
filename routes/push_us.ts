// routes/push_us.ts — 接收 Mac mini 的"美国节点档案"推送(见 nodepipe/us_archive.py),
// 写入 KV us_nodes,跟主节点池(/push → nodes)完全分开存放。
// 复用同一个 PUSH_KEY 鉴权,不用单独再管一个密钥。

import { saveUsNodes } from "../kv.ts";

const PUSH_KEY = Deno.env.get("PUSH_KEY") ?? "";

export async function handlePushUs(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!PUSH_KEY || token !== PUSH_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.text()).trim();
  if (!body) return new Response("Empty body", { status: 400 });

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return new Response("No nodes", { status: 400 });

  await saveUsNodes(body);

  return new Response(
    JSON.stringify({ ok: true, count: lines.length, at: new Date().toISOString() }),
    { headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

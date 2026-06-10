// routes/subscribe.ts — 家人拉订阅:/l/{username}/{id}

import { appendLog, getDevice, getNodes, recordHit } from "../kv.ts";
import { maybeFlush } from "../db.ts";
import { toSingboxJson } from "../singbox.ts";

export async function handleSubscribe(parts: string[], req: Request): Promise<Response> {
  // parts = ["l", username, id]
  const username = decodeURIComponent(parts[1]);
  const dev = await getDevice(username);
  if (!dev || !dev.enabled || dev.id !== parts[2]) {
    return new Response("Not Found", { status: 404 });
  }

  recordHit(username).catch(() => {});
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  const ua = req.headers.get("user-agent") ?? "?";
  appendLog(username, ip, ua).then(() => maybeFlush()).catch(() => {});

  const nodes = await getNodes();

  // 按设备格式返回:singbox → 实时转 JSON;否则原样返回 base64
  if (dev.format === "singbox") {
    const json = toSingboxJson(nodes);
    return new Response(json, { headers: { "content-type": "application/json; charset=utf-8" } });
  }
  return new Response(nodes, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

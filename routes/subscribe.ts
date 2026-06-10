// routes/subscribe.ts — 家人拉订阅:/l/{username}/{id}

import { appendLog, getDevice, getNodes, recordHit } from "../kv.ts";
import { maybeFlush } from "../db.ts";

export async function handleSubscribe(parts: string[], req: Request): Promise<Response> {
  // parts = ["l", username, id]
  const username = decodeURIComponent(parts[1]);
  const dev = await getDevice(username);
  if (!dev || !dev.enabled || dev.id !== parts[2]) {
    return new Response("Not Found", { status: 404 });
  }

  // 计数(快)
  recordHit(username).catch(() => {});

  // 领取日志:记 IP + UA,然后异步触发归档检查。
  // 全程 fire-and-forget,Neon 慢/挂都不影响订阅秒回;未归档数据留在 KV,下次重试。
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  const ua = req.headers.get("user-agent") ?? "?";
  appendLog(username, ip, ua).then(() => maybeFlush()).catch(() => {});

  const nodes = await getNodes();
  return new Response(nodes, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

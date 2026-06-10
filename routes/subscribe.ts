// routes/subscribe.ts — 家人拉订阅:/l/{username}/{id}

import { getDevice, getNodes, recordHit } from "../kv.ts";

export async function handleSubscribe(parts: string[]): Promise<Response> {
  // parts = ["l", username, id]
  const username = decodeURIComponent(parts[1]);
  const dev = await getDevice(username);
  if (!dev || !dev.enabled || dev.id !== parts[2]) {
    return new Response("Not Found", { status: 404 });
  }
  // 功能3:记录访问(不阻塞返回)
  recordHit(username).catch(() => {});
  const nodes = await getNodes();
  return new Response(nodes, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

// routes/switch.ts — 服务总开关的远程接口,给 rClash 用。
//
//   GET  /switch   读当前状态
//   POST /switch   切换   body: {"up": true|false}
//
// 鉴权复用 PUSH_KEY(Bearer),跟 /push 同一把钥匙 —— rClash 本来就配了它,
// 不用再让用户多填一个密钥。
//
// **这条路由自己不受开关影响**,这是有意的:关掉服务之后还得能把它开回来。
// 同理后台、/push、应急查码也都不受影响。真正被关掉的只有订阅链接 /l/...,
// 见 routes/subscribe.ts 开头那段。
//
// 没配 PUSH_KEY 时一律 401 —— 没有"没设密钥就放行"这种事,不然任何人都能把
// 全家的订阅关掉。

import { isPushKeyed } from "../auth.ts";
import { getServiceState, setServiceUp } from "../kv.ts";


function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleSwitch(req: Request): Promise<Response> {
  if (!isPushKeyed(req)) return new Response("Unauthorized", { status: 401 });

  if (req.method === "GET") {
    return json(await getServiceState());
  }

  if (req.method === "POST") {
    let up: unknown;
    try {
      up = (await req.json())?.up;
    } catch {
      return json({ error: "body 不是 JSON" }, 400);
    }
    // 只认真正的布尔值。收到字符串 "false" 就当成 true 是这类接口的经典事故 ——
    // 那会让你以为关掉了、实际还开着,而且完全没有报错。
    if (typeof up !== "boolean") {
      return json({ error: 'up 必须是 true 或 false(布尔值,不是字符串)' }, 400);
    }
    return json(await setServiceUp(up));
  }

  return new Response("Method Not Allowed", { status: 405 });
}

// main.ts — 入口。只负责"收到请求 → 分派给对应模块"。
// 加新功能时:写一个新的 routes/xxx.ts,然后在下面加一行分派即可,不动其他文件。

import { serveFile } from "jsr:@std/http/file-server";
import { ADMIN_PATH, FALLBACK_PATH } from "./config.ts";
import { maybeSendQuarterEmail } from "./mail.ts";
import { handleSubscribe } from "./routes/subscribe.ts";
import { handleAdmin } from "./routes/admin.ts";
import { handleFallback } from "./routes/fallback.ts";
import { handleTools } from "./routes/tools.ts";
import { handlePush } from "./routes/push.ts";
import { handlePushUs } from "./routes/push_us.ts";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // 换季后首次访问触发发码邮件(尽力而为,不阻塞)
  maybeSendQuarterEmail().catch(() => {});

  // 订阅:/l/{username}/{id}[/{clientTag}]
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "l" && (parts.length === 3 || parts.length === 4)) {
    return await handleSubscribe(parts, req);
  }

  // 管理后台
  if (path === ADMIN_PATH) {
    return await handleAdmin(req, url);
  }

  // 应急查码
  if (path === FALLBACK_PATH) {
    return await handleFallback(req);
  }

  // 工具箱
  if (path === ADMIN_PATH + "/tools") {
    return await handleTools(req);
  }

  // 接收本地测速推送
  if (path === "/push") {
    return await handlePush(req);
  }

  // 接收美国节点档案推送(见 nodepipe/us_archive.py)
  if (path === "/push-us") {
    return await handlePushUs(req);
  }

  // 其他:默认网页
  return serveFile(req, "./index.html");
});

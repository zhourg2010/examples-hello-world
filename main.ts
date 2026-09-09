// main.ts — 入口。只负责"收到请求 → 分派给对应模块"。
// 加新功能时:写一个新的 routes/xxx.ts,然后在下面加一行分派即可,不动其他文件。

import { serveFile } from "jsr:@std/http/file-server";
import { ADMIN_PATH, CLASSIC_PATH, FALLBACK_PATH } from "./config.ts";
import { maybeSendQuarterEmail } from "./mail.ts";
import { handleSubscribe } from "./routes/subscribe.ts";
import { handleAdmin } from "./routes/admin.ts";
import { handleOs } from "./routes/os.ts";
import { handleFallback } from "./routes/fallback.ts";
import { handleTools } from "./routes/tools.ts";
import { handlePush } from "./routes/push.ts";
import { handleSwitch } from "./routes/switch.ts";
import { handleFreeAdmin, handleFreePool, handleFreeVerify } from "./routes/free.ts";
import { harvestAll } from "./free/harvest.ts";
import { freeStoreEnabled, prune } from "./free/store.ts";

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

  // 管理后台。默认(桌面版)和旧版共用 handleAdmin,由它按 pathname 分。
  // 注意顺序:CLASSIC_PATH 是 ADMIN_PATH 的子路径,要在下面那条 /os 前缀判断之前先接住。
  if (path === ADMIN_PATH || path === CLASSIC_PATH) {
    return await handleAdmin(req, url);
  }

  // 应急查码
  if (path === FALLBACK_PATH) {
    return await handleFallback(req);
  }

  // 桌面版的片段和变更接口。外壳本身现在由 {ADMIN_PATH} 直接给,
  // {ADMIN_PATH}/os 仍然可用(302 过去),免得之前存的书签失效。
  if (path === ADMIN_PATH + "/os" || path.startsWith(ADMIN_PATH + "/os/")) {
    return await handleOs(req, url);
  }

  // 工具箱
  if (path === ADMIN_PATH + "/tools") {
    return await handleTools(req);
  }

  // 接收本地测速推送
  if (path === "/push") {
    return await handlePush(req, url);
  }

  // 服务总开关(PUSH_KEY 鉴权)。**故意不受开关影响** —— 关掉之后还得能开回来。
  if (path === "/switch") {
    return await handleSwitch(req);
  }

  // 免费节点池:后台面板 + 手动抓取
  if (path === ADMIN_PATH + "/free" || path.startsWith(ADMIN_PATH + "/free/")) {
    return await handleFreeAdmin(req, url);
  }

  // 免费节点池:给本地实测端拉候选(PUSH_KEY 鉴权)
  if (path === "/free/pool") {
    return await handleFreePool(req, url);
  }

  // 免费节点池:GET 拿历轮通过率,POST 收客户端实测回来的一轮结果(都是 PUSH_KEY 鉴权)。
  // Deno Deploy 上没有代理内核、拨不了节点,所以验证只能在客户端做,这里只负责存和汇总。
  if (path === "/free/verify") {
    return await handleFreeVerify(req);
  }

  // 其他:默认网页
  return serveFile(req, "./index.html");
});

// ---------------------------------------------------------------- 定时抓取
//
// 免费节点池要的是**长期定期**跑,不是手工点一次就完事:这些源每天都在变,今天抓到的
// 明天大半就死了,所以真正有用的是那条时间线 —— 一个节点连着十几轮都还在,才说明它背后
// 的机器是长期在跑的(free_node.seen_count 记的就是这个)。手工那个按钮只是补跑用的。
//
// Deno.cron 是 Deno Deploy 自带的调度器,不需要外部触发器,也不需要本机开着。
// 表达式是 UTC。6 小时一轮:免费源的更新频率大多是每天 1~2 次(Barabama 是每日 12 点),
// 抓太勤既没有新东西,还白白给人家仓库刷流量。
//
// 没配 DATABASE_URL 就不注册 —— 抓了也存不住,纯属浪费。
// Deno.cron 在 Deno Deploy 上直接可用;本机 `deno task dev` 跑的话需要 --unstable-cron,
// 没带这个 flag 时 Deno.cron 是 undefined。本地开发不该因为这个起不来,所以先探一下。
if (freeStoreEnabled && typeof Deno.cron === "function") {
  Deno.cron("harvest-free-nodes", "0 */6 * * *", async () => {
    const r = await harvestAll();
    console.log(`[free] 定时抓取完成:入库 ${r.totalKept} 条,` +
      r.sources.map((s) => `${s.id}=${s.ok ? s.kept : "失败"}`).join(" "));
  });

  // 每天清一次很久没再出现的节点。免费节点寿命普遍很短,不清的话表会一直涨。
  Deno.cron("prune-free-nodes", "30 4 * * *", async () => {
    const n = await prune();
    if (n) console.log(`[free] 清理过期节点 ${n} 条`);
  });
}

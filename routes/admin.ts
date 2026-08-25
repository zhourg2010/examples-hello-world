// routes/admin.ts — 管理后台所有逻辑。

import { ADMIN_PATH, AUTH_MAX_AGE } from "../config.ts";
import { isAuthed, isValidCode } from "../auth.ts";
import {
  exportBackup, getNodeHistory, getNodes, getNodesUpdated,
  getRecentDevicesByTag, listDevices,
} from "../kv.ts";
import { dbEnabled, userStats } from "../db.ts";
import { getRecentLogsForUser } from "../kv.ts";
import { dashboardPage, html, loginPage, noticeHtml, redirect, userDashboardPage } from "../ui.ts";
import { computeNodeStats } from "../node-stats.ts";
import { runAction } from "../actions.ts";

async function render(origin: string, notice = ""): Promise<Response> {
  const devices = await listDevices();
  const nodes = await getNodes();
  // 每台设备各条链接的"最近在用的客户端"。只扫 KV 缓冲(~100条),不查 Neon——
  // 后台首页每次渲染都会走这里,不该为此挂一次跨网络的 SQL。
  const devicesByTag = new Map(
    await Promise.all(
      devices.map(async (d) =>
        [d.username, await getRecentDevicesByTag(d.username)] as const
      ),
    ),
  );
  return html(dashboardPage({
    devices,
    nodes,
    nodesUpdated: await getNodesUpdated(),
    nodeStats: computeNodeStats(nodes),
    devicesByTag,
    origin,
    hasHistory: (await getNodeHistory()).length > 0,
    notice,
  }));
}

export async function handleAdmin(req: Request, url: URL): Promise<Response> {
  // 导出备份(GET ?export=1),需登录
  if (req.method === "GET" && url.searchParams.get("export") === "1") {
    if (!(await isAuthed(req))) return html(loginPage());
    const data = JSON.stringify(await exportBackup(), null, 2);
    return new Response(data, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="proxy-sub-backup-${Date.now()}.json"`,
      },
    });
  }

  if (req.method === "POST") {
    const f = await req.formData();
    const action = String(f.get("action") ?? "");

    // 登录
    if (action === "login") {
      const code = String(f.get("code") ?? "");
      if (await isValidCode(code)) {
        return redirect(ADMIN_PATH, {
          "Set-Cookie": `auth=${encodeURIComponent(code)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${AUTH_MAX_AGE}`,
        });
      }
      return html(loginPage("登录码错误"));
    }

    // 其余操作需登录
    if (!(await isAuthed(req))) return html(loginPage("请先登录"));

    // 变更操作统一走 actions.ts(桌面版 routes/os.ts 用的是同一份,避免两边逻辑走偏)。
    const r = await runAction(action, f);
    if (r) {
      // 这几个做完跳转:POST 之后 303 能防止刷新页面重复提交。
      // 其余的要把结果告诉用户,所以就地重渲染并带上提示条。
      const REDIRECTING = ["add", "switchformat", "toggle", "rotate", "del"];
      return REDIRECTING.includes(action)
        ? redirect(ADMIN_PATH)
        : render(url.origin, noticeHtml(r.msg, r.ok));
    }
    return redirect(ADMIN_PATH);
  }

  // GET 后台首页 / 用户看板
  if (!(await isAuthed(req))) return html(loginPage());
  const user = url.searchParams.get("user");
  if (user) {
    const stats = await userStats(user);
    const recent = await getRecentLogsForUser(user, 20);
    return html(userDashboardPage(user, stats, recent, dbEnabled));
  }
  return render(url.origin);
}

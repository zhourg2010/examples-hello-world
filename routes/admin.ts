// routes/admin.ts — 后台入口。
//
// 这个文件管两条路径:
//   {ADMIN_PATH}          默认界面。没登录给登录页,登录了给**桌面版**外壳。
//   {CLASSIC_PATH}        旧版后台(单页 + 顶栏切 pane),原样保留。
//
// 两边共用同一个登录 cookie,变更操作也共用 actions.ts —— 界面换了,逻辑没有第二份。
//
// 为什么旧版不删:桌面版是窗口 + Dock + 右键那一套,手机上用不了,而"在手机上查一下
// 某台设备的链接"这件事是会发生的;另外新界面万一出岔子,得有个立刻能用的退路。

import { ADMIN_PATH, AUTH_MAX_AGE, CLASSIC_PATH } from "../config.ts";
import { isAuthed, isValidCode } from "../auth.ts";
import {
  exportBackup, getNodeHistory, getNodes, getNodesUpdated,
  getRecentDevicesByTag, listDevices,
} from "../kv.ts";
import { dbEnabled, userStats } from "../db.ts";
import { getRecentLogsForUser } from "../kv.ts";
import { dashboardPage, html, loginPage, noticeHtml, redirect, userDashboardPage } from "../ui.ts";
import { computeNodeStats } from "../node-stats.ts";
import { shellPage } from "../os/shell.ts";
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
  // 这一次请求打的是旧版还是默认(桌面版)入口。
  // 登录和各种 POST 之后都跳回 here,而不是写死 ADMIN_PATH —— 不然在旧版里点个"启用"
  // 就被弹到桌面版去了,是最让人火大的那种 bug。
  const here = url.pathname === CLASSIC_PATH ? CLASSIC_PATH : ADMIN_PATH;
  const classic = here === CLASSIC_PATH;

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
        return redirect(here, {
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
        ? redirect(here)
        : render(url.origin, noticeHtml(r.msg, r.ok));
    }
    return redirect(here);
  }

  // GET
  if (!(await isAuthed(req))) return html(loginPage());

  // 用户活跃度看板。只有旧版有入口,但两条路径都放行 —— 收藏了链接的不该突然 404。
  const user = url.searchParams.get("user");
  if (user) {
    const stats = await userStats(user);
    const recent = await getRecentLogsForUser(user, 20);
    return html(userDashboardPage(user, stats, recent, dbEnabled));
  }

  return classic ? render(url.origin) : html(shellPage());
}

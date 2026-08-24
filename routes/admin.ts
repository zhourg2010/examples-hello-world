// routes/admin.ts — 管理后台所有逻辑。

import { ADMIN_PATH, AUTH_MAX_AGE } from "../config.ts";
import { genId, isAuthed, isValidCode } from "../auth.ts";
import {
  addDevice, deleteDevice, exportBackup, getNodeHistory, getNodes,
  getNodesUpdated, importBackup, listDevices, restorePrevNodes,
  saveNodes, setDevice,
} from "../kv.ts";
import { DEFAULT_FORMAT, DEFAULT_FORMAT_TAGS } from "../formats.ts";
import { sendMail } from "../mail.ts";
import { dbEnabled, userStats } from "../db.ts";
import { getRecentLogsForUser } from "../kv.ts";
import { dashboardPage, html, loginPage, noticeHtml, redirect, userDashboardPage } from "../ui.ts";
import { computeNodeStats } from "../node-stats.ts";

async function render(origin: string, notice = ""): Promise<Response> {
  const devices = await listDevices();
  const nodes = await getNodes();
  return html(dashboardPage({
    devices,
    nodes,
    nodesUpdated: await getNodesUpdated(),
    nodeStats: computeNodeStats(nodes),
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

    if (action === "add") {
      let note = String(f.get("note") ?? "").trim();
      if (!note) note = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("");
      const formatRaw = String(f.get("format") ?? DEFAULT_FORMAT);
      const format = (DEFAULT_FORMAT_TAGS as readonly string[]).includes(formatRaw) ? formatRaw : DEFAULT_FORMAT;
      await addDevice(String(f.get("username") ?? "").trim(), genId(), note, format);
      return redirect(ADMIN_PATH);
    }
    if (action === "switchformat") { // 在 formats.ts 登记的默认格式之间轮换
      const u = String(f.get("username") ?? "");
      const dev = (await listDevices()).find((d) => d.username === u);
      if (dev) {
        const tags = DEFAULT_FORMAT_TAGS as readonly string[];
        const i = tags.indexOf(dev.format ?? DEFAULT_FORMAT);
        await setDevice(u, { format: tags[(i + 1) % tags.length] });
      }
      return redirect(ADMIN_PATH);
    }
    if (action === "toggle") {
      const u = String(f.get("username") ?? "");
      const dev = (await listDevices()).find((d) => d.username === u);
      if (dev) await setDevice(u, { enabled: !dev.enabled });
      return redirect(ADMIN_PATH);
    }
    if (action === "rotate") { // 功能5:换链接(保留名字备注,只换 id)
      await setDevice(String(f.get("username") ?? ""), { id: genId() });
      return redirect(ADMIN_PATH);
    }
    if (action === "del") {
      await deleteDevice(String(f.get("username") ?? ""));
      return redirect(ADMIN_PATH);
    }
    if (action === "savenodes") { // 功能1:保存(自动留历史)
      await saveNodes(String(f.get("nodes") ?? ""));
      return render(url.origin, noticeHtml("节点已保存", true));
    }
    if (action === "restorenodes") { // 功能1:恢复上一版
      const ok = await restorePrevNodes();
      return render(url.origin, noticeHtml(ok ? "已恢复到上一版节点" : "没有可恢复的历史", ok));
    }
    if (action === "importbackup") { // 功能2:恢复备份
      try {
        const r = await importBackup(JSON.parse(String(f.get("backup") ?? "")));
        return render(url.origin, noticeHtml(`已恢复 ${r.devices} 台设备及节点`, true));
      } catch (e) {
        return render(url.origin, noticeHtml("恢复失败:" + String(e), false));
      }
    }
    if (action === "testmail") {
      const r = await sendMail("订阅管理 - 测试邮件",
        `这是一封测试邮件。\n收到说明邮件配置正常。\n时间: ${new Date().toISOString()}`);
      return render(url.origin, r.ok
        ? noticeHtml("测试邮件已发送,请查收(含垃圾箱)", true)
        : noticeHtml("发送失败: " + (r.error ?? "未知错误"), false));
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

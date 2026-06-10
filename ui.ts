// ui.ts — 所有页面的 HTML 与样式。改外观、改文案只动这里。

import { ADMIN_EMAIL } from "./config.ts";
import type { Device } from "./kv.ts";

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...extra } });
}

export function redirect(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...extra } });
}

function timeAgo(ts?: number): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}

const STYLE = `<style>
  :root{--bd:#e5e7eb;--fg:#1f2937;--muted:#6b7280;--blue:#2563eb;--red:#dc2626;--bg:#f9fafb}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;max-width:960px;margin:32px auto;padding:0 16px;color:var(--fg);background:#fff}
  h2{margin:28px 0 12px;font-size:18px}
  .sub{color:var(--muted);font-size:13px;margin:4px 0 0}
  .err{color:var(--red)} .ok{color:#059669}
  .notice{padding:10px 14px;border-radius:8px;margin:10px 0;font-size:14px}
  .notice.good{background:#ecfdf5;color:#059669}
  .notice.bad{background:#fef2f2;color:#b91c1c;word-break:break-all}
  input,textarea{font:inherit;padding:8px 10px;border:1px solid var(--bd);border-radius:8px;outline:none}
  input:focus,textarea:focus{border-color:var(--blue)}
  button{font:inherit;font-size:13px;padding:6px 12px;border:1px solid transparent;border-radius:8px;background:var(--blue);color:#fff;cursor:pointer;transition:.15s;white-space:nowrap}
  button:hover{filter:brightness(1.08)}
  button.ghost{background:#fff;color:var(--fg);border-color:var(--bd)}
  button.ghost:hover{background:var(--bg)}
  button.danger{background:#fff;color:var(--red);border-color:#fecaca}
  button.danger:hover{background:#fef2f2}
  table{border-collapse:separate;border-spacing:0;width:100%;margin-top:8px;font-size:14px;border:1px solid var(--bd);border-radius:10px;overflow:hidden}
  th{background:var(--bg);color:var(--muted);font-weight:600;text-align:left;padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
  td{border-top:1px solid var(--bd);padding:10px 12px;vertical-align:middle}
  .url{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);word-break:break-all;max-width:240px}
  .actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .actions form{display:inline;margin:0}
  .status{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px}
  .status.on{background:#ecfdf5;color:#059669}.status.off{background:#fef2f2;color:#b91c1c}
  .addform{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px}
  .addform input{flex:1;min-width:160px}
  textarea{width:100%;font-family:ui-monospace,monospace;font-size:12px;line-height:1.5}
  .box{max-width:360px}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
  .hits{font-size:12px;color:var(--muted)}
  .qr-mask{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center;z-index:50}
  .qr-mask.show{display:flex}
  .qr-card{background:#fff;padding:24px;border-radius:16px;text-align:center;max-width:300px}
  .qr-card #qrbox{margin:8px auto}
  .qr-card p{font-size:12px;color:var(--muted);word-break:break-all;margin:12px 0 0}
</style>`;

const HEAD = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${STYLE}`;

export function loginPage(msg = ""): string {
  return `${HEAD}<div class="box"><h2>管理登录</h2>${msg ? `<p class="err">${escapeHtml(msg)}</p>` : ""}
  <form method="post"><input type="hidden" name="action" value="login">
  <input name="code" placeholder="当季登录码" autocomplete="off"><button>登录</button></form></div>`;
}

export function seedPage(msg = ""): string {
  return `${HEAD}<div class="box"><h2>查看当季登录码</h2>${msg ? `<p class="err">${escapeHtml(msg)}</p>` : ""}
  <form method="post"><input name="seed" placeholder="输入种子(SEED)" autocomplete="off"><button>查看</button></form></div>`;
}

export function codesPage(q: string, codes: string[]): string {
  return `${HEAD}<h2>${escapeHtml(q)} 登录码</h2><p class="sub">任一可登录后台:</p>
  <ul>${codes.map((c) => `<li><code>${c}</code></li>`).join("")}</ul>`;
}

export function noticeHtml(msg: string, good: boolean): string {
  return `<div class="notice ${good ? "good" : "bad"}">${escapeHtml(msg)}</div>`;
}

export function dashboardPage(opts: {
  devices: Device[];
  nodes: string;
  nodesUpdated: number;
  origin: string;
  hasHistory: boolean;
  notice?: string;
}): string {
  const { devices, nodes, nodesUpdated, origin, hasHistory, notice = "" } = opts;

  const rows = devices.map((d) => {
    const link = `${origin}/l/${encodeURIComponent(d.username)}/${d.id}`;
    const j = JSON.stringify(link);
    return `<tr>
      <td><strong>${escapeHtml(d.username)}</strong></td>
      <td style="color:var(--muted)">${escapeHtml(d.note)}</td>
      <td><span class="status ${d.enabled ? "on" : "off"}">${d.enabled ? "启用" : "停用"}</span></td>
      <td class="hits">${timeAgo(d.lastSeen)}<br><span style="opacity:.7">共 ${d.hits ?? 0} 次</span></td>
      <td class="url">${link}</td>
      <td><div class="actions">
        <button type="button" class="ghost" onclick='copyLink(${j},this)'>复制</button>
        <button type="button" class="ghost" onclick='showQR(${j})'>二维码</button>
        <a href="?user=${encodeURIComponent(d.username)}"><button type="button" class="ghost">详情</button></a>
        <form method="post"><input type="hidden" name="action" value="rotate"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="ghost" onclick="return confirm('换链接后旧链接立即失效,需重新发给对方。继续?')">换链接</button></form>
        <form method="post"><input type="hidden" name="action" value="toggle"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="ghost">${d.enabled ? "停用" : "启用"}</button></form>
        <form method="post" onsubmit="return confirm('删除 ${escapeHtml(d.username)} ?')"><input type="hidden" name="action" value="del"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="danger">删除</button></form>
      </div></td></tr>`;
  }).join("");

  const updatedText = nodesUpdated
    ? `上次更新:${timeAgo(nodesUpdated)}(${new Date(nodesUpdated).toLocaleString("zh-CN")})`
    : "尚未保存过节点";

  return `${HEAD}
  ${notice}
  <h2>设备管理</h2>
  <form method="post" class="addform"><input type="hidden" name="action" value="add">
    <input name="username" placeholder="用户名(如 father-win)" required>
    <input name="note" placeholder="备注(可选)"><button>添加设备</button></form>
  <table><tr><th>用户名</th><th>备注</th><th>状态</th><th>最近访问</th><th>订阅链接</th><th>操作</th></tr>
    ${rows || `<tr><td colspan="6" style="color:var(--muted)">暂无设备</td></tr>`}</table>

  <h2>节点内容(整批替换)</h2>
  <p class="sub">${escapeHtml(updatedText)}</p>
  <form method="post" onsubmit="return checkNodes(this)"><input type="hidden" name="action" value="savenodes">
    <textarea name="nodes" rows="12">${escapeHtml(nodes)}</textarea>
    <div class="row">
      <button>保存节点</button>
      ${hasHistory ? `<button type="button" class="ghost" onclick="if(confirm('恢复到上一版节点?当前内容会被替换。'))document.getElementById('restoreForm').submit()">恢复上一版</button>` : ""}
    </div></form>
  ${hasHistory ? `<form id="restoreForm" method="post" style="display:none"><input type="hidden" name="action" value="restorenodes"></form>` : ""}

  <h2>备份</h2>
  <p class="sub">导出:把全部设备和节点存成一段文本,妥善保管,重建时可恢复。</p>
  <div class="row">
    <a href="?export=1"><button type="button" class="ghost">导出备份</button></a>
  </div>
  <form method="post" class="row" onsubmit="return confirm('恢复将覆盖现有全部设备和节点!确定?')" style="margin-top:8px">
    <input type="hidden" name="action" value="importbackup">
    <input name="backup" placeholder="粘贴备份文本以恢复" style="flex:1;min-width:240px">
    <button class="danger">恢复备份</button>
  </form>

  <h2>邮件测试</h2>
  <form method="post"><input type="hidden" name="action" value="testmail">
    <div class="row"><button class="ghost">发送测试邮件</button>
      <span class="sub">发送到 ${escapeHtml(ADMIN_EMAIL || "(未设置 ADMIN_EMAIL)")}</span></div></form>

  <div class="qr-mask" id="qrmask" onclick="if(event.target===this)this.classList.remove('show')">
    <div class="qr-card"><div id="qrbox"></div><p id="qrtext"></p>
      <button class="ghost" style="margin-top:14px" onclick="document.getElementById('qrmask').classList.remove('show')">关闭</button></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
  <script>
  async function copyLink(text, btn){
    try{ await navigator.clipboard.writeText(text); }
    catch(e){ const t=document.createElement('textarea');t.value=text;document.body.appendChild(t);t.select();try{document.execCommand('copy');}catch(_){}document.body.removeChild(t); }
    const old=btn.textContent;btn.textContent='已复制';btn.disabled=true;setTimeout(()=>{btn.textContent=old;btn.disabled=false;},1200);
  }
  function showQR(text){
    const box=document.getElementById('qrbox');box.innerHTML='';
    new QRCode(box,{text:text,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});
    document.getElementById('qrtext').textContent=text;
    document.getElementById('qrmask').classList.add('show');
  }
  // 功能1:防手滑存空。内容为空时拦下来要确认。
  function checkNodes(form){
    const v=form.nodes.value.trim();
    if(v==='') return confirm('节点内容是空的!保存后所有设备将无法获取节点。确定要保存空内容?');
    return true;
  }
  </script>`;
}

// ========== 用户活跃度看板 ==========
import type { LogEntry } from "./kv.ts";
import type { UserStats } from "./db.ts";
import { ADMIN_PATH } from "./config.ts";

export function userDashboardPage(
  username: string,
  stats: UserStats | null,
  recent: LogEntry[],
  dbEnabled: boolean,
): string {
  // 近7天柱状(按天)
  let activity = "";
  if (stats) {
    const map = new Map(stats.days.map((d) => [d.day, d.n]));
    const today = new Date();
    const bars: string[] = [];
    let max = 1;
    const seq: Array<{ label: string; n: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(today.getTime() - i * 86400000);
      const label = `${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
      const n = map.get(label) ?? 0;
      if (n > max) max = n;
      seq.push({ label, n });
    }
    for (const s of seq) {
      const h = Math.round((s.n / max) * 80);
      bars.push(`<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
        <div style="font-size:11px;color:var(--muted)">${s.n}</div>
        <div style="width:60%;height:${h || 2}px;background:${s.n ? "var(--blue)" : "var(--bd)"};border-radius:4px 4px 0 0"></div>
        <div style="font-size:11px;color:var(--muted)">${s.label}</div>
      </div>`);
    }
    activity = `<div style="display:flex;align-items:flex-end;gap:6px;height:120px;padding:12px;border:1px solid var(--bd);border-radius:10px">${bars.join("")}</div>`;
  }

  // IP 表
  const ipRows = stats?.ips.map((r) =>
    `<tr><td class="url">${escapeHtml(r.ip)}</td><td>${r.n}</td><td style="color:var(--muted)">${escapeHtml(r.last)}</td></tr>`
  ).join("") ?? "";

  // 泄露风险粗判:不同 IP 数 + UA 种类
  let risk = "—";
  if (stats) {
    const ipCount = stats.ips.length;
    const uaCount = stats.uas.length;
    if (uaCount > 1 || ipCount > 8) risk = `<span style="color:var(--red)">偏高</span>(${ipCount} 个IP / ${uaCount} 种客户端)`;
    else if (ipCount > 4) risk = `<span style="color:#d97706">中</span>(${ipCount} 个IP / ${uaCount} 种客户端)`;
    else risk = `<span style="color:#059669">低</span>(${ipCount} 个IP / ${uaCount} 种客户端)`;
  }

  // 最近领取(来自 KV 缓冲)
  const recentRows = recent.map((r) => {
    const t = new Date(r.ts).toLocaleString("zh-CN");
    return `<tr><td style="color:var(--muted)">${escapeHtml(t)}</td><td class="url">${escapeHtml(r.ip)}</td><td class="url">${escapeHtml(r.ua)}</td></tr>`;
  }).join("");

  const dbNote = dbEnabled
    ? `<p class="sub">说明:这是"订阅领取"活跃度,不是翻墙使用量。下方统计基于已归档数据,最近不足50条领取以"最近领取"列表为准。IP 多不一定是泄露(家庭宽带IP会变),但出现陌生 client 类型或 IP 数异常多时需留意。</p>`
    : `<p class="sub" style="color:var(--red)">未配置 DATABASE_URL,Neon 归档未启用,仅显示 KV 里最近的领取记录,无长期统计。</p>`;

  return `${HEAD}
  <p><a href="${ADMIN_PATH}" style="color:var(--blue);text-decoration:none">← 返回设备列表</a></p>
  <h2>${escapeHtml(username)} · 领取活跃度</h2>
  ${dbNote}
  ${stats ? `<p class="sub">累计领取 ${stats.total} 次 · 泄露风险:${risk}</p>` : ""}

  ${stats ? `<h2>近 7 天领取</h2>${activity}` : ""}

  ${stats && stats.ips.length ? `<h2>IP 记录(近30天)</h2>
  <table><tr><th>IP</th><th>次数</th><th>最近</th></tr>${ipRows}</table>` : ""}

  ${stats && stats.uas.length ? `<h2>客户端类型(近30天)</h2>
  <ul>${stats.uas.map((u) => `<li class="url">${escapeHtml(u)}</li>`).join("")}</ul>
  ${stats.uas.length > 1 ? `<p class="sub" style="color:var(--red)">⚠ 出现多于一种 client,可能这条链接被用在了不止一台设备/被转发。</p>` : ""}` : ""}

  <h2>最近领取(实时)</h2>
  ${recentRows ? `<table><tr><th>时间</th><th>IP</th><th>客户端 UA</th></tr>${recentRows}</table>` : `<p class="sub">暂无最近领取记录。</p>`}`;
}

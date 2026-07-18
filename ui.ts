// ui.ts — 所有页面的 HTML 与样式。改外观、改文案只动这里。
// 视觉主题:Modernist(米色底 + 红色强调色 + Archivo 字体 + 零圆角 + 顶部横向导航)。
// 架构不变:服务端渲染(form POST + 303 redirect),没有改成 SPA。

import { ADMIN_EMAIL } from "./config.ts";
import type { Device } from "./kv.ts";
import type { NodeStats } from "./node-stats.ts";

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
  @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap');
  :root{--bg:#f3f2f2;--fg:#1a1a1a;--muted:#6b6b68;--accent:#ec3013;--accent-ink:#fff;--bd:#1a1a1a;--bd2:#c9c7c3;--card:#ffffff;--ok:#1a7a3c;--warn:#92400e}
  *{box-sizing:border-box}
  body{font-family:'Archivo',system-ui,-apple-system,sans-serif;max-width:1120px;margin:0 auto;padding:0 20px 60px;color:var(--fg);background:var(--bg)}
  h2{margin:28px 0 14px;font-size:20px;font-weight:700;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:13px;margin:4px 0 0;line-height:1.6}
  .err{color:var(--accent)} .ok{color:var(--ok)}
  .notice{padding:12px 16px;border:2px solid var(--bd);margin:16px 0;font-size:14px;font-weight:500}
  .notice.good{background:#eaf6ee;color:var(--ok);border-color:var(--ok)}
  .notice.bad{background:#fdeceb;color:#a3200f;border-color:var(--accent);word-break:break-all}
  input,textarea,select{font:inherit;padding:9px 12px;border:2px solid var(--bd);border-radius:0;outline:none;background:#fff;color:var(--fg)}
  input:focus,textarea:focus,select:focus{border-color:var(--accent)}
  button{font:inherit;font-size:13px;font-weight:600;padding:8px 14px;border:2px solid var(--bd);border-radius:0;background:var(--fg);color:#fff;cursor:pointer;transition:.12s;white-space:nowrap}
  button:hover{background:var(--accent);border-color:var(--accent)}
  button.ghost{background:#fff;color:var(--fg);border-color:var(--bd2)}
  button.ghost:hover{background:var(--fg);color:#fff;border-color:var(--fg)}
  button.danger{background:#fff;color:var(--accent);border-color:var(--accent)}
  button.danger:hover{background:var(--accent);color:#fff}
  button:disabled{opacity:.5;cursor:default}
  table{border-collapse:separate;border-spacing:0;width:100%;margin-top:10px;font-size:14px;border:2px solid var(--bd)}
  th{background:var(--fg);color:#fff;font-weight:600;text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  td{border-top:1px solid var(--bd2);padding:12px;vertical-align:middle}
  tr:hover td{background:#faf9f8}
  .url{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--muted);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .actions{display:flex;flex-wrap:wrap;gap:6px;max-width:280px}
  .actions>form,.actions>a{margin:0;display:inline-block}
  .actions a{text-decoration:none}
  .actions button{font-size:11px;padding:6px 9px;height:auto;white-space:nowrap}
  .tablewrap{overflow-x:auto}
  .status{display:inline-block;padding:3px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border:1.5px solid var(--bd)}
  .status.on{background:#eaf6ee;color:var(--ok);border-color:var(--ok)}
  .status.off{background:#fdeceb;color:var(--accent);border-color:var(--accent)}
  .tag{display:inline-block;padding:2px 8px;font-size:11px;font-weight:700;border:1.5px solid var(--bd)}
  .tag-accent{background:var(--accent);color:#fff;border-color:var(--accent)}
  .addform{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px}
  .addform input{flex:1;min-width:170px}
  textarea{width:100%;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.5}
  .box{max-width:380px;margin:80px auto}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
  .hits{font-size:12px;color:var(--muted)}
  .hr{border-top:2px solid var(--bd);margin:20px 0}
  .qr-mask{display:none;position:fixed;inset:0;background:rgba(26,26,26,.72);align-items:center;justify-content:center;z-index:50}
  .qr-mask.show{display:flex}
  .qr-card{background:#fff;padding:28px;border:2px solid var(--bd);text-align:center;max-width:300px}
  .qr-card #qrbox{margin:8px auto}
  .qr-card p{font-size:12px;color:var(--muted);word-break:break-all;margin:12px 0 0}
  /* 顶部横向导航 */
  .topbar{display:flex;align-items:center;gap:0;border-bottom:3px solid var(--bd);padding:20px 0 0;margin-bottom:0;flex-wrap:wrap}
  .brand{font-weight:800;font-size:16px;letter-spacing:-.01em;margin-right:auto;padding-bottom:14px}
  .nav{display:flex;gap:2px;flex-wrap:wrap}
  .nav a{display:block;padding:10px 18px;color:var(--fg);text-decoration:none;font-size:13px;font-weight:600;cursor:pointer;border:2px solid transparent;border-bottom:none;margin-bottom:-1px}
  .nav a:hover{color:var(--accent)}
  .nav a.active{border-color:var(--bd);border-bottom:3px solid var(--bg);background:var(--bg);color:var(--accent)}
  .nav a.tool-link{margin-left:8px;border:2px solid var(--bd);background:var(--fg);color:#fff}
  .nav a.tool-link:hover{background:var(--accent);border-color:var(--accent)}
  .main{padding:24px 0 0}
  .pane{display:none}
  .pane.active{display:block}
  .pane h2:first-child{margin-top:0}
  #node-table-wrap{border:2px solid var(--bd);max-height:560px;overflow:auto;background:#fff}
  #node-table{width:100%;border-collapse:collapse;font-size:12px}
  #node-table thead th{position:sticky;top:0;background:var(--fg);color:#fff;text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;user-select:none;z-index:1}
  #node-table thead th.sortable{cursor:pointer}
  #node-table thead th.sortable:hover{color:var(--accent)}
  #node-table thead th .arrow{display:inline-block;width:10px}
  #node-table tbody td{padding:6px 10px;border-top:1px solid var(--bd2);vertical-align:middle}
  #node-table tbody tr.off{opacity:.4;background:var(--bg)}
  #node-table tbody tr.drag-over{outline:2px dashed var(--accent);outline-offset:-2px}
  #node-table .mono{font-family:ui-monospace,Menlo,monospace}
  #node-table input[type=checkbox]{accent-color:var(--accent);width:15px;height:15px}
  .drag-handle{cursor:grab;display:inline-flex;flex-direction:column;gap:2px;padding:4px 2px;user-select:none}
  .drag-handle span{display:block;width:14px;height:2px;background:var(--muted)}
  .proto-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 7px 2px 5px;border:1.5px solid currentColor;white-space:nowrap;text-transform:uppercase}
  .proto-badge svg{width:12px;height:12px;flex-shrink:0}
  .proto-badge.p-vless{color:#ec3013}
  .proto-badge.p-anytls{color:#9d5fc9}
  .proto-badge.p-trojan{color:#2f9e5b}
  .proto-badge.p-vmess{color:#3a6fd8}
  .proto-badge.p-ss{color:#c98a1f}
  .speed-cell{display:flex;flex-direction:column;gap:3px;min-width:64px}
  .speed-bar{width:64px;height:4px;background:var(--bd2)}
  .speed-fill{height:100%;background:var(--accent)}
  .proto-stack{display:flex;height:18px;width:100%;max-width:400px;border:1px solid var(--bd2);overflow:hidden;margin-top:6px}
  .proto-stack-seg{height:100%}
  .proto-legend{display:flex;gap:14px;margin-top:6px;font-size:11px;flex-wrap:wrap}
  .proto-legend span{display:flex;align-items:center;gap:5px}
  .proto-legend i{width:9px;height:9px;display:inline-block;flex-shrink:0}
  .area-badge{font-size:11px}
  .speed-badge{font-size:11px;color:var(--muted)}
  .row-actions{display:flex;gap:4px;white-space:nowrap;align-items:center}
  .row-actions button{padding:3px 7px;font-size:10px;height:auto}
  @media(max-width:720px){
    .topbar{flex-direction:column;align-items:flex-start}
    .brand{padding-bottom:8px}
  }
</style>`;

const HEAD = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${STYLE}`;

export function loginPage(msg = ""): string {
  return `${HEAD}<div class="box"><h2>管理登录</h2>${msg ? `<p class="err">${escapeHtml(msg)}</p>` : ""}
  <form method="post"><input type="hidden" name="action" value="login">
  <input name="code" placeholder="当季登录码" autocomplete="off" style="width:100%;margin-bottom:10px">
  <button style="width:100%">登录</button></form></div>`;
}

export function seedPage(msg = ""): string {
  return `${HEAD}<div class="box"><h2>查看当季登录码</h2>${msg ? `<p class="err">${escapeHtml(msg)}</p>` : ""}
  <form method="post"><input name="seed" placeholder="输入种子(SEED)" autocomplete="off" style="width:100%;margin-bottom:10px">
  <button style="width:100%">查看</button></form></div>`;
}

export function codesPage(q: string, codes: string[]): string {
  return `${HEAD}<div style="max-width:380px;margin:80px auto">
  <h2>${escapeHtml(q)} 登录码</h2><p class="sub">任一可登录后台:</p>
  <ul>${codes.map((c) => `<li><code>${c}</code></li>`).join("")}</ul></div>`;
}

export function noticeHtml(msg: string, good: boolean): string {
  return `<div class="notice ${good ? "good" : "bad"}">${escapeHtml(msg)}</div>`;
}

const CLIENT_TAG_LIST: { tag: string; label: string }[] = [
  { tag: "singbox", label: "sing-box(全协议)" },
  { tag: "clash", label: "OpenClash/mihomo(全协议)" },
  { tag: "v2box", label: "V2Box(vless+trojan)" },
  { tag: "v2rayn", label: "v2rayN(vless+trojan)" },
];

const FORMAT_LABEL: Record<string, string> = { base64: "base64", singbox: "sing-box", clash: "clash" };

function tagNodeCount(tag: string, stats: NodeStats): number {
  // v2box/v2rayn 标签只保留 vless+trojan(不支持 anytls);其余标签是全协议池
  if (tag === "v2box" || tag === "v2rayn") return stats.vless + stats.trojan;
  return stats.total;
}

export function dashboardPage(opts: {
  devices: Device[];
  nodes: string;
  nodesUpdated: number;
  nodeStats: NodeStats;
  origin: string;
  hasHistory: boolean;
  notice?: string;
}): string {
  const { devices, nodes, nodesUpdated, nodeStats, origin, hasHistory, notice = "" } = opts;

  const rows = devices.map((d) => {
    const link = `${origin}/l/${encodeURIComponent(d.username)}/${d.id}`;
    const j = JSON.stringify(link);
    const fmt = d.format ?? "base64";
    const detailId = `taglinks-${d.id}`;
    const defaultRow = `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--bd2)">
        <span style="min-width:170px;font-weight:600;font-size:12px">默认格式(${FORMAT_LABEL[fmt]},不带标签)</span>
        <code style="font-size:11px;flex:1;overflow:auto;color:var(--muted)">${link}</code>
        <span class="tag" style="flex-shrink:0">${nodeStats.total} 个有效节点</span>
        <button type="button" class="ghost" onclick='copyLink(${j},this)'>复制</button>
      </div>`;
    const tagRows = CLIENT_TAG_LIST.map(({ tag, label }) => {
      const tagLink = `${link}/${tag}`;
      const tj = JSON.stringify(tagLink);
      const count = tagNodeCount(tag, nodeStats);
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--bd2)">
        <span style="min-width:170px;font-weight:600;font-size:12px">${label}</span>
        <code style="font-size:11px;flex:1;overflow:auto;color:var(--muted)">${tagLink}</code>
        <span class="tag" style="flex-shrink:0">${count} 个有效节点</span>
        <button type="button" class="ghost" onclick='copyLink(${tj},this)'>复制</button>
      </div>`;
    }).join("");
    return `<tr>
      <td><strong>${escapeHtml(d.username)}</strong></td>
      <td style="color:var(--muted)">${escapeHtml(d.note)}</td>
      <td><span class="status ${d.enabled ? "on" : "off"}">${d.enabled ? "启用" : "停用"}</span></td>
      <td><span class="tag">${FORMAT_LABEL[fmt]}(默认)</span></td>
      <td class="hits">${timeAgo(d.lastSeen)}<br><span style="opacity:.7">共 ${d.hits ?? 0} 次</span></td>
      <td><button type="button" class="ghost" onclick="toggleDeviceDetail('${detailId}')">链接</button></td>
      <td><div class="actions">
        <button type="button" class="ghost" onclick='copyLink(${j},this)'>复制</button>
        <button type="button" class="ghost" onclick='showQR(${j})'>二维码</button>
        <a href="?user=${encodeURIComponent(d.username)}"><button type="button" class="ghost">详情</button></a>
        <form method="post"><input type="hidden" name="action" value="switchformat"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="ghost" title="当前默认 ${FORMAT_LABEL[fmt]},点击切换(不带标签的旧链接会跟着变)">默认格式</button></form>
        <form method="post"><input type="hidden" name="action" value="rotate"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="ghost" onclick="return confirm('换链接后旧链接立即失效,需重新发给对方。继续?')">换链接</button></form>
        <form method="post"><input type="hidden" name="action" value="toggle"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="ghost">${d.enabled ? "停用" : "启用"}</button></form>
        <form method="post" onsubmit="return confirm('删除 ${escapeHtml(d.username)} ?')"><input type="hidden" name="action" value="del"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="danger">删除</button></form>
      </div></td></tr>
      <tr class="device-detail-tr" id="${detailId}" style="display:none">
        <td colspan="7" style="background:var(--bg);padding:14px 20px 16px">
          <div style="margin-left:22px;border-left:3px solid var(--bd);padding-left:16px">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px">全部链接(含默认格式和按客户端类型的标签链接)</div>
            ${defaultRow}
            ${tagRows}
          </div>
        </td>
      </tr>`;
  }).join("");

  const updatedText = nodesUpdated
    ? `上次更新:${timeAgo(nodesUpdated)}(${new Date(nodesUpdated).toLocaleString("zh-CN")})`
    : "尚未保存过节点";

  return `${HEAD}
  <div class="topbar">
    <div class="brand">proxy-sub</div>
    <nav class="nav">
      <a data-pane="devices" class="active" onclick="showPane('devices',this)">设备管理</a>
      <a data-pane="nodes" onclick="showPane('nodes',this)">节点内容</a>
      <a data-pane="status" onclick="showPane('status',this)">状态</a>
      <a data-pane="backup" onclick="showPane('backup',this)">备份</a>
      <a data-pane="system" onclick="showPane('system',this)">系统 / 邮件</a>
      <a href="${ADMIN_PATH}/tools" class="tool-link">🧰 工具箱</a>
    </nav>
  </div>
  ${notice}
  <div class="main">

      <section class="pane active" id="pane-devices">
        <h2>设备管理</h2>
        <form method="post" class="addform"><input type="hidden" name="action" value="add">
          <input name="username" placeholder="用户名(如 dell3600_kingGarden)" required>
          <input name="note" placeholder="设备码(留空自动生成数字)">
          <select name="format">
            <option value="base64">base64(v2rayN/Shadowrocket/V2Box)</option>
            <option value="singbox">sing-box</option>
            <option value="clash">clash(OpenClash/mihomo)</option>
          </select>
          <button>添加设备</button></form>
        <div class="tablewrap"><table><tr><th>用户名</th><th>设备码</th><th>状态</th><th>格式</th><th>最近访问</th><th>链接</th><th>操作</th></tr>
          ${rows || `<tr><td colspan="7" style="color:var(--muted)">暂无设备</td></tr>`}</table></div>
      </section>

      <section class="pane" id="pane-nodes">
        <h2>节点内容</h2>
        <p class="sub" style="margin-bottom:14px">
          共 <strong id="node-count">0</strong> 个节点 · ${escapeHtml(updatedText)}
          <span id="dirty-badge" class="tag tag-accent" style="display:none;margin-left:8px">未保存</span>
        </p>
        <p class="sub" style="margin-bottom:14px">
          点表头按那一列排序(协议/Server/Port/地区/速度/安全,再点一次反向)。操作列里的 ▲▼ 单步移动,☰ 可以直接拖拽——都只在启用组或停用组内部生效,想让哪个排最前就挪到最上面,不一定是速度最快的那个。
          "停用"的节点会自动沉到最后,并且<strong>不会再推给任何客户端</strong>(真的从订阅内容里拿掉,不是只在这里看不见),随时可以再启用。
          "解析"跳转到工具箱的节点链接解析,看完可以返回这里(未保存的改动会先提醒你)。
        </p>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
          <button type="button" class="ghost" onclick="selectAllNodes(true)">全选</button>
          <button type="button" class="ghost" onclick="selectAllNodes(false)">全部取消</button>
          <button type="button" class="danger" onclick="deleteSelectedNodes()">删除选中(<span id="sel-count">0</span>)</button>
        </div>

        <div id="node-table-wrap">
          <table id="node-table">
            <thead><tr>
              <th style="width:26px"></th>
              <th class="sortable" onclick="sortBy('protocol')">协议<span class="arrow" id="arrow-protocol"></span></th>
              <th class="sortable" onclick="sortBy('server')">Server<span class="arrow" id="arrow-server"></span></th>
              <th class="sortable" onclick="sortBy('port')">Port<span class="arrow" id="arrow-port"></span></th>
              <th class="sortable" onclick="sortBy('area')">地区<span class="arrow" id="arrow-area"></span></th>
              <th class="sortable" onclick="sortBy('speed')">速度<span class="arrow" id="arrow-speed"></span></th>
              <th class="sortable" onclick="sortBy('security')">安全<span class="arrow" id="arrow-security"></span></th>
              <th style="width:250px">操作</th>
            </tr></thead>
            <tbody id="node-tbody"></tbody>
          </table>
        </div>

        <h2 style="font-size:15px;margin-top:24px">追加节点</h2>
        <p class="sub" style="margin-bottom:8px">粘贴一条或多条节点链接,一行一个。会自动跳过与已有列表重复的,追加的节点默认排在启用组最后面。</p>
        <textarea id="add-input" rows="4" style="width:100%" placeholder="vless://...&#10;anytls://...&#10;trojan://...&#10;vmess://...&#10;ss://..."></textarea>
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
          <button type="button" class="ghost" onclick="appendNodes()">追加到列表</button>
          <span id="add-msg" class="sub"></span>
        </div>

        <div class="hr"></div>

        <form id="save-form" method="post" onsubmit="return prepareSaveNodes(this)" style="display:flex;gap:8px;align-items:center">
          <input type="hidden" name="action" value="savenodes">
          <input type="hidden" name="nodes" id="save-nodes-input">
          <button>保存节点</button>
          ${hasHistory ? `<button type="button" class="ghost" onclick="if(confirm('恢复到上一版节点?当前内容会被替换。'))document.getElementById('restoreForm').submit()">恢复上一版</button>` : ""}
        </form>
        ${hasHistory ? `<form id="restoreForm" method="post" style="display:none"><input type="hidden" name="action" value="restorenodes"></form>` : ""}
      </section>

      <section class="pane" id="pane-status">
        <h2>状态</h2>

        <h3 style="font-size:14px;margin:18px 0 8px">本批次(Mac mini 推送)</h3>
        <div class="tablewrap"><table>
          <tr><th style="width:180px">批次标签</th><td>${nodeStats.batchLabel ? escapeHtml(nodeStats.batchLabel) : "<span style='color:var(--muted)'>暂无(还没推送过)</span>"}</td></tr>
          <tr><th>Deno 收到时间</th><td>${
            nodesUpdated
              ? `<span style="color:${Date.now() - nodesUpdated > 24 * 3600 * 1000 ? "var(--accent)" : "var(--ok)"};font-weight:600">${timeAgo(nodesUpdated)}</span> · ${new Date(nodesUpdated).toLocaleString("zh-CN")}${Date.now() - nodesUpdated > 24 * 3600 * 1000 ? ' <span class="tag" style="background:var(--accent);color:#fff;border-color:var(--accent)">超过24小时未更新</span>' : ""}`
              : "—"
          }</td></tr>
          <tr><th>节点数(不含时间戳假节点)</th><td>
            <strong>${nodeStats.total}</strong> 个 — vless <strong>${nodeStats.vless}</strong> · anytls <strong>${nodeStats.anytls}</strong> · trojan <strong>${nodeStats.trojan}</strong>
            ${nodeStats.total > 0 ? `
            <div class="proto-stack">${[
              { n: nodeStats.vless, color: "#ec3013" },
              { n: nodeStats.anytls, color: "#9d5fc9" },
              { n: nodeStats.trojan, color: "#2f9e5b" },
            ].filter((s) => s.n > 0).map((s) => `<div class="proto-stack-seg" style="width:${(s.n / nodeStats.total * 100).toFixed(1)}%;background:${s.color}"></div>`).join("")}</div>
            <div class="proto-legend">
              <span><i style="background:#ec3013"></i>vless ${nodeStats.total ? Math.round(nodeStats.vless / nodeStats.total * 100) : 0}%</span>
              <span><i style="background:#9d5fc9"></i>anytls ${nodeStats.total ? Math.round(nodeStats.anytls / nodeStats.total * 100) : 0}%</span>
              <span><i style="background:#2f9e5b"></i>trojan ${nodeStats.total ? Math.round(nodeStats.trojan / nodeStats.total * 100) : 0}%</span>
            </div>` : ""}
          </td></tr>
        </table></div>
        ${nodeStats.batchLabel && nodeStats.batchLabel.includes("⚠") ? `<div class="notice bad" style="margin-top:12px">这批节点里有协议在吃缓存兜底(标签里带 ⚠),说明 Mac mini 上一轮该协议没测出新节点。</div>` : ""}

        <h3 style="font-size:14px;margin:24px 0 8px">服务器</h3>
        <div class="tablewrap"><table>
          <tr><th style="width:180px">部署地址</th><td class="url" style="max-width:none">${escapeHtml(origin)}</td></tr>
          <tr><th>当前服务器时间</th><td>${new Date().toLocaleString("zh-CN")}</td></tr>
          <tr><th>设备总数</th><td>${devices.length} 个(启用 ${devices.filter((d) => d.enabled).length} 个)</td></tr>
        </table></div>

        <h3 style="font-size:14px;margin:24px 0 8px">设备访问一览</h3>
        <div class="tablewrap"><table><tr><th>用户名</th><th>设备码</th><th>状态</th><th>累计次数</th><th>最近访问</th></tr>
          ${devices.length ? devices.map((d) => `<tr>
            <td><strong>${escapeHtml(d.username)}</strong></td>
            <td style="color:var(--muted)">${escapeHtml(d.note)}</td>
            <td><span class="status ${d.enabled ? "on" : "off"}">${d.enabled ? "启用" : "停用"}</span></td>
            <td>${d.hits ?? 0}</td>
            <td class="hits">${timeAgo(d.lastSeen)}</td>
          </tr>`).join("") : `<tr><td colspan="5" style="color:var(--muted)">暂无设备</td></tr>`}
        </table></div>
      </section>

      <section class="pane" id="pane-backup">
        <h2>备份</h2>
        <p class="sub">导出:把全部设备和节点存成一段文本,妥善保管,重建时可恢复。</p>
        <div class="row"><a href="?export=1"><button type="button" class="ghost">导出备份</button></a></div>
        <p class="sub" style="margin-top:18px;color:var(--accent)">恢复会覆盖现有全部设备和节点,谨慎使用。</p>
        <form method="post" class="row" onsubmit="return confirm('恢复将覆盖现有全部设备和节点!确定?')">
          <input type="hidden" name="action" value="importbackup">
          <input name="backup" placeholder="粘贴备份文本以恢复" style="flex:1;min-width:240px">
          <button class="danger">恢复备份</button>
        </form>
      </section>

      <section class="pane" id="pane-system">
        <h2>邮件测试</h2>
        <form method="post"><input type="hidden" name="action" value="testmail">
          <div class="row"><button class="ghost">发送测试邮件</button>
            <span class="sub">发送到 ${escapeHtml(ADMIN_EMAIL || "(未设置 ADMIN_EMAIL)")}</span></div></form>
      </section>

  </div>

  <div class="qr-mask" id="qrmask" onclick="if(event.target===this)this.classList.remove('show')">
    <div class="qr-card"><div id="qrbox"></div><p id="qrtext"></p>
      <button class="ghost" style="margin-top:14px" onclick="document.getElementById('qrmask').classList.remove('show')">关闭</button></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
  <script>
  function showPane(name, el){
    document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
    document.getElementById('pane-'+name).classList.add('active');
    document.querySelectorAll('.nav a[data-pane]').forEach(a=>a.classList.remove('active'));
    el.classList.add('active');
    try{ history.replaceState(null,'','#'+name); }catch(e){}
  }
  // 进页面时按 URL hash 恢复上次所在分类
  (function(){
    const h=(location.hash||'').replace('#','');
    if(h){ const el=document.querySelector('.nav a[data-pane="'+h+'"]'); if(el) showPane(h,el); }
  })();
  function toggleDeviceDetail(id){
    const target = document.getElementById(id);
    const isOpen = target.style.display !== 'none';
    document.querySelectorAll('.device-detail-tr').forEach(tr=>{ tr.style.display='none'; });
    target.style.display = isOpen ? 'none' : 'table-row';
  }
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

  // ===== 节点列表管理 =====
  // 重要:KV 里存的 nodes 是 Mac mini 推送时的原样格式——整段 base64(标准订阅格式),
  // 不是按行的明文列表。要拆成一条条节点显示,得先 base64 解码;保存回去时再编码回 base64,
  // 不然 base64 订阅格式的客户端(v2rayN/V2Box 等)直接读这个值时会解析失败。
  //
  // 每个节点在内存里是 {uri, disabled} 对象。停用的节点存回去时会加上 OFF_PREFIX 前缀,
  // 服务端(protocol-filter.ts 的 stripDisabled)会在返回给任何客户端之前把这些行整个剔除——
  // 不是只在这个页面看不见,是真的不会出现在任何格式/标签的订阅内容里。
  const b64enc = new TextEncoder(), b64dec = new TextDecoder();
  const OFF_PREFIX = '#OFF# ';
  function toB64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
  function fromB64(b64){ try{ const s=atob(b64.trim()); const a=new Uint8Array(s.length); for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i); return a; }catch(e){ return null; } }

  function decodeNodesBlob(raw){
    const trimmed = (raw||'').trim();
    if(!trimmed) return [];
    let text = trimmed;
    // 已经是明文列表(以协议前缀或停用标记开头)就不用解码,直接按行拆
    if(!/^(vmess|vless|trojan|anytls|ss|ssr):\\/\\//i.test(trimmed) && !trimmed.startsWith(OFF_PREFIX)){
      const bytes = fromB64(trimmed);
      if(bytes) text = b64dec.decode(bytes);
    }
    return text.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean).map(line=>{
      if(line.startsWith(OFF_PREFIX)) return { uri: line.slice(OFF_PREFIX.length), disabled: true };
      return { uri: line, disabled: false };
    });
  }

  // 把"US_1"这种带国家代码的文字前面补上对应国旗emoji;已经带旗子的原样返回(不重复加)。
  function flagOf(text){
    if(/[\\u{1F1E6}-\\u{1F1FF}]{2}/u.test(text)) return text;
    const m = text.match(/^([A-Z]{2})(?:[_\\-]|$)/);
    if(!m) return text;
    const cc = m[1];
    const flag = String.fromCodePoint(...[...cc].map(c=>0x1F1E6 + c.charCodeAt(0) - 65));
    return flag + ' ' + text;
  }

  // 协议图标(Claude Design 出的 mono 版,currentColor 描边,配合 CSS 里各协议的颜色)
  const PROTO_ICONS = {
    vless: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5l9 14 9-14"></path><path d="M8 5l4 6"></path></svg>',
    anytls: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9"></rect><path d="M8 11V7a4 4 0 0 1 8 0"></path><path d="M12 15v2"></path></svg>',
    trojan: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z"></path><path d="M9 12l2 2 4-4"></path></svg>',
    vmess: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14"></rect><path d="M3 6l9 7 9-7"></path></svg>',
    ss: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 8-8"></path><path d="M20 12a8 8 0 0 1-8 8"></path><circle cx="12" cy="12" r="2.5"></circle></svg>',
  };
  const PROTO_COLOR_HEX = { vless:'#ec3013', anytls:'#9d5fc9', trojan:'#2f9e5b', vmess:'#3a6fd8', ss:'#c98a1f' };

  function parseNodeDisplay(uri){
    const m = uri.match(/^([a-zA-Z0-9]+):\\/\\//);
    const proto = m ? m[1] : '?';
    const h = uri.indexOf('#');
    let name = h>=0 ? uri.slice(h+1) : '';
    try{ name = decodeURIComponent(name); }catch(e){}
    return { proto, name };
  }

  // 从 URI 里抠出 server/port/security,以及从名字里抠出地区/速度,给表格列和排序用。
  // vmess:// 整段是 base64 JSON,不是标准 URL,单独处理;vless/trojan/anytls 都是标准 URL 能直接解析。
  function parseNodeFields(item){
    const uri = item.uri;
    const { proto, name } = parseNodeDisplay(uri);
    const badges = name.split('|').map(s=>s.trim()).filter(Boolean);
    const area = badges[0] || '-';
    const speedBadge = badges.find(b=>/\\d+(\\.\\d+)?\\s*[KMGT]?B\\/s/i.test(b)) || '-';
    let server='-', port='', security='-';
    if(proto==='vmess'){
      try{
        const j = JSON.parse(b64dec.decode(fromB64(uri.slice(8))));
        server = j.add||'-'; port = j.port||''; security = j.tls==='tls'?'tls':'none';
      }catch(e){}
    }else{
      try{
        const u = new URL(uri);
        server = u.hostname||'-'; port = u.port||'';
        if(proto==='vless') security = u.searchParams.get('security')||'none';
        else if(proto==='trojan'||proto==='anytls') security = 'tls';
        else if(proto==='ss') security = '-';
      }catch(e){}
    }
    return { proto, server, port: port?Number(port):0, area, speed: speedBadge, security, name };
  }
  function speedSortValue(s){
    const m = String(s).match(/(\\d+(?:\\.\\d+)?)\\s*([KMGT]?)B\\/s/i);
    if(!m) return -1;
    const n = parseFloat(m[1]); const unit = m[2].toUpperCase();
    const mult = unit==='G'?1024*1024 : unit==='M'?1024 : unit==='K'?1 : 1/1024;
    return n*mult;
  }

  const INITIAL_NODES = ${JSON.stringify(nodes)};
  let nodeLines = decodeNodesBlob(INITIAL_NODES);
  let dirty = false;
  let sortCol = null, sortDir = 1;
  let dragSrc = null;

  function markDirty(){ dirty = true; document.getElementById('dirty-badge').style.display='inline-block'; }

  // 保证不变量:启用的节点都排在停用的节点前面(组内相对顺序不变——JS sort 是稳定排序)
  function settleGroups(){ nodeLines.sort((a,b)=>(a.disabled?1:0)-(b.disabled?1:0)); }

  function sortBy(col){
    if(sortCol===col) sortDir = -sortDir; else { sortCol = col; sortDir = 1; }
    nodeLines.sort((a,b)=>{
      const fa = parseNodeFields(a), fb = parseNodeFields(b);
      let va = fa[col], vb = fb[col];
      if(col==='speed'){ va = speedSortValue(fa.speed); vb = speedSortValue(fb.speed); }
      if(typeof va==='number' && typeof vb==='number') return (va-vb)*sortDir;
      return String(va).localeCompare(String(vb))*sortDir;
    });
    markDirty();
    renderNodeList();
  }

  function escAttr(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

  function renderNodeList(){
    settleGroups();
    document.querySelectorAll('#node-table .arrow').forEach(a=>a.textContent='');
    if(sortCol){ const a=document.getElementById('arrow-'+sortCol); if(a) a.textContent = sortDir>0?'▲':'▼'; }

    const tbody = document.getElementById('node-tbody');
    tbody.innerHTML = nodeLines.map((item,i)=>{
      const f = parseNodeFields(item);
      const upDisabled = i===0 || nodeLines[i-1].disabled !== item.disabled;
      const downDisabled = i===nodeLines.length-1 || nodeLines[i+1].disabled !== item.disabled;
      return '<tr class="'+(item.disabled?'off':'')+'" draggable="false" data-i="'+i+'" data-uri="'+escAttr(item.uri)+'"'
        + ' ondragover="event.preventDefault();this.classList.add(\\'drag-over\\')"'
        + ' ondragleave="this.classList.remove(\\'drag-over\\')"'
        + ' ondragstart="handleDragStart(event)" ondrop="handleDrop(event)" ondragend="handleDragEnd(event)">'
        + '<td><input type="checkbox" data-i="'+i+'" onchange="updateSelCount()"></td>'
        + '<td><span class="proto-badge p-'+f.proto+'">'+(PROTO_ICONS[f.proto]||'')+f.proto+'</span></td>'
        + '<td class="mono">'+escAttr(f.server)+'</td>'
        + '<td class="mono">'+(f.port||'-')+'</td>'
        + '<td class="area-badge">'+escAttr(flagOf(f.area))+'</td>'
        + '<td><div class="speed-cell"><span>'+escAttr(f.speed)+'</span><div class="speed-bar"><div class="speed-fill" style="width:'+(speedSortValue(f.speed)<0?0:Math.min(100,speedSortValue(f.speed)/2000*100))+'%"></div></div></div></td>'
        + '<td>'+escAttr(f.security)+'</td>'
        + '<td><div class="row-actions">'
        +   '<button type="button" class="ghost" onclick="copyLink(this.closest(\\'tr\\').dataset.uri,this)">复制</button>'
        +   '<button type="button" class="ghost" onclick="goParse(this.closest(\\'tr\\').dataset.uri)">解析</button>'
        +   '<button type="button" class="ghost" '+(upDisabled?'disabled':'')+' onclick="moveNode('+i+',-1)">▲</button>'
        +   '<button type="button" class="ghost" '+(downDisabled?'disabled':'')+' onclick="moveNode('+i+',1)">▼</button>'
        +   '<span class="drag-handle" onmousedown="this.closest(\\'tr\\').draggable=true" onmouseup="this.closest(\\'tr\\').draggable=false"><span></span><span></span><span></span></span>'
        +   '<button type="button" class="ghost" onclick="toggleDisableNode('+i+')">'+(item.disabled?'启用':'停用')+'</button>'
        + '</div></td>'
        + '</tr>';
    }).join('');
    document.getElementById('node-count').textContent = nodeLines.length;
    updateSelCount();
  }
  function moveNode(i, dir){
    const j = i + dir;
    if(j<0 || j>=nodeLines.length) return;
    if(nodeLines[i].disabled !== nodeLines[j].disabled) return; // 只在同一组(启用/停用)内挪动
    const tmp = nodeLines[i]; nodeLines[i] = nodeLines[j]; nodeLines[j] = tmp;
    markDirty();
    renderNodeList();
  }
  function handleDragStart(e){ dragSrc = Number(e.currentTarget.dataset.i); e.dataTransfer.effectAllowed='move'; }
  function handleDrop(e){
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const dst = Number(e.currentTarget.dataset.i);
    if(dragSrc===null || dragSrc===dst){ dragSrc=null; return; }
    if(nodeLines[dragSrc].disabled !== nodeLines[dst].disabled){ dragSrc=null; return; } // 只在同一组内拖
    const [item] = nodeLines.splice(dragSrc,1);
    nodeLines.splice(dst,0,item);
    dragSrc = null;
    markDirty();
    renderNodeList();
  }
  function handleDragEnd(e){ e.currentTarget.draggable=false; dragSrc=null; }
  function goParse(uri){
    if(dirty && !confirm('还有未保存的改动,离开这页会丢失。确定要去解析这个节点吗?')) return;
    location.href = '${ADMIN_PATH}/tools?parse='+encodeURIComponent(uri)+'&back='+encodeURIComponent(location.href);
  }
  function updateSelCount(){
    const n = document.querySelectorAll('#node-tbody input[type=checkbox]:checked').length;
    document.getElementById('sel-count').textContent = n;
  }
  function selectAllNodes(v){
    document.querySelectorAll('#node-tbody input[type=checkbox]').forEach(cb=>cb.checked=v);
    updateSelCount();
  }
  function deleteSelectedNodes(){
    const idxs = Array.from(document.querySelectorAll('#node-tbody input[type=checkbox]:checked')).map(cb=>Number(cb.dataset.i));
    if(idxs.length===0) return;
    if(!confirm('删除选中的 '+idxs.length+' 个节点?(点下方"保存节点"才会真正生效)')) return;
    const idxSet = new Set(idxs);
    nodeLines = nodeLines.filter((_,i)=>!idxSet.has(i));
    markDirty();
    renderNodeList();
  }
  function toggleDisableNode(i){
    nodeLines[i].disabled = !nodeLines[i].disabled;
    markDirty();
    renderNodeList(); // 内部会调用 settleGroups(),停用的自动沉到最后
  }
  function appendNodes(){
    const raw = document.getElementById('add-input').value;
    const lines = raw.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean);
    const existing = new Set(nodeLines.map(n=>n.uri));
    let added = 0, skipped = 0;
    for(const l of lines){
      if(existing.has(l)){ skipped++; continue; }
      nodeLines.push({ uri: l, disabled: false }); existing.add(l); added++;
    }
    document.getElementById('add-input').value='';
    document.getElementById('add-msg').textContent = added+' 条已追加'+(skipped?(','+skipped+' 条重复已跳过'):'');
    if(added>0){ markDirty(); renderNodeList(); }
  }
  function prepareSaveNodes(form){
    settleGroups();
    const joined = nodeLines.map(n=> n.disabled ? (OFF_PREFIX+n.uri) : n.uri).join('\\n');
    if(nodeLines.every(n=>n.disabled) || nodeLines.length===0){
      if(!confirm('保存后所有设备将拿不到任何可用节点(节点是空的,或全部被停用了)。确定要保存?')) return false;
    }
    // 存回 KV 时编码回 base64,跟 Mac mini 推送时的格式保持一致(base64 订阅链接直接依赖这个格式)
    document.getElementById('save-nodes-input').value = joined ? toB64(b64enc.encode(joined + '\\n')) : '';
    return true;
  }
  renderNodeList();
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
        <div style="width:60%;height:${h || 2}px;background:${s.n ? "var(--accent)" : "var(--bd2)"}"></div>
        <div style="font-size:11px;color:var(--muted)">${s.label}</div>
      </div>`);
    }
    activity = `<div style="display:flex;align-items:flex-end;gap:6px;height:120px;padding:12px;border:2px solid var(--bd)">${bars.join("")}</div>`;
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
    if (uaCount > 1 || ipCount > 8) risk = `<span style="color:var(--accent)">偏高</span>(${ipCount} 个IP / ${uaCount} 种客户端)`;
    else if (ipCount > 4) risk = `<span style="color:var(--warn)">中</span>(${ipCount} 个IP / ${uaCount} 种客户端)`;
    else risk = `<span style="color:var(--ok)">低</span>(${ipCount} 个IP / ${uaCount} 种客户端)`;
  }

  // 最近领取(来自 KV 缓冲)
  const recentRows = recent.map((r) => {
    const t = new Date(r.ts).toLocaleString("zh-CN");
    return `<tr><td style="color:var(--muted)">${escapeHtml(t)}</td><td class="url">${escapeHtml(r.ip)}</td><td class="url">${escapeHtml(r.ua)}</td></tr>`;
  }).join("");

  const dbNote = dbEnabled
    ? `<p class="sub">说明:这是"订阅领取"活跃度,不是翻墙使用量。下方统计基于已归档数据,最近不足50条领取以"最近领取"列表为准。IP 多不一定是泄露(家庭宽带IP会变),但出现陌生 client 类型或 IP 数异常多时需留意。</p>`
    : `<p class="sub" style="color:var(--accent)">未配置 DATABASE_URL,Neon 归档未启用,仅显示 KV 里最近的领取记录,无长期统计。</p>`;

  return `${HEAD}
  <div style="max-width:1120px;margin:24px auto 0">
  <p><a href="${ADMIN_PATH}" style="color:var(--accent);text-decoration:none;font-weight:600">← 返回设备列表</a></p>
  <h2>${escapeHtml(username)} · 领取活跃度</h2>
  ${dbNote}
  ${stats ? `<p class="sub">累计领取 ${stats.total} 次 · 泄露风险:${risk}</p>` : ""}

  ${stats ? `<h2>近 7 天领取</h2>${activity}` : ""}

  ${stats && stats.ips.length ? `<h2>IP 记录(近30天)</h2>
  <table><tr><th>IP</th><th>次数</th><th>最近</th></tr>${ipRows}</table>` : ""}

  ${stats && stats.uas.length ? `<h2>客户端类型(近30天)</h2>
  <ul>${stats.uas.map((u) => `<li class="url">${escapeHtml(u)}</li>`).join("")}</ul>
  ${stats.uas.length > 1 ? `<p class="sub" style="color:var(--accent)">⚠ 出现多于一种 client,可能这条链接被用在了不止一台设备/被转发。</p>` : ""}` : ""}

  <h2>最近领取(实时)</h2>
  ${recentRows ? `<table><tr><th>时间</th><th>IP</th><th>客户端 UA</th></tr>${recentRows}</table>` : `<p class="sub">暂无最近领取记录。</p>`}
  </div>`;
}

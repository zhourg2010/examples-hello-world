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
  .actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;min-width:230px}
  .actions>form,.actions>a{margin:0;display:block}
  .actions a{text-decoration:none}
  .actions button{width:100%;font-size:11px;padding:7px 2px;height:32px}
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
  #node-list{border:2px solid var(--bd);max-height:440px;overflow-y:auto;background:#fff}
  .node-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--bd2);font-family:ui-monospace,Menlo,monospace;font-size:12px}
  .node-row:last-child{border-bottom:none}
  .node-row input[type=checkbox]{accent-color:var(--accent);width:15px;height:15px;flex-shrink:0}
  .node-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
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
    const tagLinks = CLIENT_TAG_LIST.map(({ tag, label }) => {
      const tagLink = `${link}/${tag}`;
      const tj = JSON.stringify(tagLink);
      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="min-width:150px;color:var(--muted);font-size:12px">${label}</span>
        <code style="font-size:11px;flex:1;overflow:auto">${tagLink}</code>
        <button type="button" class="ghost" onclick='copyLink(${tj},this)'>复制</button>
      </div>`;
    }).join("");
    return `<tr>
      <td><strong>${escapeHtml(d.username)}</strong></td>
      <td style="color:var(--muted)">${escapeHtml(d.note)}</td>
      <td><span class="status ${d.enabled ? "on" : "off"}">${d.enabled ? "启用" : "停用"}</span></td>
      <td><span class="tag">${FORMAT_LABEL[fmt]}(默认)</span></td>
      <td class="hits">${timeAgo(d.lastSeen)}<br><span style="opacity:.7">共 ${d.hits ?? 0} 次</span></td>
      <td class="url">${link}</td>
      <td><div class="actions">
        <button type="button" class="ghost" onclick='copyLink(${j},this)'>复制</button>
        <button type="button" class="ghost" onclick='showQR(${j})'>二维码</button>
        <a href="?user=${encodeURIComponent(d.username)}"><button type="button" class="ghost">详情</button></a>
        <form method="post"><input type="hidden" name="action" value="switchformat"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="ghost" title="当前默认 ${FORMAT_LABEL[fmt]},点击切换(不带标签的旧链接会跟着变)">默认格式</button></form>
        <form method="post"><input type="hidden" name="action" value="rotate"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="ghost" onclick="return confirm('换链接后旧链接立即失效,需重新发给对方。继续?')">换链接</button></form>
        <form method="post"><input type="hidden" name="action" value="toggle"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="ghost">${d.enabled ? "停用" : "启用"}</button></form>
        <form method="post" onsubmit="return confirm('删除 ${escapeHtml(d.username)} ?')"><input type="hidden" name="action" value="del"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="danger">删除</button></form>
      </div>
      <details style="margin-top:8px"><summary style="cursor:pointer;color:var(--muted);font-size:12px">按客户端类型的标签链接 ▾</summary>
        <div style="margin-top:6px">${tagLinks}</div>
      </details></td></tr>`;
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
          <input name="note" placeholder="备注(留空自动生成数字)">
          <select name="format">
            <option value="base64">base64(v2rayN/Shadowrocket/V2Box)</option>
            <option value="singbox">sing-box</option>
            <option value="clash">clash(OpenClash/mihomo)</option>
          </select>
          <button>添加设备</button></form>
        <div class="tablewrap"><table><tr><th>用户名</th><th>备注</th><th>状态</th><th>格式</th><th>最近访问</th><th>订阅链接</th><th>操作</th></tr>
          ${rows || `<tr><td colspan="7" style="color:var(--muted)">暂无设备</td></tr>`}</table></div>
      </section>

      <section class="pane" id="pane-nodes">
        <h2>节点内容</h2>
        <p class="sub" style="margin-bottom:14px">
          共 <strong id="node-count">0</strong> 个节点 · ${escapeHtml(updatedText)}
          <span id="dirty-badge" class="tag tag-accent" style="display:none;margin-left:8px">未保存</span>
        </p>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
          <button type="button" class="ghost" onclick="selectAllNodes(true)">全选</button>
          <button type="button" class="ghost" onclick="selectAllNodes(false)">全部取消</button>
          <button type="button" class="danger" onclick="deleteSelectedNodes()">删除选中(<span id="sel-count">0</span>)</button>
        </div>

        <div id="node-list"></div>

        <h2 style="font-size:15px;margin-top:24px">追加节点</h2>
        <p class="sub" style="margin-bottom:8px">粘贴一条或多条节点链接,一行一个。会自动跳过与已有列表重复的。</p>
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
          <tr><th>Deno 收到时间</th><td>${nodesUpdated ? `${timeAgo(nodesUpdated)} · ${new Date(nodesUpdated).toLocaleString("zh-CN")}` : "—"}</td></tr>
          <tr><th>节点数(不含时间戳假节点)</th><td><strong>${nodeStats.total}</strong> 个 — vless <strong>${nodeStats.vless}</strong> · anytls <strong>${nodeStats.anytls}</strong> · trojan <strong>${nodeStats.trojan}</strong></td></tr>
        </table></div>
        ${nodeStats.batchLabel && nodeStats.batchLabel.includes("⚠") ? `<div class="notice bad" style="margin-top:12px">这批节点里有协议在吃缓存兜底(标签里带 ⚠),说明 Mac mini 上一轮该协议没测出新节点。</div>` : ""}

        <h3 style="font-size:14px;margin:24px 0 8px">服务器</h3>
        <div class="tablewrap"><table>
          <tr><th style="width:180px">部署地址</th><td class="url" style="max-width:none">${escapeHtml(origin)}</td></tr>
          <tr><th>当前服务器时间</th><td>${new Date().toLocaleString("zh-CN")}</td></tr>
          <tr><th>设备总数</th><td>${devices.length} 个(启用 ${devices.filter((d) => d.enabled).length} 个)</td></tr>
        </table></div>

        <h3 style="font-size:14px;margin:24px 0 8px">设备访问一览</h3>
        <div class="tablewrap"><table><tr><th>用户名</th><th>备注</th><th>状态</th><th>累计次数</th><th>最近访问</th></tr>
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

  // ===== 节点 checkbox 列表管理 =====
  const INITIAL_NODES = ${JSON.stringify(nodes)};
  let nodeLines = INITIAL_NODES.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean);
  let dirty = false;

  function markDirty(){ dirty = true; document.getElementById('dirty-badge').style.display='inline-block'; }

  function renderNodeList(){
    const box = document.getElementById('node-list');
    box.innerHTML = nodeLines.map((line,i)=>
      '<div class="node-row"><input type="checkbox" data-i="'+i+'" onchange="updateSelCount()">'+
      '<span title="'+line.replace(/"/g,'&quot;')+'">'+line.replace(/</g,'&lt;')+'</span></div>'
    ).join('');
    document.getElementById('node-count').textContent = nodeLines.length;
    updateSelCount();
  }
  function updateSelCount(){
    const n = document.querySelectorAll('#node-list input[type=checkbox]:checked').length;
    document.getElementById('sel-count').textContent = n;
  }
  function selectAllNodes(v){
    document.querySelectorAll('#node-list input[type=checkbox]').forEach(cb=>cb.checked=v);
    updateSelCount();
  }
  function deleteSelectedNodes(){
    const idxs = Array.from(document.querySelectorAll('#node-list input[type=checkbox]:checked')).map(cb=>Number(cb.dataset.i));
    if(idxs.length===0) return;
    if(!confirm('删除选中的 '+idxs.length+' 个节点?(点下方"保存节点"才会真正生效)')) return;
    const idxSet = new Set(idxs);
    nodeLines = nodeLines.filter((_,i)=>!idxSet.has(i));
    markDirty();
    renderNodeList();
  }
  function appendNodes(){
    const raw = document.getElementById('add-input').value;
    const lines = raw.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean);
    const existing = new Set(nodeLines);
    let added = 0, skipped = 0;
    for(const l of lines){
      if(existing.has(l)){ skipped++; continue; }
      nodeLines.push(l); existing.add(l); added++;
    }
    document.getElementById('add-input').value='';
    document.getElementById('add-msg').textContent = added+' 条已追加'+(skipped?(','+skipped+' 条重复已跳过'):'');
    if(added>0){ markDirty(); renderNodeList(); }
  }
  function prepareSaveNodes(form){
    const joined = nodeLines.join('\\n');
    if(joined.trim()===''){
      if(!confirm('节点内容是空的!保存后所有设备将无法获取节点。确定要保存空内容?')) return false;
    }
    document.getElementById('save-nodes-input').value = joined;
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

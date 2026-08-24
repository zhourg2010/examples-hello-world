// free/ui.ts — 免费节点池的后台面板。
// 样式跟主后台保持一致(Modernist:米色底、零圆角、Archivo),但独立成一页,
// 免得把本来就长的主后台再撑长一截。

import { escapeHtml } from "../ui.ts";
import { ADMIN_PATH } from "../config.ts";
import { PER_CRED_CAP, PER_SOURCE_CAP } from "./harvest.ts";
import { SOURCES } from "./sources.ts";
import type { PoolStats } from "./store.ts";
import { FREE_PREFIX } from "./naming.ts";

const STYLE = `<style>
  @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap');
  :root{--bg:#f3f2f2;--fg:#1a1a1a;--muted:#6b6b68;--accent:#ec3013;--bd:#1a1a1a;--bd2:#c9c7c3;--card:#fff;--ok:#1a7a3c}
  *{box-sizing:border-box}
  body{font-family:'Archivo',system-ui,sans-serif;max-width:1120px;margin:0 auto;padding:0 20px 60px;color:var(--fg);background:var(--bg)}
  h2{margin:28px 0 6px;font-size:20px;font-weight:700}
  h3{margin:26px 0 8px;font-size:15px;font-weight:700}
  .sub{color:var(--muted);font-size:13px;line-height:1.7;margin:4px 0 14px}
  table{border-collapse:collapse;width:100%;font-size:13px;background:var(--card);border:2px solid var(--bd)}
  th,td{padding:7px 10px;text-align:left;border-bottom:1px solid var(--bd2);vertical-align:top}
  th{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .big{font-size:26px;font-weight:800;line-height:1.1}
  .cards{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 4px}
  .card{background:var(--card);border:2px solid var(--bd);padding:12px 16px;min-width:150px}
  .card .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  .btn{display:inline-block;background:var(--fg);color:#fff;border:2px solid var(--bd);padding:8px 16px;
    font:inherit;font-weight:700;font-size:13px;cursor:pointer}
  .btn.ghost{background:transparent;color:var(--fg)}
  .ok{color:var(--ok);font-weight:700}
  .bad{color:var(--accent);font-weight:700}
  /* 未验证的源用灰体标注,不用红色 —— 红色是"出错了"的意思,"没验证过"不是错 */
  .note{color:var(--muted);font-style:italic;font-size:12px}
  code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#eceae6;padding:1px 4px}
  #out{white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:11px;background:var(--card);
    border:2px solid var(--bd);padding:12px;margin-top:12px;max-height:420px;overflow:auto}
  #out:empty{display:none}
</style>`;

export function freePanel(stats: PoolStats | null): string {
  const srcRows = SOURCES.map((s) => {
    const hit = stats?.bySource.find((b) => b.source === s.id);
    return `<tr>
      <td><b>${escapeHtml(s.label)}</b><br><span class="note">${escapeHtml(s.note)}</span></td>
      <td>${escapeHtml(s.kind)}</td>
      <td>${s.enabled ? "启用" : '<span class="note">未启用</span>'}</td>
      <td>${s.verified ? '<span class="ok">已验证</span>' : '<span class="note">未验证</span>'}</td>
      <td class="num">${hit ? hit.n : "—"}</td>
      <td class="num">${hit ? escapeHtml(hit.last) : "—"}</td>
    </tr>`;
  }).join("");

  const protoRows = (stats?.byProto ?? []).map((p) =>
    `<tr><td>${escapeHtml(p.proto)}</td><td class="num">${p.n}</td></tr>`
  ).join("") || `<tr><td colspan="2" class="note">还没抓过</td></tr>`;

  const recentRows = (stats?.recent ?? []).map((r) =>
    `<tr><td>${escapeHtml(r.ts)}</td><td>${escapeHtml(r.source)}</td>
      <td>${r.ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'}</td>
      <td class="num">${r.parsed}</td><td class="num">${r.kept}</td>
      <td class="note">${escapeHtml(r.err)}</td></tr>`
  ).join("") || `<tr><td colspan="6" class="note">还没有抓取记录</td></tr>`;

  const noStore = stats === null
    ? `<p class="sub"><b>没有配置 DATABASE_URL</b> —— 免费池没有存储后端,抓取可以跑但结果不会落库。
       Deno Deploy 上没有能持久化的文件系统(isolate 无状态、冷启动换机器),所以服务器端的
       SQLite 文件存不住,这里用的是 Neon Postgres,连接串跟访问日志归档共用同一个 <code>DATABASE_URL</code>。</p>`
    : "";

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>免费节点池</title>${STYLE}</head><body>
<h2>免费节点池</h2>
<p class="sub">
  定期从公开的免费节点仓库抓取候选节点,去重后存进 Neon。抓到的节点名统一带
  <code>${escapeHtml(FREE_PREFIX)} | </code> 前导词,在客户端列表里跟自己机场的节点一眼分得开。<br>
  <b>这里的节点都没有实测过。</b>免费节点大部分是死的,而 Deno Deploy 上没有代理内核、拨不了这些节点,
  活性/速度/严格美国 GeoIP 只能由本地端(nodepipe 或客户端里的 mihomo)负责 —— 这一页只管把候选攒齐。
</p>
${noStore}

<div class="cards">
  <div class="card"><div class="lbl">池子总数</div><div class="big">${stats?.total ?? "—"}</div></div>
  <div class="card"><div class="lbl">不同凭据</div><div class="big">${stats?.creds ?? "—"}</div>
    <div class="note">真正不同的"服务"数</div></div>
  <div class="card"><div class="lbl">每凭据上限</div><div class="big">${PER_CRED_CAP}</div></div>
  <div class="card"><div class="lbl">每源上限</div><div class="big">${PER_SOURCE_CAP}</div></div>
</div>

<p style="margin:16px 0">
  <button class="btn" id="go">立刻抓一轮</button>
  <button class="btn ghost" id="pr">清理过期节点</button>
  <span class="note" style="margin-left:8px">平时由 Deno.cron 每 6 小时自动跑一轮,这里是手动补一次</span>
</p>
<div id="out"></div>

<h3>源</h3>
<table><thead><tr><th>源</th><th>类型</th><th>状态</th><th>验证</th><th class="num">池中条数</th><th class="num">最近一次</th></tr></thead>
<tbody>${srcRows}</tbody></table>

<h3>协议分布</h3>
<table><thead><tr><th>协议</th><th class="num">条数</th></tr></thead><tbody>${protoRows}</tbody></table>

<h3>最近的抓取记录</h3>
<table><thead><tr><th>时间</th><th>源</th><th>结果</th><th class="num">解析</th><th class="num">入库</th><th>错误</th></tr></thead>
<tbody>${recentRows}</tbody></table>

<p style="margin-top:24px"><a href="${ADMIN_PATH}">← 回后台</a></p>

<script>
function post(path, btn){
  var out = document.getElementById('out');
  var old = btn.textContent;
  btn.disabled = true; btn.textContent = '跑着呢…';
  out.textContent = '';
  fetch(path, {method:'POST'})
    .then(function(r){ return r.text(); })
    .then(function(t){ out.textContent = t; })
    .catch(function(e){ out.textContent = '失败: ' + e; })
    .finally(function(){ btn.disabled = false; btn.textContent = old; });
}
document.getElementById('go').onclick = function(){ post('${ADMIN_PATH}/free/harvest', this); };
document.getElementById('pr').onclick = function(){ post('${ADMIN_PATH}/free/prune', this); };
</script>
</body></html>`;
}

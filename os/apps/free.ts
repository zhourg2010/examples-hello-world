// os/apps/free.ts — 「免费节点池」app。
//
// 抓取和清理这两个动作**不走 /os/act**,而是直接打老后台已有的
// {ADMIN_PATH}/free/harvest 和 /free/prune —— 那两条路由本来就在,鉴权也一样是登录
// cookie,再往 actions.ts 里抄一份只会多一个会走偏的分叉。
//
// 抓一轮要跑挺久(九个源、每个最多 20 秒超时),所以按钮按下去要立刻变成"跑着呢",
// 并且把结果按源列出来,而不是像老面板那样甩一整坨 JSON —— 那玩意儿要一行行读。

import { escapeHtml } from "../../ui.ts";
import { ADMIN_PATH } from "../../config.ts";
import { PER_CRED_CAP, PER_SOURCE_CAP } from "../../free/harvest.ts";
import { SOURCES } from "../../free/sources.ts";
import { poolStats } from "../../free/store.ts";
import { FREE_PREFIX } from "../../free/naming.ts";
import { APP_CSS } from "./css.ts";

export async function freeApp(_origin: string): Promise<string> {
  const stats = await poolStats();

  const srcRows = SOURCES.map((s) => {
    const hit = stats?.bySource.find((b) => b.source === s.id);
    return `<tr>
      <td><b>${escapeHtml(s.label)}</b><br><span class="mono">${escapeHtml(s.note)}</span></td>
      <td>${escapeHtml(s.kind)}</td>
      <td>${
      s.enabled
        ? `<span class="pill on">启用</span>`
        : `<span class="pill off">未启用</span>`
    }</td>
      <td>${
      // 「未验证」不是错,所以不上红 —— 灰着就够了
      s.verified ? `<span class="dot ok"></span>已验证` : `<span class="dot off"></span>未验证`
    }</td>
      <td class="num">${hit ? hit.n : "—"}</td>
      <td class="num mono">${hit ? escapeHtml(hit.last) : "—"}</td>
    </tr>`;
  }).join("");

  const protoRows = (stats?.byProto ?? []).map((p) =>
    `<tr><td><span class="proto">${escapeHtml(p.proto)}</span></td><td class="num">${p.n}</td></tr>`
  ).join("") || `<tr><td colspan="2" class="empty">还没抓过</td></tr>`;

  const recentRows = (stats?.recent ?? []).map((r) =>
    `<tr><td class="mono">${escapeHtml(r.ts)}</td><td>${escapeHtml(r.source)}</td>
      <td>${r.ok ? `<span class="dot ok"></span>成功` : `<span class="dot warn"></span>失败`}</td>
      <td class="num">${r.parsed}</td><td class="num">${r.kept}</td>
      <td class="mono">${escapeHtml(r.err)}</td></tr>`
  ).join("") || `<tr><td colspan="6" class="empty">还没有抓取记录</td></tr>`;

  // 没配 DATABASE_URL 时先把话说清楚,不然会以为是抓取坏了
  const noStore = stats === null
    ? `<div class="note warn"><b>没有配置 DATABASE_URL</b> —— 免费池没有存储后端,抓取能跑但结果不会落库。
       Deno Deploy 上没有能持久化的文件系统(isolate 无状态、冷启动换机器),服务器端的 SQLite 文件
       存不住,所以这里用的是 Neon Postgres,连接串跟访问日志归档共用同一个 <code>DATABASE_URL</code>。</div>`
    : "";

  return `${APP_CSS}${CSS}
<h3>免费节点池</h3>
<div class="sub">
  定期从公开的免费节点仓库抓候选,去重后存进 Neon。节点名统一带
  <code>${escapeHtml(FREE_PREFIX)} | </code> 前导词,在客户端列表里跟自己机场的节点一眼分得开。
</div>
<div class="note warn">
  <b>这里的节点都没有实测过。</b>免费节点大部分是死的,而 Deno Deploy 上没有代理内核、拨不了它们 ——
  活性、速度、以及那道严格的美国 GeoIP 核实,只能由本地端(nodepipe 或客户端里的 mihomo)负责。
  这一页只管把候选攒齐,<b>不要</b>把池子直接接到推送上。
</div>
${noStore}

<div class="cards">
  <div class="card"><span>池子总数</span><b>${stats?.total ?? "—"}</b></div>
  <div class="card"><span>不同凭据</span><b>${stats?.creds ?? "—"}</b><i>真正不同的"服务"数</i></div>
  <div class="card"><span>每凭据上限</span><b>${PER_CRED_CAP}</b></div>
  <div class="card"><span>每源上限</span><b>${PER_SOURCE_CAP}</b></div>
</div>

<div class="row">
  <button type="button" class="btn primary" data-fr="harvest">立刻抓一轮</button>
  <button type="button" class="btn" data-fr="prune">清理过期节点</button>
  <span class="sub" style="margin:0">平时 Deno.cron 每 6 小时自动跑一轮,这里是手动补一次</span>
</div>
<div id="fr-out"></div>

<h4>源</h4>
<div style="overflow-x:auto"><table><thead><tr>
  <th>源</th><th>类型</th><th>状态</th><th>验证</th><th class="num">池中条数</th><th class="num">最近一次</th>
</tr></thead><tbody>${srcRows}</tbody></table></div>

<h4>协议分布</h4>
<table><thead><tr><th>协议</th><th class="num">条数</th></tr></thead><tbody>${protoRows}</tbody></table>

<h4>最近的抓取记录</h4>
<div style="overflow-x:auto"><table><thead><tr>
  <th>时间</th><th>源</th><th>结果</th><th class="num">解析</th><th class="num">入库</th><th>错误</th>
</tr></thead><tbody>${recentRows}</tbody></table></div>

<script>
(function(){
const root = document.currentScript.closest('.body');
const out = root.querySelector('#fr-out');
const esc = s => String(s??'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

root.addEventListener('click', async e => {
  const b = e.target.closest('[data-fr]');
  if(!b) return;
  const kind = b.dataset.fr;
  const old = b.textContent;
  b.disabled = true;
  b.textContent = kind === 'harvest' ? '抓着呢…(可能要一分钟)' : '清理中…';
  out.innerHTML = '';
  try{
    const r = await fetch(${JSON.stringify(ADMIN_PATH)} + '/free/' + kind, { method:'POST' });
    const data = await r.json();
    out.innerHTML = kind === 'harvest' ? harvestReport(data) : pruneReport(data);
    window.os && window.os.toast(
      kind === 'harvest' ? ('抓完了,入库 ' + (data.totalKept ?? 0) + ' 条') : ('清掉了 ' + (data.pruned ?? 0) + ' 条'),
      true);
    // 表格里的数字是服务端渲染的,抓完就过时了 —— 重拉一次自己
    setTimeout(() => window.os && window.os.refresh('free', true), 1200);
  }catch(err){
    out.innerHTML = '<div class="note warn">失败:' + esc(String(err)) + '</div>';
    window.os && window.os.toast('失败:' + err, false);
  }finally{
    b.disabled = false; b.textContent = old;
  }
});

function harvestReport(d){
  const rows = (d.sources||[]).map(s => {
    const dropped = Object.entries(s.dropped||{}).map(([k,v]) => esc(k)+' '+v).join(' · ');
    return '<tr><td>'+(s.ok?'<span class="dot ok"></span>':'<span class="dot warn"></span>')+esc(s.label)+'</td>'
      + '<td class="num">'+(s.parsed||0)+'</td><td class="num">'+(s.kept||0)+'</td>'
      + '<td class="mono">'+(s.files!=null?('子文件 '+s.files+' 个 '):'')+esc(dropped)+'</td>'
      + '<td class="mono">'+esc(s.err||'')+'</td></tr>';
  }).join('');
  return '<div class="note info">跨源去重后共入库 <b>'+(d.totalKept??0)+'</b> 条'
    + (d.stored ? '' : '(<b>没有落库</b> —— 没配 DATABASE_URL)') + '</div>'
    + '<div style="overflow-x:auto"><table><thead><tr><th>源</th><th class="num">解析</th>'
    + '<th class="num">入库</th><th>丢弃</th><th>错误</th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="5" class="empty">没有启用的源</td></tr>')
    + '</tbody></table></div>';
}
function pruneReport(d){
  return '<div class="note info">清掉了 <b>'+(d.pruned??0)+'</b> 条很久没再出现的节点。</div>';
}
})();
</script>`;
}

const CSS = `<style>
.body .num{text-align:right;font-variant-numeric:tabular-nums}
.body th.num{text-align:right}
.body code{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:11px;
  background:#f2f2f4;padding:1px 5px;border-radius:4px}
.body .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:9px;margin:14px 0}
.body .card{background:#fafafa;border:.5px solid #e4e4e8;border-radius:11px;padding:11px 13px}
.body .card span{font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#86868b}
.body .card b{display:block;font-size:24px;font-weight:800;letter-spacing:-.03em;margin-top:4px;
  color:#1d1d1f;font-variant-numeric:tabular-nums}
.body .card i{display:block;font-style:normal;font-size:10.5px;color:#86868b;margin-top:2px}
.body .proto{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:5px;
  background:#f2f2f4;color:#6b6b70}
.body #fr-out:empty{display:none}
.body #fr-out{margin-top:12px}
</style>`;

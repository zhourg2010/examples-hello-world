// os/apps/nodes.ts — 「节点内容」app:改订阅里到底发哪些节点。
//
// 这是六个 app 里唯一一个**在浏览器里维护状态**的:整份节点列表读进内存,排序、拖拽、
// 启停、删除都只动内存,点"保存节点"才写回 KV。所以这个窗口是有"未保存"概念的,
// 外壳那边为此加了两道保护(见 shell.ts 的 refresh/doWin):别的窗口做操作时不会
// 把这里冲掉,关窗前会问一句。
//
// 存储格式这件事必须说清楚,改错了是线上事故:
//   KV 里的 nodes 是 Mac mini 推上来的**原样格式** —— 整段 base64(标准订阅格式),
//   不是按行的明文。所以读进来先解码,存回去再编码回 base64;不然直接读这个值的
//   base64 客户端(v2rayN / V2Box 等)会解析失败。
//   停用的节点存回去时加 OFF_PREFIX 前缀,protocol-filter.ts 的 stripDisabled 会在
//   发给任何客户端之前整行剔掉 —— 是真的不发,不是只在这一页看不见。
//
// 老后台那份实现(ui.ts 的 dashboardPage)往 window 上挂了一堆 sortBy/moveNode 这样的
// 全局函数。桌面版不能这么干:六个 app 共用同一个 window,重名迟早撞车,而且窗口关了
// 函数还留着。这里整个包在 IIFE 里,DOM 事件一律走委托,对外只碰外壳给的 window.os。

import { escapeHtml, jsonForScript } from "../../ui.ts";
import { getNodeHistory, getNodes, getNodesUpdated } from "../../kv.ts";
import { ADMIN_PATH, NODE_CAP } from "../../config.ts";
import { APP_CSS } from "./css.ts";

export async function nodesApp(_origin: string): Promise<string> {
  const [nodes, updated, history] = await Promise.all([
    getNodes(),
    getNodesUpdated(),
    getNodeHistory(),
  ]);
  const hasHistory = history.length > 0;

  const updatedText = updated
    ? `${new Date(updated).toLocaleString("zh-CN")}`
    : "还没收到过推送";
  const stale = updated > 0 && Date.now() - updated > 24 * 3600 * 1000;

  return `${APP_CSS}${CSS}
<h3>节点内容</h3>
<div class="sub">
  共 <strong id="nd-count">0</strong> 个节点 · 最后一次推送 ${escapeHtml(updatedText)}
  ${stale ? `<span class="pill warn" style="margin-left:6px">超过 24 小时没更新</span>` : ""}
  <span id="nd-dirty" class="pill warn" style="display:none;margin-left:6px">未保存</span>
</div>
<div class="note info">
  点表头按那一列排序,再点一次反向。<strong>▲▼</strong> 单步移动,<strong>☰</strong> 可以直接拖 ——
  都只在启用组或停用组<strong>内部</strong>生效。想让哪个排最前就挪到最上面,不一定得是最快的那个。<br>
  「停用」的节点会沉到最后,并且<strong>不会再推给任何客户端</strong>(真的从订阅内容里拿掉),随时可以再启用。
</div>

<div class="row">
  <button type="button" class="btn sm" data-nd="all">全选</button>
  <button type="button" class="btn sm" data-nd="none">全部取消</button>
  <button type="button" class="btn sm danger" data-nd="delsel">删除选中(<span id="nd-sel">0</span>)</button>
</div>

<div style="overflow-x:auto">
<table id="nd-table"><thead><tr>
  <th style="width:24px"></th>
  <th class="srt" data-col="proto">协议<i></i></th>
  <th class="srt" data-col="server">Server<i></i></th>
  <th class="srt" data-col="port">Port<i></i></th>
  <th class="srt" data-col="area">地区<i></i></th>
  <th class="srt" data-col="speed">速度<i></i></th>
  <th class="srt" data-col="security">安全<i></i></th>
  <th style="width:210px">操作</th>
</tr></thead><tbody id="nd-body"></tbody></table>
</div>

<h4>追加节点</h4>
<div class="sub">一行一个。与已有重复、或格式认不出来的行会自动跳过。新节点插到启用组<strong>最前面</strong>,
末尾那条"自我节点"(时间戳)会刷新成现在的时间;启用的真节点超过 ${NODE_CAP} 个就从末尾砍掉多出来的
—— 点「保存节点」才真正生效。</div>
<textarea id="nd-add" rows="4" placeholder="vless://...&#10;anytls://...&#10;trojan://...&#10;vmess://...&#10;ss://..."></textarea>
<div class="row">
  <button type="button" class="btn" data-nd="append">追加到列表</button>
  <span id="nd-msg" class="sub" style="margin:0"></span>
</div>

<div class="hr"></div>
<div class="row">
  <button type="button" class="btn primary" data-nd="save">保存节点</button>
  ${hasHistory ? `<button type="button" class="btn" data-nd="restore">恢复上一版</button>` : ""}
</div>

<script>
(function(){
${fill(CLIENT_JS, {
    __INITIAL__: jsonForScript(nodes),
    __CAP__: String(NODE_CAP),
    __ADMIN__: jsonForScript(ADMIN_PATH),
  })}
})();
</script>`;
}

/**
 * 往脚本模板里填值。**不能用 str.replace(pat, value)** —— replace 的第二个参数
 * 里 `$&`/`$1` 这类序列有特殊含义,节点名里真出现 `$&` 就会被悄悄改写成别的东西。
 * 用函数形式的替换,值就是字面量。
 */
function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/__[A-Z]+__/g, (m) => (m in vars ? vars[m] : m));
}

const CLIENT_JS = String.raw`
const root = document.currentScript.closest('.body');
const $ = s => root.querySelector(s);

// 停用标记 / 时间戳"自我节点"前缀 / 池子上限 —— 三个都必须跟别处保持一致:
// OFF_PREFIX 对应 protocol-filter.ts 的 stripDisabled;MARKER_PREFIX 对应
// nodepipe/select_and_push.py 的 marker_uri 和 node-stats.ts;上限对应 config.ts 的
// NODE_CAP 和 Mac 端的 MAX_NODES。改一处不改其余,症状是"数字对不上"这种最难查的 bug。
const OFF_PREFIX = '#OFF# ';
const MARKER_PREFIX = 'vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1';
const CAP = __CAP__;
const ADMIN = __ADMIN__;

const enc = new TextEncoder(), dec = new TextDecoder();
function toB64(bytes){ let s=''; for(const b of bytes) s+=String.fromCharCode(b); return btoa(s); }
function fromB64(b64){
  try{ const s=atob(b64.trim()); const a=new Uint8Array(s.length);
    for(let i=0;i<s.length;i++) a[i]=s.charCodeAt(i); return a; }catch(e){ return null; }
}
function esc(s){ return String(s??'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function decodeBlob(raw){
  const t = (raw||'').trim();
  if(!t) return [];
  let text = t;
  // 已经是明文列表(协议前缀或停用标记开头)就不解码,直接按行拆
  if(!/^(vmess|vless|trojan|anytls|ss|ssr):\/\//i.test(t) && !t.startsWith(OFF_PREFIX)){
    const bytes = fromB64(t);
    if(bytes) text = dec.decode(bytes);
  }
  return text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line =>
    line.startsWith(OFF_PREFIX)
      ? { uri: line.slice(OFF_PREFIX.length), disabled: true }
      : { uri: line, disabled: false });
}

// "US_1" 这种带国家代码的名字前面补上国旗;已经有旗子的原样返回(不重复加)
function flagOf(text){
  if(/[\u{1F1E6}-\u{1F1FF}]{2}/u.test(text)) return text;
  const m = String(text).match(/^([A-Z]{2})(?:[_\-]|$)/);
  if(!m) return text;
  return String.fromCodePoint(...[...m[1]].map(c=>0x1F1E6 + c.charCodeAt(0) - 65)) + ' ' + text;
}

// 从 URI 里抠出 server/port/security,从名字里抠出地区/速度。
// vmess:// 整段是 base64 JSON 不是标准 URL,单独处理;其余都能直接 new URL。
function fields(item){
  const uri = item.uri;
  const pm = uri.match(/^([a-zA-Z0-9]+):\/\//);
  const proto = pm ? pm[1] : '?';
  const h = uri.indexOf('#');
  let name = h>=0 ? uri.slice(h+1) : '';
  try{ name = decodeURIComponent(name); }catch(e){}
  const badges = name.split('|').map(s=>s.trim()).filter(Boolean);
  const area = badges[0] || '-';
  const speed = badges.find(b=>/\d+(\.\d+)?\s*[KMGT]?B\/s/i.test(b)) || '-';
  let server='-', port='', security='-';
  if(proto === 'vmess'){
    try{
      const j = JSON.parse(dec.decode(fromB64(uri.slice(8))));
      server = j.add||'-'; port = j.port||''; security = j.tls==='tls' ? 'tls' : 'none';
    }catch(e){}
  }else{
    try{
      const u = new URL(uri);
      server = u.hostname||'-'; port = u.port||'';
      if(proto==='vless') security = u.searchParams.get('security')||'none';
      else if(proto==='trojan'||proto==='anytls') security = 'tls';
    }catch(e){}
  }
  return { proto, server, port: port?Number(port):0, area, speed, security, name };
}
function speedVal(s){
  const m = String(s).match(/(\d+(?:\.\d+)?)\s*([KMGT]?)B\/s/i);
  if(!m) return -1;
  const unit = m[2].toUpperCase();
  return parseFloat(m[1]) * (unit==='G'?1048576 : unit==='M'?1024 : unit==='K'?1 : 1/1024);
}

let lines = decodeBlob(__INITIAL__);
let sortCol = null, sortDir = 1, dragSrc = null, dirty = false;

function markDirty(on){
  dirty = on;
  $('#nd-dirty').style.display = on ? '' : 'none';
  window.os && window.os.dirty(root, on);
}
/** 不变量:启用的一律排在停用的前面。JS sort 是稳定的,组内相对顺序不动。 */
function settle(){ lines.sort((a,b)=>(a.disabled?1:0)-(b.disabled?1:0)); }

function render(){
  settle();
  root.querySelectorAll('.srt i').forEach(i => i.textContent = '');
  if(sortCol){
    const th = root.querySelector('.srt[data-col="'+sortCol+'"] i');
    if(th) th.textContent = sortDir>0 ? ' ▲' : ' ▼';
  }
  $('#nd-body').innerHTML = lines.map((item,i) => {
    const f = fields(item);
    // ▲▼ 只在同组内有意义,跨组的那一步直接禁用 —— 比点了没反应好
    const upOff   = i===0 || lines[i-1].disabled !== item.disabled;
    const downOff = i===lines.length-1 || lines[i+1].disabled !== item.disabled;
    const sv = speedVal(f.speed);
    return '<tr class="nd-r'+(item.disabled?' off':'')+'" data-i="'+i+'" data-uri="'+esc(item.uri)+'">'
      + '<td><input type="checkbox" data-nd="cb"></td>'
      + '<td><span class="proto p-'+esc(f.proto)+'">'+esc(f.proto)+'</span></td>'
      + '<td class="mono">'+esc(f.server)+'</td>'
      + '<td class="mono">'+(f.port||'-')+'</td>'
      + '<td>'+esc(flagOf(f.area))+'</td>'
      + '<td><div class="sp"><span>'+esc(f.speed)+'</span>'
        + '<i><b style="width:'+(sv<0?0:Math.min(100, sv/2000*100))+'%"></b></i></div></td>'
      + '<td class="mono">'+esc(f.security)+'</td>'
      + '<td><div class="acts">'
        + '<button type="button" class="btn sm" data-nd="copy">复制</button>'
        + '<button type="button" class="btn sm" data-nd="parse">解析</button>'
        + '<button type="button" class="btn sm" data-nd="up"'+(upOff?' disabled':'')+'>▲</button>'
        + '<button type="button" class="btn sm" data-nd="down"'+(downOff?' disabled':'')+'>▼</button>'
        + '<span class="grip" title="拖动排序">☰</span>'
        + '<button type="button" class="btn sm" data-nd="toggle">'+(item.disabled?'启用':'停用')+'</button>'
      + '</div></td></tr>';
  }).join('') || '<tr><td colspan="8" class="empty">还没有节点。用下面的「追加节点」粘几条进来。</td></tr>';
  $('#nd-count').textContent = lines.length;
  countSel();
}

function countSel(){
  $('#nd-sel').textContent = root.querySelectorAll('#nd-body input[type=checkbox]:checked').length;
}
function rowOf(el){ const tr = el.closest('tr'); return tr ? Number(tr.dataset.i) : -1; }
function move(i, d){
  const j = i + d;
  if(j<0 || j>=lines.length) return;
  if(lines[i].disabled !== lines[j].disabled) return;  // 只在同组内挪
  [lines[i], lines[j]] = [lines[j], lines[i]];
  markDirty(true); render();
}

// ---------- 事件委托 ----------
root.addEventListener('click', e => {
  const b = e.target.closest('[data-nd]');
  if(!b) return;
  const act = b.dataset.nd;
  if(act === 'cb'){ countSel(); return; }
  if(act === 'all' || act === 'none'){
    root.querySelectorAll('#nd-body input[type=checkbox]').forEach(cb => cb.checked = act==='all');
    countSel(); return;
  }
  if(act === 'delsel'){
    const idxs = new Set(Array.from(root.querySelectorAll('#nd-body input[type=checkbox]:checked'))
      .map(cb => rowOf(cb)));
    if(!idxs.size) return;
    if(!confirm('删除选中的 '+idxs.size+' 个节点?点「保存节点」才会真正生效。')) return;
    lines = lines.filter((_,i) => !idxs.has(i));
    markDirty(true); render(); return;
  }
  const i = rowOf(b);
  if(act === 'copy'){ copy(b.closest('tr').dataset.uri, b); return; }
  if(act === 'parse'){
    // 老后台是整页跳到工具箱。桌面版不能跳 —— 那等于把整个桌面关了,
    // 而且这个窗口里没保存的改动会一起没。开新标签页两边都保住。
    window.open(ADMIN + '/tools?parse=' + encodeURIComponent(b.closest('tr').dataset.uri), '_blank');
    return;
  }
  if(act === 'up'){ move(i,-1); return; }
  if(act === 'down'){ move(i,1); return; }
  if(act === 'toggle'){ lines[i].disabled = !lines[i].disabled; markDirty(true); render(); return; }
  if(act === 'append'){ append(); return; }
  if(act === 'save'){ save(); return; }
  if(act === 'restore'){
    if(!confirm('恢复到上一版节点?当前内容会被替换。')) return;
    const fd = new FormData(); fd.set('action','restorenodes');
    window.os.act(fd).then(out => { if(out.ok){ markDirty(false); window.os.refresh('nodes', true); } });
    return;
  }
});
root.addEventListener('change', e => { if(e.target.matches('#nd-body input[type=checkbox]')) countSel(); });

// 表头排序
root.addEventListener('click', e => {
  const th = e.target.closest('.srt');
  if(!th) return;
  const col = th.dataset.col;
  if(sortCol === col) sortDir = -sortDir; else { sortCol = col; sortDir = 1; }
  lines.sort((a,b) => {
    const fa = fields(a), fb = fields(b);
    let va = fa[col], vb = fb[col];
    if(col === 'speed'){ va = speedVal(fa.speed); vb = speedVal(fb.speed); }
    if(typeof va === 'number' && typeof vb === 'number') return (va-vb)*sortDir;
    return String(va).localeCompare(String(vb))*sortDir;
  });
  markDirty(true); render();
});

// 拖拽排序。只有按住 ☰ 才让那一行可拖 —— 整行都可拖的话选文字会变成拖行。
root.addEventListener('mousedown', e => {
  const g = e.target.closest('.grip');
  if(g) g.closest('tr').draggable = true;
});
root.addEventListener('mouseup', () => {
  root.querySelectorAll('#nd-body tr[draggable]').forEach(tr => tr.draggable = false);
});
root.addEventListener('dragstart', e => {
  const tr = e.target.closest('tr'); if(!tr) return;
  dragSrc = Number(tr.dataset.i);
  e.dataTransfer.effectAllowed = 'move';
});
root.addEventListener('dragover', e => {
  const tr = e.target.closest('#nd-body tr'); if(!tr) return;
  e.preventDefault(); tr.classList.add('over');
});
root.addEventListener('dragleave', e => {
  const tr = e.target.closest('#nd-body tr'); if(tr) tr.classList.remove('over');
});
root.addEventListener('drop', e => {
  const tr = e.target.closest('#nd-body tr'); if(!tr) return;
  e.preventDefault(); tr.classList.remove('over');
  const dst = Number(tr.dataset.i);
  if(dragSrc === null || dragSrc === dst){ dragSrc = null; return; }
  if(lines[dragSrc].disabled !== lines[dst].disabled){ dragSrc = null; return; }  // 只在同组内拖
  const [item] = lines.splice(dragSrc,1);
  lines.splice(dst,0,item);
  dragSrc = null; markDirty(true); render();
});
root.addEventListener('dragend', () => {
  root.querySelectorAll('#nd-body tr').forEach(tr => { tr.draggable=false; tr.classList.remove('over'); });
  dragSrc = null;
});

async function copy(text, btn){
  try{ await navigator.clipboard.writeText(text); }
  catch(e){
    const t = document.createElement('textarea'); t.value = text;
    document.body.appendChild(t); t.select();
    try{ document.execCommand('copy'); }catch(_){}
    document.body.removeChild(t);
  }
  const old = btn.textContent;
  btn.textContent = '已复制'; btn.disabled = true;
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1200);
}

function stamp(d){
  const p = n => String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
}

function append(){
  const box = $('#nd-add');
  const raw = box.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const have = new Set(lines.map(n=>n.uri));
  const add = [];
  let dup = 0, bad = 0;
  for(const l of raw){
    // 必须是认识的协议,且不能是伪装成"自我节点"的行 —— 那个位置只能由这里自动生成
    if(!/^(vmess|vless|trojan|anytls|ss|ssr):\/\//i.test(l) || l.startsWith(MARKER_PREFIX)){ bad++; continue; }
    if(have.has(l)){ dup++; continue; }
    add.push(l); have.add(l);
  }
  box.value = '';
  const msg = $('#nd-msg');
  if(!add.length){
    msg.textContent = '没有可添加的节点'+(dup?(','+dup+' 条重复'):'')+(bad?(','+bad+' 条格式无效已跳过'):'');
    return;
  }
  // 插到最前面,这样所有链接下一次拉取时这批新节点排最靠前
  lines = [...add.map(uri=>({uri, disabled:false})), ...lines];

  // 自我节点挪出来、刷新时间戳、重新放末尾
  const mi = lines.findIndex(n => n.uri.startsWith(MARKER_PREFIX));
  if(mi >= 0) lines.splice(mi,1);
  lines.push({
    uri: MARKER_PREFIX + '?encryption=none&security=none&type=tcp#'
       + encodeURIComponent('更新于 ' + stamp(new Date()) + ' updated from web'),
    disabled: false,
  });

  // 超出上限就从末尾砍(只数启用的真节点,自我节点和停用的不算)
  const realIdxs = () => lines
    .map((n,i)=>({n,i}))
    .filter(({n}) => !n.disabled && !n.uri.startsWith(MARKER_PREFIX))
    .map(({i})=>i);
  let dropped = 0, idxs = realIdxs();
  while(idxs.length > CAP){ lines.splice(idxs[idxs.length-1],1); dropped++; idxs = realIdxs(); }

  msg.textContent = add.length+' 条已添加到最前面,自我节点已更新'
    +(dropped?(','+dropped+' 条从末尾移除(超出上限 '+CAP+')'):'')
    +(dup?(','+dup+' 条重复已跳过'):'')
    +(bad?(','+bad+' 条格式无效已跳过'):'');
  markDirty(true); render();
}

async function save(){
  settle();
  if(!lines.length || lines.every(n=>n.disabled)){
    if(!confirm('保存后所有设备将拿不到任何可用节点(列表是空的,或全部被停用了)。确定?')) return;
  }
  const joined = lines.map(n => n.disabled ? (OFF_PREFIX+n.uri) : n.uri).join('\n');
  const fd = new FormData();
  fd.set('action', 'savenodes');
  // 存回去必须编码回 base64,跟 Mac mini 推上来的格式一致
  fd.set('nodes', joined ? toB64(enc.encode(joined + '\n')) : '');
  const out = await window.os.act(fd);
  if(!out.ok) return;                 // 失败就保持现状,别把用户改了半天的东西冲掉
  markDirty(false);
  await window.os.others('nodes');    // 别的窗口(状态、系统)跟着更新,自己不用重拉
}

render();
`;

// 这个 app 特有的样式(共用的那部分在 css.ts)。
const CSS = `<style>
.body #nd-table td{padding:7px 10px 7px 0}
.body .srt{cursor:pointer;user-select:none}
.body .srt:hover{color:#1d1d1f}
.body .srt i{font-style:normal;font-size:9px}
.body .nd-r.off{opacity:.45}
.body .nd-r.over{box-shadow:inset 0 2px 0 #0071e3}
.body .proto{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:5px;
  background:#f2f2f4;color:#6b6b70;letter-spacing:.02em}
.body .proto.p-vless{background:#fdeceb;color:#c02a12}
.body .proto.p-anytls{background:#f4ecfa;color:#7a3fa8}
.body .proto.p-trojan{background:#e9f7ee;color:#26804a}
.body .proto.p-vmess{background:#eaf0fc;color:#2d5bc0}
.body .proto.p-ss{background:#fdf3e3;color:#a06d10}
.body .sp{display:flex;flex-direction:column;gap:3px;min-width:78px}
.body .sp span{font-size:11.5px;white-space:nowrap}
.body .sp i{display:block;height:3px;background:#eaeaec;border-radius:2px;overflow:hidden}
.body .sp i b{display:block;height:100%;background:#34c759;border-radius:2px}
.body .acts{display:flex;gap:3px;align-items:center;white-space:nowrap}
.body .grip{cursor:grab;color:#c7c7cc;font-size:13px;padding:0 3px;user-select:none}
.body .grip:active{cursor:grabbing}
.body .pill.warn{background:#fff4d6;color:#8a5d00}
.body #nd-add{margin-bottom:2px}
</style>`;

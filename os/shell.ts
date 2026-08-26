// os/shell.ts — 桌面外壳:壁纸、菜单栏、桌面图标、Dock、窗口管理器、右键菜单。
//
// 它只管"外壳",不知道任何一个 app 里面是什么 —— 各 app 的内容由服务端按需返回
// HTML 片段(GET {ADMIN_PATH}/os/app/{id}),外壳拿到就塞进窗口。这样加一个 app
// 不用动这个文件。
//
// 表单提交走 fetch,不整页跳转 —— 桌面隐喻下整页刷新会把所有窗口关掉、位置全丢,
// 那就不像操作系统,像每点一下就重启一次。提交完只重新拉受影响的那个 app 的片段。

import { ADMIN_PATH, CLASSIC_PATH } from "../config.ts";
import { jsonForScript } from "../ui.ts";
import { APP_ICONS, SQUIRCLE_DEF } from "./icons.ts";
import { APPS } from "./apps.ts";

const STYLE = `<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
/* 在 Mac 上 -apple-system 直接拿到真正的 SF Pro,这是"像不像"最关键的一步,
   任何网络字体都替代不了。非苹果系统再退回 Segoe / Roboto。 */
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI",Roboto,
  "Helvetica Neue","PingFang SC","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;user-select:none;background:#1c2b4a}
.wall{position:fixed;inset:0;z-index:0;transition:background-image .4s ease}
.wall::after{content:'';position:absolute;inset:0;opacity:.22;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/></filter><rect width='140' height='140' filter='url(%23n)' opacity='.5'/></svg>")}

.menubar{position:fixed;top:0;left:0;right:0;height:25px;z-index:9000;display:flex;align-items:center;
  gap:18px;padding:0 12px;font-size:13px;color:#fff;
  background:rgba(0,0,0,.18);backdrop-filter:blur(30px) saturate(180%);-webkit-backdrop-filter:blur(30px) saturate(180%)}
.menubar .apl{font-size:15px;margin-right:-4px;opacity:.95;cursor:default;
  padding:0 7px;border-radius:4px;margin-left:-7px}
.menubar .apl:hover{background:rgba(255,255,255,.22)}
.menubar .app{font-weight:600}
.menubar .sp{margin-left:auto;display:flex;gap:16px;align-items:center;font-size:12.5px;font-variant-numeric:tabular-nums}
.menubar svg{display:block}

.desktop{position:fixed;inset:25px 0 104px 0;padding:14px 10px;display:flex;flex-direction:column;
  flex-wrap:wrap;align-content:flex-start;gap:2px;z-index:1}
.dicon{width:96px;padding:7px 5px 6px;text-align:center;border-radius:8px;border:.5px solid transparent;cursor:default}
.dicon:hover{background:rgba(255,255,255,.10)}
.dicon.sel{background:rgba(255,255,255,.20);border-color:rgba(255,255,255,.30)}
.dicon svg{width:56px;height:56px;margin:0 auto 4px;display:block;filter:drop-shadow(0 3px 5px rgba(0,0,0,.30))}
.dicon .nm{font-size:12px;color:#fff;line-height:1.28;word-break:break-word;text-shadow:0 1px 3px rgba(0,0,0,.6)}
.dicon.sel .nm{background:rgba(48,110,220,.9);border-radius:4px;padding:0 3px;text-shadow:none}

/* macOS 的窗口阴影是"一层很紧的接触阴影 + 一层很散的大阴影",单层做不出悬浮感 */
.win{position:fixed;background:#fff;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;
  min-width:420px;min-height:230px;
  box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.10),0 22px 60px rgba(0,0,0,.34)}
.win:not(.focus){box-shadow:0 0 0 .5px rgba(0,0,0,.13),0 8px 26px rgba(0,0,0,.20)}
.win.min{display:none}
.tbar{height:38px;flex:0 0 auto;display:flex;align-items:center;padding:0 13px;gap:8px;cursor:default;
  background:rgba(246,246,247,.92);border-bottom:.5px solid rgba(0,0,0,.10)}
.lights{display:flex;gap:8px;flex:0 0 auto}
.lt{width:12px;height:12px;border-radius:50%;border:none;padding:0;cursor:pointer;position:relative;
  box-shadow:inset 0 0 0 .5px rgba(0,0,0,.10)}
.lt.r{background:#ff5f57}.lt.y{background:#febc2e}.lt.g{background:#28c840}
.win:not(.focus) .lt{background:#dcdcdf;box-shadow:none}
.lights:hover .lt::after{content:'';position:absolute;inset:0;border-radius:50%;
  background:rgba(0,0,0,.42);-webkit-mask:var(--m) center/9px 9px no-repeat;mask:var(--m) center/9px 9px no-repeat}
.lt.r::after{--m:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><path d='M2.6 2.6l4.8 4.8M7.4 2.6L2.6 7.4' stroke='black' stroke-width='1.4' stroke-linecap='round'/></svg>")}
.lt.y::after{--m:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><path d='M2.2 5h5.6' stroke='black' stroke-width='1.4' stroke-linecap='round'/></svg>")}
.lt.g::after{--m:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><path d='M3.2 6.8V3.2h3.6M6.8 3.2L3.2 6.8' stroke='black' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round' fill='none'/></svg>")}
.ttl{flex:1;text-align:center;font-size:13.5px;font-weight:600;color:#25252a;margin-right:56px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.win:not(.focus) .ttl{color:#a5a5aa}
.body{flex:1;overflow:auto;padding:17px 19px;background:#fff;user-select:text}
/* 深色外观的窗口(见 apps.ts 的 AppSpec.dark)。红黄绿灯保持原色不变 ——
   macOS 的深色窗口也是这样,交通灯是系统统一的,不跟着应用主题走。 */
.win.dark{background:#12151c}
.win.dark .tbar{background:rgba(26,30,38,.94);border-bottom:.5px solid rgba(255,255,255,.08)}
.win.dark .ttl{color:#e7e9ee}
.win.dark:not(.focus) .ttl{color:#5b6070}
.win.dark:not(.focus) .lt{background:#3a3f4b}
.win.dark .body{background:#0d0f14;color:#e7e9ee}
.win.dark .spin{color:#6b7280}
.rsz{position:absolute;right:0;bottom:0;width:15px;height:15px;cursor:nwse-resize}
.spin{padding:40px;text-align:center;color:#86868b;font-size:13px}

.dock{position:fixed;bottom:7px;left:50%;transform:translateX(-50%);z-index:8000;display:flex;
  gap:5px;padding:6px;border-radius:22px;align-items:flex-end;
  background:rgba(255,255,255,.20);backdrop-filter:blur(34px) saturate(200%);-webkit-backdrop-filter:blur(34px) saturate(200%);
  box-shadow:0 0 0 .5px rgba(255,255,255,.34),0 1px 0 rgba(255,255,255,.30) inset,0 10px 34px rgba(0,0,0,.30)}
.dk{width:54px;height:54px;border:none;padding:0;background:none;cursor:pointer;position:relative;
  transition:transform .18s cubic-bezier(.28,1.5,.5,1);transform-origin:bottom center}
.dk svg{width:54px;height:54px;display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,.24))}
.dk:hover{transform:translateY(-11px) scale(1.22)}
.dk .on{position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;
  background:rgba(0,0,0,.5);opacity:0;box-shadow:0 0 0 .5px rgba(255,255,255,.4)}
.dk.run .on{opacity:1}
.tip{position:absolute;bottom:66px;left:50%;transform:translateX(-50%);white-space:nowrap;opacity:0;
  pointer-events:none;transition:opacity .13s;font-size:12.5px;color:#1d1d1f;padding:4px 10px;border-radius:7px;
  background:rgba(250,250,250,.92);box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 4px 14px rgba(0,0,0,.18)}
.dk:hover .tip{opacity:1}

/* 右键菜单:毛玻璃 + 小圆角 + 整行蓝底高亮,贴边自动翻转 */
.ctx{position:fixed;z-index:9500;min-width:180px;padding:4px;border-radius:6px;
  background:rgba(246,246,246,.76);backdrop-filter:blur(30px) saturate(180%);-webkit-backdrop-filter:blur(30px) saturate(180%);
  box-shadow:0 0 0 .5px rgba(0,0,0,.14),0 8px 28px rgba(0,0,0,.26);font-size:13px;color:#1d1d1f;display:none}
.ctx.on{display:block}
.ctx button,.ctx a{display:flex;width:100%;align-items:center;gap:8px;background:none;border:none;font:inherit;
  text-align:left;padding:4px 9px;border-radius:4px;cursor:default;color:inherit;white-space:nowrap;
  text-decoration:none;box-sizing:border-box}
.ctx button:hover:not(:disabled),.ctx a:hover{background:#0a64d4;color:#fff}
.ctx button:disabled{color:#b4b4b8}
.ctx button .k{margin-left:auto;opacity:.55;font-size:12px;padding-left:20px}
.ctx hr{border:0;border-top:.5px solid rgba(0,0,0,.16);margin:4px 8px}
.ctx .hd{padding:3px 9px 5px;font-size:11px;color:#8a8a8e}

/* 通知:操作结果从右上角滑进来,几秒后自己消失 */
.toasts{position:fixed;top:34px;right:12px;z-index:9600;display:flex;flex-direction:column;gap:8px}
.toast{min-width:230px;max-width:340px;padding:11px 14px;border-radius:12px;font-size:13px;color:#1d1d1f;
  background:rgba(250,250,250,.92);backdrop-filter:blur(28px) saturate(180%);-webkit-backdrop-filter:blur(28px) saturate(180%);
  box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 8px 26px rgba(0,0,0,.22);
  animation:slidein .26s cubic-bezier(.2,.9,.3,1)}
.toast.bad{color:#b3261e}
.toast b{display:block;font-size:12px;font-weight:600;color:#86868b;margin-bottom:2px}
@keyframes slidein{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}

/* 桌面隐喻在手机上不成立(拖不动窗口、Dock 放不下)。与其给个残废的桌面,不如直说,
   并把老后台的入口给出来 —— 那个是响应式的,手机上能正常用。 */
@media (max-width:760px){
  .desktop,.dock,.win,.menubar,.toasts{display:none!important}
  .smallnote{display:flex!important}
}
.smallnote{display:none;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;
  flex-direction:column;gap:12px;padding:40px;text-align:center;color:#fff}
.smallnote b{font-size:17px;font-weight:600}
.smallnote span{font-size:13.5px;opacity:.85;line-height:1.7}
.smallnote a{color:#fff;font-size:13.5px}
</style>`;

/** 三套壁纸。右键桌面可以循环切换,选择记在 localStorage 里。 */
const WALLS = [
  "radial-gradient(1200px 780px at 18% 8%,#2f6fb0 0,transparent 58%),radial-gradient(1000px 700px at 82% 22%,#48b6c4 0,transparent 55%),radial-gradient(1100px 800px at 62% 88%,#e08b4f 0,transparent 60%),radial-gradient(900px 640px at 12% 92%,#7a4b86 0,transparent 58%),linear-gradient(165deg,#1b3a63 0,#2d6a86 45%,#b2653f 100%)",
  "radial-gradient(1100px 760px at 78% 12%,#7b3fa0 0,transparent 58%),radial-gradient(1000px 700px at 14% 30%,#2b5fa8 0,transparent 56%),radial-gradient(1200px 820px at 50% 92%,#c2417a 0,transparent 60%),linear-gradient(160deg,#241a48 0,#3d2a6b 48%,#8e2f63 100%)",
  "radial-gradient(1000px 700px at 22% 16%,#0f7a6a 0,transparent 56%),radial-gradient(1100px 760px at 84% 30%,#1d9e8f 0,transparent 55%),radial-gradient(1200px 820px at 56% 94%,#d8b04a 0,transparent 58%),linear-gradient(160deg,#08343a 0,#126b63 50%,#a8853a 100%)",
];

export function shellPage(): string {
  const meta = APPS.map((a) => ({ id: a.id, name: a.name, w: a.w, h: a.h, dark: !!a.dark }));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>nodepipe</title>${STYLE}</head><body>
${SQUIRCLE_DEF}
<div class="wall" id="wall"></div>
<div class="smallnote"><b>请在电脑上打开</b>
  <span>这是桌面式的界面 —— 窗口、Dock、右键菜单在手机上都用不了。<br>手机请用旧版后台:</span>
  <a href="${CLASSIC_PATH}">打开旧版后台 →</a></div>
<div class="menubar">
  <span class="apl" id="mbApple">&#63743;</span><span class="app" id="mbApp">访达</span>
  <span>文件</span><span>编辑</span><span>显示</span><span>前往</span><span>窗口</span><span>帮助</span>
  <span class="sp">
    <svg width="15" height="13" viewBox="0 0 15 13" fill="#fff"><path d="M7.5 11.4 1 5.2a4.4 4.4 0 0 1 6.5-5.9A4.4 4.4 0 0 1 14 5.2z" opacity=".92"/></svg>
    <svg width="17" height="12" viewBox="0 0 17 12" fill="none"><rect x=".6" y="2.4" width="12.6" height="7.2" rx="2.2" stroke="#fff" stroke-opacity=".65"/><rect x="2" y="3.8" width="8.6" height="4.4" rx="1.2" fill="#fff"/><path d="M15 5v2" stroke="#fff" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round"/></svg>
    <span id="clock">--</span>
  </span>
</div>
<div class="desktop" id="desk"></div>
<div class="dock" id="dock"></div>
<div class="ctx" id="ctx"></div>
<div class="toasts" id="toasts"></div>
<script>
const BASE = ${jsonForScript(ADMIN_PATH)};
const CLASSIC = ${jsonForScript(CLASSIC_PATH)};
const APPS = ${jsonForScript(meta)};
const ICONS = ${jsonForScript(APP_ICONS)};
const WALLS = ${jsonForScript(WALLS)};
${CLIENT_JS}
</script></body></html>`;
}

// 客户端脚本单独拎出来,免得跟上面的模板字符串互相转义打架。
const CLIENT_JS = String.raw`
let z = 100, wins = {}, ctxTarget = null;
const $ = (s) => document.querySelector(s);

// ---------- 通知 ----------
function toast(msg, ok){
  const t = document.createElement('div');
  t.className = 'toast' + (ok ? '' : ' bad');
  t.innerHTML = '<b>' + (ok ? '完成' : '出错了') + '</b>' + esc(msg);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition='opacity .3s'; t.style.opacity='0';
    setTimeout(()=>t.remove(), 320); }, 3400);
}
function esc(s){ return String(s??'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------- 拉取 app 内容 ----------
async function loadApp(id){
  const r = await fetch(BASE + '/os/app/' + id, { headers: { 'x-os': '1' } });
  if (!r.ok) return '<div class="spin">加载失败(' + r.status + ')</div>';
  return await r.text();
}
/**
 * 把片段塞进窗口。**不能直接 innerHTML** —— 通过 innerHTML 插入的 <script>
 * 浏览器一律不执行(DOM 规范如此),于是任何自带 JS 的 app 都是死的:
 * 访问记录那两个联动下拉框就是这么变成空 <select> 的。
 * 所以塞完之后要把每个 <script> 重新造一个真节点替换进去,这样才会跑。
 */
function setBody(w, htmlText){
  const body = w.querySelector('.body');
  body.innerHTML = htmlText;
  body.querySelectorAll('script').forEach(old => {
    const s = document.createElement('script');
    // 属性照抄(比如 type),内容照搬
    for (const a of old.attributes) s.setAttribute(a.name, a.value);
    s.textContent = old.textContent;
    old.replaceWith(s);
  });
}
/**
 * 重拉某个窗口的内容。**有未保存改动的窗口默认跳过** —— 不然在别的窗口点一下
 * "停用设备",节点内容里辛苦排了半天的顺序就被静悄悄冲掉了,而且没有任何提示。
 * 真要强制重拉(比如那个 app 自己刚保存完)传 force。
 */
async function refresh(id, force){
  const w = wins[id];
  if (!w) return;
  if (!force && w.dataset.dirty === '1') return;
  delete w.dataset.dirty;
  setBody(w, await loadApp(id));
}
/** 发一个变更操作并弹通知。返回服务端那个 {ok,msg} —— app 想自己接着做事就用它。 */
async function postAction(fd){
  const r = await fetch(BASE + '/os/act', { method: 'POST', body: fd, headers: { 'x-os': '1' } });
  let out; try { out = await r.json(); } catch { out = { ok:false, msg:'服务端没有返回 JSON(HTTP ' + r.status + ')' }; }
  toast(out.msg || (out.ok ? '已完成' : '失败'), out.ok);
  return out;
}
/** 变更操作:提交后只重拉受影响的窗口,不整页刷新 —— 窗口位置和其它窗口都保住。 */
async function submit(form){
  const out = await postAction(new FormData(form));
  // 一个操作可能影响多个窗口(比如删设备会同时改变访问记录),所以全部重拉。
  for (const id of Object.keys(wins)) await refresh(id);
  return out.ok;
}

/**
 * 给 app 片段用的一点点 API。片段里的脚本跟外壳同处一个 window,所以 app **不要**
 * 往全局挂函数(六个 app 各挂一个 sortBy 就等着串味),要用的东西从这里拿。
 *   os.act(fd)        发变更操作,拿到 {ok,msg}
 *   os.toast(msg,ok)  弹通知
 *   os.refresh(id,f)  重拉某个窗口
 *   os.others(id)     重拉**除了自己以外**的窗口(自己刚改完,不想被服务端旧值盖回去)
 *   os.dirty(el,on)   标记/清除"这个窗口有未保存改动"
 */
window.os = {
  act: postAction, toast, refresh,
  others: async (self) => { for (const id of Object.keys(wins)) if (id !== self) await refresh(id, true); },
  dirty: (el, on) => {
    const w = el.closest('.win');
    if (!w) return;
    if (on) w.dataset.dirty = '1'; else delete w.dataset.dirty;
  },
};
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-os]');
  if (!f) return;
  e.preventDefault();
  if (f.dataset.confirm && !confirm(f.dataset.confirm)) return;
  submit(f);
});

// ---------- 窗口 ----------
async function make(app){
  const w = document.createElement('div');
  w.className = 'win' + (app.dark ? ' dark' : ''); w.dataset.app = app.id;
  const n = Object.keys(wins).length;
  Object.assign(w.style, { left:(90+n*28)+'px', top:(62+n*26)+'px',
    width:app.w+'px', height:app.h+'px', zIndex:++z });
  w.innerHTML = '<div class="tbar"><div class="lights">' +
    '<button class="lt r" data-a="close"></button><button class="lt y" data-a="min"></button><button class="lt g" data-a="zoom"></button>' +
    '</div><div class="ttl">' + esc(app.name) + '</div></div>' +
    '<div class="body"><div class="spin">载入中…</div></div><div class="rsz"></div>';
  document.body.appendChild(w);
  wins[app.id] = w;
  const focus = () => {
    document.querySelectorAll('.win').forEach(x => x.classList.remove('focus'));
    w.classList.add('focus'); w.style.zIndex = ++z; $('#mbApp').textContent = app.name;
  };
  w.addEventListener('mousedown', focus); focus();

  w.querySelector('.tbar').addEventListener('mousedown', e => {
    if (e.target.classList.contains('lt')) return;
    const sx = e.clientX - w.offsetLeft, sy = e.clientY - w.offsetTop;
    const mv = ev => { w.style.left=(ev.clientX-sx)+'px'; w.style.top=Math.max(26,ev.clientY-sy)+'px'; };
    const up = () => { removeEventListener('mousemove',mv); removeEventListener('mouseup',up); };
    addEventListener('mousemove',mv); addEventListener('mouseup',up);
  });
  w.querySelector('.rsz').addEventListener('mousedown', e => {
    e.stopPropagation();
    const sw=w.offsetWidth, sh=w.offsetHeight, sx=e.clientX, sy=e.clientY;
    const mv = ev => { w.style.width=Math.max(420,sw+ev.clientX-sx)+'px';
                       w.style.height=Math.max(230,sh+ev.clientY-sy)+'px'; };
    const up = () => { removeEventListener('mousemove',mv); removeEventListener('mouseup',up); };
    addEventListener('mousemove',mv); addEventListener('mouseup',up);
  });
  w.querySelectorAll('.lt').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); doWin(app.id, b.dataset.a);
  }));
  sync();
  setBody(w, await loadApp(app.id));
}
function doWin(id, a){
  const w = wins[id]; if (!w) return;
  if (a === 'close'){
    // 有未保存改动的窗口,关之前问一句。红点是最容易误点的一个控件。
    if (w.dataset.dirty === '1' && !confirm('这个窗口还有未保存的改动,关掉就没了。确定?')) return;
    w.remove(); delete wins[id];
  }
  else if (a === 'min'){ w.classList.add('min'); }
  else {
    if (w.dataset.full === '1'){ Object.assign(w.style, JSON.parse(w.dataset.prev)); w.dataset.full='0'; }
    else { w.dataset.prev = JSON.stringify({left:w.style.left,top:w.style.top,width:w.style.width,height:w.style.height});
      Object.assign(w.style,{left:'8px',top:'32px',width:(innerWidth-16)+'px',height:(innerHeight-32-100)+'px'});
      w.dataset.full='1'; }
  }
  sync();
}
function open(app){
  const w = wins[app.id];
  if (w){ w.classList.remove('min'); w.dispatchEvent(new MouseEvent('mousedown')); sync(); return; }
  make(app);
}
function sync(){ document.querySelectorAll('.dk').forEach(d => d.classList.toggle('run', !!wins[d.dataset.id])); }

// ---------- 右键 ----------
function menu(items, x, y){
  const ctx = $('#ctx');
  // 带 href 的项渲染成真的 <a target="_blank">,不是按钮 + window.open。
  // window.open 会被弹窗拦截器拦掉(实测就拦了),而且真链接还白得中键/⌘点击和
  // 状态栏里能看见地址 —— 一个"打开另一个页面"的菜单项本来就该是链接。
  ctx.innerHTML = items.map(it => it === '-' ? '<hr>' : it.head ? '<div class="hd">'+esc(it.head)+'</div>'
    : it.href ? '<a href="'+esc(it.href)+'" target="_blank" rel="noopener">'+esc(it.label)+'</a>'
    : '<button '+(it.off?'disabled':'')+' data-i="'+(it.id||'')+'">'+esc(it.label)+
      (it.key?'<span class="k">'+it.key+'</span>':'')+'</button>').join('');
  ctx.classList.add('on');
  const w = ctx.offsetWidth, h = ctx.offsetHeight;
  ctx.style.left = (x + w > innerWidth  - 6 ? Math.max(6, x - w) : x) + 'px';
  ctx.style.top  = (y + h > innerHeight - 6 ? Math.max(30, y - h) : y) + 'px';
  ctx.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    hideCtx(); if (b.dataset.i) ctxAct(b.dataset.i);
  }));
}
function hideCtx(){ $('#ctx').classList.remove('on'); }
addEventListener('click', hideCtx);
addEventListener('keydown', e => { if (e.key === 'Escape') hideCtx(); });

document.addEventListener('contextmenu', e => {
  // 接管右键之后浏览器自带菜单就没了。留个后门:Shift+右键放行,调试时用得上。
  if (e.shiftKey) return;
  e.preventDefault();
  const icon = e.target.closest('.dicon'), dk = e.target.closest('.dk');
  const tbar = e.target.closest('.tbar'), win = e.target.closest('.win');
  const row = e.target.closest('tr[data-user]');

  if (dk){ ctxTarget = dk.dataset.id; const on = !!wins[ctxTarget];
    return menu([{head: APPS.find(a=>a.id===ctxTarget).name},
      {id:'open', label: on?'显示窗口':'打开'}, '-', {id:'close', label:'退出', off:!on}], e.clientX, e.clientY-8); }
  if (icon){ ctxTarget = icon.dataset.id;
    return menu([{id:'open',label:'打开',key:'↩'}, '-',
      {id:'reload',label:'刷新内容',off:!wins[ctxTarget]},
      {id:'close',label:'关闭窗口',off:!wins[ctxTarget]}], e.clientX, e.clientY); }
  if (row){ ctxTarget = row;
    return menu([{head: row.dataset.user},
      {id:'copy',label:'复制链接',key:'⌘C'},
      {id:'toggle',label: row.dataset.enabled==='1'?'停用':'启用'},
      {id:'rotate',label:'更换链接…'}, '-',
      {id:'del',label:'删除设备…'}], e.clientX, e.clientY); }
  if (tbar || win){ ctxTarget = win.dataset.app;
    return menu([{id:'min',label:'最小化',key:'⌘M'},{id:'zoom',label:'缩放'}, '-',
      {id:'reload',label:'刷新内容'},
      {id:'close',label:'关闭',key:'⌘W'},{id:'others',label:'关闭其他窗口'}], e.clientX, e.clientY); }

  ctxTarget = null;
  menu([{id:'tidy',label:'整理图标'},{id:'wall',label:'更改壁纸…'}, '-',
    {id:'newdev',label:'新建设备…',key:'⌘N'},{id:'refreshall',label:'刷新全部',key:'⌘R'}, '-',
    {id:'closeall',label:'关闭全部窗口',off:!Object.keys(wins).length}], e.clientX, e.clientY);
});

let wallIdx = Number(localStorage.getItem('wall') || 0) % WALLS.length;
function paintWall(){ $('#wall').style.backgroundImage = WALLS[wallIdx]; }

async function post(action, extra){
  const fd = new FormData();
  fd.append('action', action);
  for (const k in (extra||{})) fd.append(k, extra[k]);
  const r = await fetch(BASE + '/os/act', { method:'POST', body:fd, headers:{'x-os':'1'} });
  let out; try { out = await r.json(); } catch { out = {ok:false,msg:'HTTP '+r.status}; }
  toast(out.msg, out.ok);
  for (const id of Object.keys(wins)) await refresh(id);
}

/** 右键菜单里选中某一项之后干什么。注意别跟上面发请求的 postAction 重名 ——
 * 两个同名的函数声明后面那个会静悄悄盖掉前面那个,而且一点报错都没有。 */
function ctxAct(id){
  const app = APPS.find(a => a.id === ctxTarget);
  const row = ctxTarget instanceof HTMLElement ? ctxTarget : null;
  switch(id){
    case 'open': if (app) open(app); break;
    case 'close': case 'min': case 'zoom': if (app) doWin(app.id, id); break;
    case 'reload': if (app) refresh(app.id); break;
    case 'others': Object.keys(wins).forEach(k => { if (k!==ctxTarget) doWin(k,'close'); }); break;
    case 'closeall': Object.keys(wins).forEach(k => doWin(k,'close')); break;
    case 'refreshall': Object.keys(wins).forEach(k => refresh(k)); toast('已刷新', true); break;
    case 'tidy': document.querySelectorAll('.dicon').forEach(d => d.style.cssText=''); break;
    case 'wall': wallIdx = (wallIdx+1) % WALLS.length; localStorage.setItem('wall', wallIdx); paintWall(); break;
    case 'newdev': open(APPS[0]); break;
    case 'copy': if (row) navigator.clipboard.writeText(row.dataset.link).then(()=>toast('链接已复制', true)); break;
    case 'toggle': if (row) post('toggle', { username: row.dataset.user }); break;
    case 'rotate': if (row && confirm('更换 ' + row.dataset.user + ' 的链接?旧链接会立即失效。'))
      post('rotate', { username: row.dataset.user }); break;
    case 'del': if (row && confirm('删除设备 ' + row.dataset.user + '?此操作不可撤销。'))
      post('del', { username: row.dataset.user }); break;
  }
}

//  菜单。旧版后台的入口放在这儿 —— 真 macOS 的  菜单装的就是这类
// "跟当前这个应用无关、属于整台机器"的东西,旧版入口正好是这种性质。
$('#mbApple').addEventListener('click', e => {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  ctxTarget = null;
  menu([{head:'nodepipe 后台'},
    {href: CLASSIC,      label:'打开旧版后台…'},
    {href: BASE+'/tools', label:'打开工具箱…'}, '-',
    {id:'wall',    label:'更改壁纸…'},
    {id:'refreshall', label:'刷新全部', key:'⌘R'}], r.left - 6, 26);
});

// ---------- 开机 ----------
paintWall();
const desk = $('#desk');
APPS.forEach(a => {
  const d = document.createElement('div');
  d.className='dicon'; d.dataset.id=a.id;
  d.innerHTML = ICONS[a.id] + '<div class="nm">' + esc(a.name) + '</div>';
  d.addEventListener('click', e => { e.stopPropagation();
    document.querySelectorAll('.dicon').forEach(x=>x.classList.remove('sel')); d.classList.add('sel'); });
  d.addEventListener('dblclick', () => open(a));
  desk.appendChild(d);
});
addEventListener('click', () => document.querySelectorAll('.dicon').forEach(x=>x.classList.remove('sel')));

const dock = $('#dock');
APPS.forEach(a => {
  const b = document.createElement('button');
  b.className='dk'; b.dataset.id=a.id;
  b.innerHTML = ICONS[a.id] + '<span class="tip">' + esc(a.name) + '</span><span class="on"></span>';
  b.addEventListener('click', () => open(a));
  dock.appendChild(b);
});

addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const cur = document.querySelector('.win.focus');
  if (e.key === 'w' && cur){ e.preventDefault(); doWin(cur.dataset.app, 'close'); }
  if (e.key === 'm' && cur){ e.preventDefault(); doWin(cur.dataset.app, 'min'); }
  if (e.key === 'r'){ e.preventDefault(); Object.keys(wins).forEach(k => refresh(k)); }
});

function tick(){ const d = new Date();
  $('#clock').textContent = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()] + ' ' +
    (d.getHours()%12||12) + ':' + String(d.getMinutes()).padStart(2,'0') + ' ' + (d.getHours()<12?'上午':'下午'); }
tick(); setInterval(tick, 10000);

open(APPS[0]);
`;

// os/apps/access.ts — 「访问记录」app:谁在用哪条订阅链接。
//
// 深色窗口(AppSpec.dark),因为这是个"看监控"的页面 —— 发光的状态灯在深色底上
// 才有意义,浅色底上那点辉光根本看不出来。
//
// 边界先说清楚,免得这一页被当成它不是的东西:
//   订阅接口是普通 HTTP GET,客户端不带 cookie 也不带设备标识,整个请求里只有
//   User-Agent、IP、时间三样。所以这里认出来的是**客户端类型**,不是设备身份 ——
//   家里两台都装小火箭的 iPhone 在这儿长得一模一样。真要区分人/设备,靠的是每台
//   设备一条独立的订阅链接,不是靠这个列表。
//
// 两级联动的数据一次性全塞进片段里,切换下拉框不再请求服务端:整个数据量就是 KV 里
// 缓冲的那约 100 条访问日志,比多跑几趟网络便宜得多。

import { jsonForScript } from "../../ui.ts";
import { type DeviceHit, getRecentDevicesByTag, listDevices } from "../../kv.ts";
import { DEFAULT_FORMAT, FORMATS, LISTED_FORMATS } from "../../formats.ts";
import { appleHintOf, parseOs, parseUa } from "../../ua.ts";
import { metaOf } from "../../clients.ts";

/** 多久没来算"安静"、多久算"失联"。见下面 stateOf 的说明。 */
const COLD_HOURS = 24;
const GONE_HOURS = 168; // 7 天

/**
 * 新鲜度三档。红色只给最后一档 —— 健康就该是没有颜色的,
 * 半屏都红之后红色就不再是"看这里"了。
 *   ok    24 小时内   正常在用
 *   cold  1~7 天      安静了,可能只是没打开客户端
 *   gone  ≥7 天       整周没来拉订阅,多半是设备换了/客户端删了/链接失效了
 * 一周这条线有依据:多数客户端的订阅自动更新周期在 24 小时以内,连着七个周期一次
 * 都没来,已经不能用"最近没打开"解释了。
 */
export function stateOf(ageMs: number): "ok" | "cold" | "gone" {
  const h = Math.max(0, ageMs) / 3600_000;
  if (h >= GONE_HOURS) return "gone";
  if (h >= COLD_HOURS) return "cold";
  return "ok";
}

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

interface ClientRow {
  name: string;
  ver: string;
  known: boolean;
  meta: string;   // "≈ iOS 18 · mihomo 内核 · 203.0.113.90" 这种一行摘要
  count: number;
  ago: string;
  state: "ok" | "cold" | "gone";
}
interface LinkEntry { tag: string; label: string; url: string; clients: ClientRow[] }
interface DevEntry { user: string; links: LinkEntry[] }

function toRow(h: DeviceHit): ClientRow {
  const info = parseUa(h.ua);
  const cm = metaOf(info.client);
  const os = parseOs(h.ua, appleHintOf(info.client));
  // 认不出来的照样显示原始 UA —— 不丢信息,而且看到常出现的未识别 UA 就该去补规则了
  const bits = [os, cm.core ? `${cm.core} 内核` : "", h.ip, h.hwid ? `硬件 ${h.hwid.slice(0, 8)}…` : ""]
    .filter(Boolean);
  return {
    name: info.known ? info.client : "未识别的客户端",
    ver: info.version,
    known: info.known,
    meta: info.known ? bits.join(" · ") : `${h.ua} · ${h.ip}`,
    count: h.count,
    ago: ago(h.last),
    state: stateOf(Date.now() - h.last),
  };
}

/**
 * 一组访问记录 -> 展示用的行,**按最近访问倒序**。
 * 排序不能省:KV 那边不保证顺序,而 UI 里"最近一次"直接取的是第一行 ——
 * 靠调用方的隐含顺序迟早要出错。
 */
function rowsOf(hits: DeviceHit[] | undefined): ClientRow[] {
  return [...(hits ?? [])].sort((a, b) => b.last - a.last).map(toRow);
}

export async function accessApp(origin: string): Promise<string> {
  const devices = await listDevices();
  const data: DevEntry[] = [];

  for (const d of devices) {
    const byTag = await getRecentDevicesByTag(d.username);
    const base = `${origin}/l/${encodeURIComponent(d.username)}/${d.id}`;
    const defSpec = FORMATS[d.format ?? DEFAULT_FORMAT] ?? FORMATS[DEFAULT_FORMAT];
    const links: LinkEntry[] = [
      // 不带后缀的那条:日志里 tag 记的是空串
      { tag: "", label: `${defSpec.label}(默认)`, url: base, clients: rowsOf(byTag.get("")) },
      ...LISTED_FORMATS.map((spec) => ({
        tag: spec.tag,
        label: spec.label,
        url: `${base}/${spec.tag}`,
        clients: rowsOf(byTag.get(spec.tag)),
      })),
    ];
    data.push({ user: d.username, links });
  }

  if (data.length === 0) {
    return `${CSS}<div class="ab-empty">还没有设备。先去「设备管理」加一台。</div>`;
  }

  return `${CSS}
<div class="ab-top">
  <div class="ab-f"><label>设备</label><select id="abDev"></select></div>
  <div class="ab-f"><label>链接</label><select id="abLink"></select></div>
  <div class="ab-url" id="abUrl"></div>
</div>
<div class="ab-kpis" id="abKpis"></div>
<div id="abList"></div>
<script>
(function(){
  const DATA = ${jsonForScript(data)};
  const dev = document.getElementById('abDev'), lnk = document.getElementById('abLink');
  const esc = s => String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  dev.innerHTML = DATA.map((d,i) => '<option value="'+i+'">'+esc(d.user)+'</option>').join('');

  function fillLinks(){
    const d = DATA[dev.value|0];
    // 有人用过的链接排前面,并在标签上标出次数 —— 空链接沉底,免得每次都要翻
    const idx = d.links.map((l,i) => i);
    idx.sort((a,b) => d.links[b].clients.length - d.links[a].clients.length);
    lnk.innerHTML = idx.map(i => {
      const l = d.links[i];
      const n = l.clients.reduce((s,c) => s+c.count, 0);
      return '<option value="'+i+'">'+esc(l.label)+(n?' · '+n+' 次':'')+'</option>';
    }).join('');
    render();
  }
  function render(){
    const d = DATA[dev.value|0], l = d.links[lnk.value|0];
    document.getElementById('abUrl').textContent = l.url;
    const total = l.clients.reduce((s,c) => s+c.count, 0);
    const gone = l.clients.filter(c => c.state === 'gone').length;
    document.getElementById('abKpis').innerHTML =
      kpi('总访问', total) + kpi('客户端', l.clients.length) +
      kpi('最近一次', l.clients.length ? l.clients[0].ago : '—', 'ok', true) +
      kpi('超 7 天没来', gone, gone ? 'bad' : '');
    const max = Math.max(1, ...l.clients.map(c => c.count));
    document.getElementById('abList').innerHTML = l.clients.length
      ? l.clients.map(c =>
          '<div class="ab-row"><span class="ab-led '+c.state+'"></span>' +
          '<div class="ab-who"><b'+(c.known?'':' class="unk"')+'>'+esc(c.name)+
            (c.ver?' <span style="font-weight:400;opacity:.6;font-size:12px">'+esc(c.ver)+'</span>':'')+'</b>' +
            '<p'+(c.known?'':' class="mono"')+'>'+esc(c.meta)+' · '+esc(c.ago)+'</p></div>' +
          '<div class="ab-meter'+(c.state==='gone'?' dim':'')+'"><i style="width:'+
            Math.round(c.count/max*100)+'%"></i></div>' +
          '<div class="ab-cnt">'+c.count+'<small>次</small></div></div>').join('')
      : '<div class="ab-empty">这条链接还没有客户端拉过</div>';
  }
  function kpi(label, val, cls, small){
    return '<div class="ab-k'+(cls?' '+cls:'')+'"><span>'+label+'</span><b'+(small?' class="sm"':'')+'>'+val+'</b></div>';
  }
  dev.addEventListener('change', fillLinks);
  lnk.addEventListener('change', render);
  fillLinks();
})();
</script>`;
}

const CSS = `<style>
.win.dark .body{--ab-card:#12151c;--ab-card2:#161a22;--ab-bd:#1e222b;--ab-bd2:#262a35;
  --ab-fg:#e7e9ee;--ab-dim:#6b7280;--ab-dim2:#9ca3af;--ab-ok:#34d399;--ab-mid:#fbbf24;--ab-bad:#f87171}
.ab-top{display:flex;gap:10px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap}
.ab-f{display:flex;flex-direction:column;gap:5px}
.ab-f label{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ab-dim)}
.ab-top select{font:inherit;font-size:13px;font-weight:600;padding:8px 32px 8px 12px;
  border:1px solid var(--ab-bd2);border-radius:9px;background:var(--ab-card2);color:var(--ab-fg);
  appearance:none;cursor:pointer;min-width:170px;max-width:230px;background-repeat:no-repeat;
  background-position:right 11px center;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M3 5l3 3 3-3' stroke='%236b7280' stroke-width='1.6' fill='none' stroke-linecap='round'/></svg>")}
.ab-url{flex:1;min-width:220px;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ab-dim);
  background:var(--ab-card);border:1px solid var(--ab-bd);border-radius:9px;padding:9px 12px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ab-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:16px}
.ab-k{background:linear-gradient(180deg,var(--ab-card2),var(--ab-card));border:1px solid var(--ab-bd2);
  border-radius:12px;padding:12px 14px}
.ab-k span{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ab-dim)}
.ab-k b{display:block;font-size:23px;font-weight:800;letter-spacing:-.03em;margin-top:5px;color:#fff;
  font-variant-numeric:tabular-nums}
.ab-k b.sm{font-size:15px;letter-spacing:-.01em}
.ab-k.ok b{color:var(--ab-ok)}
.ab-k.bad b{color:var(--ab-bad)}
.ab-row{display:flex;align-items:center;gap:13px;background:var(--ab-card);border:1px solid var(--ab-bd);
  border-radius:12px;padding:12px 15px;margin-bottom:7px}
.ab-led{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
.ab-led.ok{background:var(--ab-ok);box-shadow:0 0 10px var(--ab-ok)}
.ab-led.cold{background:var(--ab-mid);box-shadow:0 0 10px var(--ab-mid)}
.ab-led.gone{background:var(--ab-bad);box-shadow:0 0 10px var(--ab-bad)}
.ab-who{flex:1;min-width:0}
.ab-who b{font-size:14px;font-weight:700;color:#f3f4f6}
.ab-who b.unk{color:var(--ab-dim2);font-weight:600}
.ab-who p{font-size:11.5px;color:var(--ab-dim);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ab-who p.mono{font-family:ui-monospace,Menlo,monospace;font-size:10.5px}
.ab-meter{width:100px;flex:0 0 auto;height:5px;background:var(--ab-bd2);border-radius:3px;overflow:hidden}
.ab-meter i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,var(--ab-ok),#22d3ee)}
.ab-meter.dim i{background:#4b5563}
.ab-cnt{width:58px;text-align:right;flex:0 0 auto;font-size:16px;font-weight:800;color:#fff;
  letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.ab-cnt small{display:block;font-size:10px;font-weight:600;color:var(--ab-dim);margin-top:2px}
.ab-empty{color:var(--ab-dim);font-size:12.5px;padding:30px 2px;text-align:center}
@media (max-width:640px){.ab-kpis{grid-template-columns:repeat(2,1fr)}.ab-meter{display:none}}
</style>`;

// os/apps/system.ts — 「系统」app:这台服务器现在是个什么状况 + 邮件测试。
//
// 老后台除了设备/节点/备份/邮件,还有一个「状态」页,桌面版的 app 列表里没有对应项。
// 与其为它单开一个图标,不如并进「系统」—— 那一页问的本来就是同一个问题:
// "服务器那边现在好着吗"。分成两个图标只会让人每次都要想一下该点哪个。
//
// 这一页只读,不做任何变更(除了发一封测试邮件),所以没有"未保存"的概念。

import { escapeHtml } from "../../ui.ts";
import { ADMIN_EMAIL, MAIL_FROM, NODE_CAP, NODE_HISTORY } from "../../config.ts";
import { getNodes, getNodesUpdated, getServiceState, listDevices } from "../../kv.ts";
import { computeNodeStats } from "../../node-stats.ts";
import { ALL_PROTOS } from "../../formats.ts";
import { dbEnabled } from "../../db.ts";
import { freeStoreEnabled } from "../../free/store.ts";
import { ago, APP_CSS } from "./css.ts";

/** 协议配色。跟节点内容那一页的 .proto 徽章同一套,免得同一个协议两页两个颜色。 */
const PROTO_COLOR: Record<string, string> = {
  vless: "#c02a12",
  anytls: "#7a3fa8",
  trojan: "#26804a",
  vmess: "#2d5bc0",
  ss: "#a06d10",
};

export async function systemApp(origin: string): Promise<string> {
  const [nodes, updated, devices, svc] = await Promise.all([
    getNodes(),
    getNodesUpdated(),
    listDevices(),
    getServiceState(),
  ]);
  const stats = computeNodeStats(nodes);
  const stale = updated > 0 && Date.now() - updated > 24 * 3600 * 1000;

  // 协议分布的堆叠条。零的协议不画段,否则会出现一堆 0 宽度的段,边框叠在一起像脏点。
  const segs = ALL_PROTOS
    .map((p) => ({ p, n: stats.byProto[p] }))
    .filter((x) => x.n > 0)
    .map((x) =>
      `<i style="width:${(x.n / stats.total * 100).toFixed(1)}%;background:${PROTO_COLOR[x.p]}"
          title="${x.p} ${x.n} 个"></i>`
    ).join("");
  const legend = ALL_PROTOS
    .map((p) => ({ p, n: stats.byProto[p] }))
    .filter((x) => x.n > 0)
    .map((x) =>
      `<span><i style="background:${PROTO_COLOR[x.p]}"></i>${x.p} <b>${x.n}</b>
        <em>${Math.round(x.n / stats.total * 100)}%</em></span>`
    ).join("");

  const cached = stats.batchLabel?.includes("⚠");

  return `${APP_CSS}${CSS}
<h3>系统</h3>
<div class="sub">除了下面这个总开关,这一页只看不改。要动设备去「设备管理」,要动节点去「节点内容」。</div>

<div class="svc ${svc.up ? "up" : "down"}">
  <div class="svc-t">
    <b>${svc.up ? "服务开启中" : "服务已关闭"}</b>
    <p>${
      svc.up
        ? "订阅链接正常工作。"
        : "<b>所有订阅链接一律返回 404</b>,家人现在拉不到订阅(客户端会保留上一次的配置,不会当场断网)。"
    }${
      svc.changedAt ? ` 上次切换:${escapeHtml(new Date(svc.changedAt).toLocaleString("zh-CN"))}。` : ""
    }</p>
  </div>
  <form data-os${
      // 只有"关"需要确认 —— 开是把东西恢复正常,不需要拦一道。
      svc.up ? ` data-confirm="关闭之后所有订阅链接立刻变成 404,家人拉不到订阅。确定?"` : ""
    }>
    <input type="hidden" name="action" value="service">
    <input type="hidden" name="up" value="${svc.up ? "0" : "1"}">
    <button class="btn ${svc.up ? "danger" : "primary"}">${svc.up ? "关闭服务" : "开启服务"}</button>
  </form>
</div>

<div class="note info">
  关掉之后返回的 404 <b>跟随便敲一个不存在的链接完全一样</b> —— 正文、状态码、响应头都一致,
  从外面看不出这个域名上到底有没有服务。<br>
  <b>后台、<code>/push</code>、应急查码页不受影响</b>:关了照样能进来开回来,rClash 也照样能推节点。
  否则按一下就把自己锁在外面了。rClash 里也有同一个开关(走 <code>/switch</code>,同一把 PUSH_KEY)。
</div>

<h4>本批次(本地实测端推上来的)</h4>
<table class="kv">
  <tr><td>批次标签</td><td>${
    stats.batchLabel ? escapeHtml(stats.batchLabel) : `<span class="muted">暂无 —— 还没推送过</span>`
  }</td></tr>
  <tr><td>收到时间</td><td>${
    updated
      ? `<b>${ago(updated)}</b> · ${escapeHtml(new Date(updated).toLocaleString("zh-CN"))}
         ${stale ? `<span class="pill warn" style="margin-left:6px">超过 24 小时没更新</span>` : ""}`
      : "—"
  }</td></tr>
  <tr><td>节点数</td><td>
    <b style="font-size:15px">${stats.total}</b> 个(不含末尾那条时间戳自我节点),上限 ${NODE_CAP}
    ${stats.total > 0 ? `<div class="stack">${segs}</div><div class="legend">${legend}</div>` : ""}
  </td></tr>
</table>
${
    cached
      ? `<div class="note warn">批次标签里带 ⚠ —— 这批里有协议在吃缓存兜底,说明本地实测端上一轮该协议没测出新节点。</div>`
      : ""
  }

<h4>服务器</h4>
<table class="kv">
  <tr><td>部署地址</td><td class="mono">${escapeHtml(origin)}</td></tr>
  <tr><td>服务器时间</td><td>${escapeHtml(new Date().toLocaleString("zh-CN"))}</td></tr>
  <tr><td>设备</td><td>共 ${devices.length} 台,启用 ${devices.filter((d) => d.enabled).length} 台</td></tr>
  <tr><td>节点历史</td><td>保留 ${NODE_HISTORY} 份(「节点内容」里的"恢复上一版"用的就是它)</td></tr>
</table>

<h4>外部依赖</h4>
<div class="sub" style="margin-bottom:8px">只显示"配没配",不显示任何密钥内容。</div>
<table class="kv">
  <tr><td>Neon(日志归档)</td><td>${dot(dbEnabled, "已连接", "未配置 DATABASE_URL,访问日志只留 KV 里最近约 100 条")}</td></tr>
  <tr><td>Neon(免费节点池)</td><td>${dot(freeStoreEnabled, "已连接", "未配置 DATABASE_URL,抓取能跑但不落库")}</td></tr>
  <tr><td>邮件(Resend)</td><td>${
    dot(!!ADMIN_EMAIL, `发往 ${escapeHtml(ADMIN_EMAIL)}`, "未设置 ADMIN_EMAIL,换季发码邮件不会发出")
  }</td></tr>
  <tr><td>发件地址</td><td class="mono">${escapeHtml(MAIL_FROM)}</td></tr>
</table>

<h4>邮件测试</h4>
<form data-os class="row">
  <input type="hidden" name="action" value="testmail">
  <button class="btn"${ADMIN_EMAIL ? "" : " disabled"}>发送测试邮件</button>
  <span class="sub" style="margin:0">${
    ADMIN_EMAIL
      ? `发往 ${escapeHtml(ADMIN_EMAIL)},收不到记得翻一下垃圾箱`
      : `没设置 ADMIN_EMAIL,发不了`
  }</span>
</form>`;
}

function dot(on: boolean, yes: string, no: string): string {
  return on
    ? `<span class="dot ok"></span>${yes}`
    : `<span class="dot off"></span><span class="muted">${no}</span>`;
}

const CSS = `<style>
.body .muted{color:#86868b}
/* 服务总开关。关掉是个需要一眼看见的状态,所以给整块底色而不是一个小徽章 ——
   "服务关着但界面看着一切正常"是这个功能最坏的失败方式。 */
.body .svc{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:space-between;
  padding:13px 15px;border-radius:11px;margin:14px 0;border:.5px solid}
.body .svc.up{background:#f2fbf5;border-color:#cfebd8}
.body .svc.down{background:#fff6f5;border-color:#f2cdc8}
.body .svc-t{min-width:230px;flex:1}
.body .svc-t b{font-size:14px;font-weight:700;color:#1d1d1f}
.body .svc.up .svc-t b::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;
  background:#34c759;margin-right:7px;vertical-align:1px}
.body .svc.down .svc-t b::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;
  background:#ff3b30;margin-right:7px;vertical-align:1px}
.body .svc-t p{font-size:12px;color:#5a5a5f;margin-top:4px;line-height:1.6}
.body .svc form{margin:0}
.body .pill.warn{background:#fff4d6;color:#8a5d00}
.body .stack{display:flex;height:7px;border-radius:4px;overflow:hidden;margin:9px 0 7px;background:#f2f2f4}
.body .stack i{display:block;height:100%}
.body .legend{display:flex;flex-wrap:wrap;gap:12px;font-size:11.5px;color:#6b6b70}
.body .legend span{display:flex;align-items:center;gap:5px}
.body .legend i{width:7px;height:7px;border-radius:2px;display:inline-block}
.body .legend b{font-weight:700;color:#1d1d1f;font-variant-numeric:tabular-nums}
.body .legend em{font-style:normal;color:#86868b}
</style>`;

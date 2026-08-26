// os/apps/system.ts — 「系统」app:这台服务器现在是个什么状况 + 邮件测试。
//
// 老后台除了设备/节点/备份/邮件,还有一个「状态」页,桌面版的 app 列表里没有对应项。
// 与其为它单开一个图标,不如并进「系统」—— 那一页问的本来就是同一个问题:
// "服务器那边现在好着吗"。分成两个图标只会让人每次都要想一下该点哪个。
//
// 这一页只读,不做任何变更(除了发一封测试邮件),所以没有"未保存"的概念。

import { escapeHtml } from "../../ui.ts";
import { ADMIN_EMAIL, MAIL_FROM, NODE_CAP, NODE_HISTORY } from "../../config.ts";
import { getNodes, getNodesUpdated, listDevices } from "../../kv.ts";
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
  const [nodes, updated, devices] = await Promise.all([
    getNodes(),
    getNodesUpdated(),
    listDevices(),
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
<div class="sub">这一页只看不改。要动设备去「设备管理」,要动节点去「节点内容」。</div>

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
.body .pill.warn{background:#fff4d6;color:#8a5d00}
.body .stack{display:flex;height:7px;border-radius:4px;overflow:hidden;margin:9px 0 7px;background:#f2f2f4}
.body .stack i{display:block;height:100%}
.body .legend{display:flex;flex-wrap:wrap;gap:12px;font-size:11.5px;color:#6b6b70}
.body .legend span{display:flex;align-items:center;gap:5px}
.body .legend i{width:7px;height:7px;border-radius:2px;display:inline-block}
.body .legend b{font-weight:700;color:#1d1d1f;font-variant-numeric:tabular-nums}
.body .legend em{font-style:normal;color:#86868b}
</style>`;

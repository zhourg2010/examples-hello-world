// os/apps/devices.ts — 「设备管理」app 的内容。
//
// 返回的是**片段**不是整页:外壳 fetch 到之后直接塞进窗口的 .body。所以这里不要有
// <html>/<head>,样式也只能用外壳已经定义好的那些类,或者内联。
//
// 表单都带 data-os 属性 —— 外壳靠它接管提交(fetch 而不是整页跳转)。
// 需要二次确认的加 data-confirm,外壳会先 confirm 再提交。

import { escapeHtml } from "../../ui.ts";
import { listDevices } from "../../kv.ts";
import { DEFAULT_FORMAT, DEFAULT_FORMAT_TAGS, FORMATS } from "../../formats.ts";

function ago(ts?: number): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

export async function devicesApp(origin: string): Promise<string> {
  const devices = await listDevices();

  const rows = devices.map((d) => {
    const fmt = d.format ?? DEFAULT_FORMAT;
    const link = `${origin}/l/${encodeURIComponent(d.username)}/${d.id}`;
    // 这些 data-* 是给右键菜单用的:右键一行就能复制链接/启停/换链接/删除
    return `<tr data-user="${escapeHtml(d.username)}" data-enabled="${d.enabled ? 1 : 0}"
        data-link="${escapeHtml(link)}">
      <td><b>${escapeHtml(d.username)}</b></td>
      <td class="mono">${escapeHtml(d.note)}</td>
      <td><span class="pill ${d.enabled ? "on" : "off"}">${d.enabled ? "启用" : "停用"}</span></td>
      <td>
        <form data-os style="display:inline">
          <input type="hidden" name="action" value="switchformat">
          <input type="hidden" name="username" value="${escapeHtml(d.username)}">
          <button class="btn" title="点击轮换默认格式">${escapeHtml(FORMATS[fmt]?.label ?? fmt)}</button>
        </form>
      </td>
      <td style="color:#86868b">${ago(d.lastSeen)}<br><span style="font-size:11px">共 ${d.hits ?? 0} 次</span></td>
      <td style="white-space:nowrap">
        <form data-os style="display:inline">
          <input type="hidden" name="action" value="toggle">
          <input type="hidden" name="username" value="${escapeHtml(d.username)}">
          <button class="btn">${d.enabled ? "停用" : "启用"}</button>
        </form>
        <form data-os style="display:inline" data-confirm="更换 ${escapeHtml(d.username)} 的链接?旧链接会立即失效。">
          <input type="hidden" name="action" value="rotate">
          <input type="hidden" name="username" value="${escapeHtml(d.username)}">
          <button class="btn">换链接</button>
        </form>
        <form data-os style="display:inline" data-confirm="删除设备 ${escapeHtml(d.username)}?此操作不可撤销。">
          <input type="hidden" name="action" value="del">
          <input type="hidden" name="username" value="${escapeHtml(d.username)}">
          <button class="btn danger">删除</button>
        </form>
      </td>
    </tr>`;
  }).join("");

  const fmtOptions = (DEFAULT_FORMAT_TAGS as readonly string[])
    .map((t) => `<option value="${t}"${t === DEFAULT_FORMAT ? " selected" : ""}>${escapeHtml(FORMATS[t]?.label ?? t)}</option>`)
    .join("");

  return `${APP_CSS}
<h3>设备管理</h3>
<div class="sub">${devices.length} 台设备 · ${devices.filter((d) => d.enabled).length} 台启用
  <span style="margin-left:8px;opacity:.75">右键任意一行可以复制链接、启停、换链接、删除</span></div>

<form data-os class="addbar">
  <input type="hidden" name="action" value="add">
  <input name="username" placeholder="用户名(如 老爸-iPhone)" required>
  <input name="note" placeholder="设备码(留空自动生成)">
  <select name="format">${fmtOptions}</select>
  <button class="btn primary">添加设备</button>
</form>

<table><thead><tr>
  <th>用户名</th><th>设备码</th><th>状态</th><th>默认格式</th><th>最近访问</th><th>操作</th>
</tr></thead><tbody>
${rows || `<tr><td colspan="6" style="color:#86868b;padding:22px 0;text-align:center">还没有设备,用上面那一栏加一台</td></tr>`}
</tbody></table>`;
}

// app 自己的样式。每个片段自带,免得外壳要预先知道所有 app 需要什么类。
// 重复注入同名 <style> 是无害的(后面的覆盖前面的,值一样)。
const APP_CSS = `<style>
.body h3{font-size:15px;font-weight:700;color:#1d1d1f;margin-bottom:3px}
.body .sub{font-size:12px;color:#86868b;margin-bottom:14px}
.body table{width:100%;border-collapse:collapse;font-size:12.5px}
.body th{text-align:left;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:#86868b;padding:0 10px 7px 0;border-bottom:1px solid #eaeaec;white-space:nowrap}
.body td{padding:9px 10px 9px 0;border-bottom:1px solid #f2f2f4;color:#1d1d1f;vertical-align:middle}
.body tbody tr:last-child td{border-bottom:none}
.body tbody tr:hover{background:#fafafa}
.body .mono{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:11px;color:#86868b}
.body .pill{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap}
.body .pill.on{background:#e8f8ee;color:#1d8348}
.body .pill.off{background:#f2f2f4;color:#86868b}
.body .btn{font:inherit;font-size:12px;font-weight:500;padding:4px 10px;border-radius:7px;
  border:.5px solid #d0d0d6;background:#fff;color:#1d1d1f;cursor:pointer;
  box-shadow:0 1px 1.5px rgba(0,0,0,.05)}
.body .btn:hover{background:#f6f6f8}
.body .btn.primary{background:#0071e3;color:#fff;border-color:#0071e3}
.body .btn.primary:hover{background:#0062c4}
.body .btn.danger:hover{background:#fff1f0;color:#b3261e;border-color:#f0c4c0}
.body .addbar{display:flex;gap:7px;margin-bottom:16px;flex-wrap:wrap}
.body .addbar input,.body .addbar select{font:inherit;font-size:12.5px;padding:6px 10px;border-radius:7px;
  border:.5px solid #d0d0d6;background:#fff;min-width:0}
.body .addbar input{flex:1;min-width:130px}
.body .addbar select{cursor:pointer}
</style>`;

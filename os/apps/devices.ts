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
import { ago, APP_CSS } from "./css.ts";

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
${rows || `<tr><td colspan="6" class="empty">还没有设备,用上面那一栏加一台</td></tr>`}
</tbody></table>`;
}

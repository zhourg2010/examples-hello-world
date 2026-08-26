// os/apps/backup.ts — 「备份」app:导出全部设备+节点,或者从一段文本恢复回来。
//
// 导出走的是老后台已有的 {ADMIN_PATH}?export=1 —— 那条路由带 content-disposition:
// attachment,浏览器会直接下载,**不会**导航离开当前页面。所以在桌面版里放一个普通
// <a> 就行,桌面不会被顶掉。这一点值得写下来:换成 fetch + Blob 反而要自己造下载,
// 多一份代码还容易在 Safari 上出岔子。
//
// 恢复是覆盖式的,而且不可撤销,所以走 data-confirm(外壳会先弹一次确认)。

import { escapeHtml } from "../../ui.ts";
import { ADMIN_PATH } from "../../config.ts";
import { listDevices } from "../../kv.ts";
import { APP_CSS } from "./css.ts";

export async function backupApp(_origin: string): Promise<string> {
  const devices = await listDevices();

  return `${APP_CSS}${CSS}
<h3>备份</h3>
<div class="sub">备份内容:${devices.length} 台设备(用户名、设备码、链接 id、默认格式、启停状态)
加上当前这份节点池。存成一段 JSON,重建服务时能一把恢复回来。</div>

<h4>导出</h4>
<div class="row">
  <a class="btn primary" href="${escapeHtml(ADMIN_PATH)}?export=1"
     download="proxy-sub-backup.json">下载备份文件</a>
  <span class="sub" style="margin:0">直接下载,不会离开这个桌面</span>
</div>
<div class="note warn">
  备份里含<b>全部订阅链接的 id</b> —— 拿到它就等于拿到全家所有人的订阅地址。
  别丢在聊天记录或者公共网盘里;真泄露了,去「设备管理」逐台点「换链接」就能全部作废。
</div>

<div class="hr"></div>

<h4>恢复</h4>
<div class="note warn">恢复会<b>覆盖现有全部设备和节点</b>,不可撤销。建议先按上面那个按钮导出一份当前状态。</div>
<form data-os data-confirm="恢复将覆盖现有全部设备和节点,而且不能撤销。确定?">
  <input type="hidden" name="action" value="importbackup">
  <textarea name="backup" rows="7" placeholder="把备份文件的内容整个粘进来" required></textarea>
  <div class="row"><button class="btn danger">恢复备份</button></div>
</form>`;
}

const CSS = `<style>
.body a.btn{text-decoration:none;display:inline-block;line-height:1.5}
.body a.btn.primary:hover{color:#fff}
</style>`;

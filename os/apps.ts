// os/apps.ts — 桌面版的应用登记表 + 内容渲染分发。
//
// 外壳(shell.ts)不知道任何 app 内部是什么,只按 id 来这里要一段 HTML。
// 加一个 app = 在 APPS 里加一行 + 在 renderApp 里加一个分支 + 在 icons.ts 里加个图标。
//
// 迁移策略:这一版只把「设备管理」搬过来,其余五个先占位。老后台 {ADMIN_PATH} 原封不动
// 继续可用 —— 桌面版挂在 {ADMIN_PATH}/os,两边并存。等六个 app 都跑通了再谈换默认。

import { escapeHtml } from "../ui.ts";
import { devicesApp } from "./apps/devices.ts";
import { accessApp } from "./apps/access.ts";

export interface AppSpec {
  id: string;
  name: string;
  /** 窗口默认宽高。用户拖过之后不记忆(刷新就回默认),先不做持久化。 */
  w: number;
  h: number;
  /**
   * 这个 app 的窗口用深色外观(连标题栏一起)。
   * macOS 本来就允许单个应用固定深色(活动监视器、终端都是常见例子),
   * 所以"深色窗口混在浅色桌面里"不违和 —— 反过来,把一块深色面板塞进白色窗口
   * 才是真的怪。访问记录是个看监控的页面,深色更合适。
   */
  dark?: boolean;
}

export const APPS: AppSpec[] = [
  { id: "devices", name: "设备管理", w: 860, h: 460 },
  { id: "access", name: "访问记录", w: 780, h: 500, dark: true },
  { id: "nodes", name: "节点内容", w: 680, h: 440 },
  { id: "free", name: "免费节点池", w: 720, h: 440 },
  { id: "backup", name: "备份", w: 540, h: 320 },
  { id: "system", name: "系统 / 邮件", w: 560, h: 360 },
];

export function isApp(id: string): boolean {
  return APPS.some((a) => a.id === id);
}

/** 还没搬过来的 app 显示这个,并把老后台的入口给出来 —— 不留死路。 */
function placeholder(name: string, adminPath: string): string {
  return `<div style="padding:34px 10px;text-align:center;color:#86868b">
    <div style="font-size:14px;font-weight:600;color:#1d1d1f;margin-bottom:6px">${escapeHtml(name)}</div>
    <div style="font-size:12.5px;line-height:1.7">这个 app 还没搬到桌面版。<br>
      现在可以在旧版后台里用:<a href="${adminPath}" style="color:#0071e3">打开旧版后台 →</a></div></div>`;
}

export async function renderApp(id: string, origin: string, adminPath: string): Promise<string> {
  if (id === "devices") return await devicesApp(origin);
  if (id === "access") return await accessApp(origin);
  const app = APPS.find((a) => a.id === id);
  return placeholder(app?.name ?? id, adminPath);
}

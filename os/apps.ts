// os/apps.ts — 桌面版的应用登记表 + 内容渲染分发。
//
// 外壳(shell.ts)不知道任何 app 内部是什么,只按 id 来这里要一段 HTML。
// 加一个 app = 在 APPS 里加一行 + 在 RENDERERS 里加一项 + 在 icons.ts 里加个图标。
//
// 六个 app 都搬完了。老后台 {ADMIN_PATH} 仍然原封不动继续可用 —— 桌面版挂在
// {ADMIN_PATH}/os,两边并存,出任何问题都能退回去。要不要把默认切到桌面版是另一件事。

import { devicesApp } from "./apps/devices.ts";
import { accessApp } from "./apps/access.ts";
import { nodesApp } from "./apps/nodes.ts";
import { freeApp } from "./apps/free.ts";
import { backupApp } from "./apps/backup.ts";
import { systemApp } from "./apps/system.ts";

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
  // 节点内容默认开大一点:八列的表,窄了就得横着滚,而这一页是要一眼扫过去比较的
  { id: "nodes", name: "节点内容", w: 900, h: 560 },
  { id: "free", name: "免费节点池", w: 860, h: 540 },
  { id: "backup", name: "备份", w: 600, h: 480 },
  { id: "system", name: "系统 / 邮件", w: 640, h: 560 },
];

/**
 * id → 渲染函数。用表而不是一串 if:漏登记的话下面那行 RENDERERS[id] 直接是
 * undefined,加 app 时忘了接线会立刻暴露,而不是悄悄掉进某个兜底分支。
 */
const RENDERERS: Record<string, (origin: string) => Promise<string>> = {
  devices: devicesApp,
  access: accessApp,
  nodes: nodesApp,
  free: freeApp,
  backup: backupApp,
  system: systemApp,
};

export function isApp(id: string): boolean {
  return APPS.some((a) => a.id === id);
}

export async function renderApp(id: string, origin: string): Promise<string> {
  const render = RENDERERS[id];
  if (!render) {
    // 走到这儿说明 APPS 里有它、RENDERERS 里没有 —— 是接线漏了,不是用户干错了什么
    return `<div class="spin">这个 app(${escapeId(id)})没有登记渲染函数,是个 bug。</div>`;
  }
  return await render(origin);
}

function escapeId(s: string): string {
  return s.replace(/[^a-z0-9_-]/gi, "");
}

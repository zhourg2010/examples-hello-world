// routes/tools.ts — 自用工具箱页面(需登录)。
// 全部工具纯前端在浏览器本地运行,数据不离开浏览器,不经服务器。

import { isAuthed } from "../auth.ts";
import { html, loginPage } from "../ui.ts";
import { toolsPage } from "../tools_ui.ts";

export async function handleTools(req: Request): Promise<Response> {
  if (!(await isAuthed(req))) return html(loginPage());
  return html(toolsPage());
}

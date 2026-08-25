// routes/os.ts — 桌面版后台的三个入口。
//
//   GET  {ADMIN_PATH}/os              外壳(桌面 / Dock / 窗口管理器)
//   GET  {ADMIN_PATH}/os/app/{id}     某个 app 的内容片段
//   POST {ADMIN_PATH}/os/act          变更操作,返回 JSON 而不是 303 跳转
//
// 老后台 {ADMIN_PATH} 完全不动,两边并存 —— 桌面版还在迁移中,出任何问题都能退回去用。
//
// 鉴权跟老后台共用同一个 cookie(auth.ts 的 isAuthed),没登录一律 401,
// 由前端负责把用户送回登录页。不在这里渲染登录页:桌面版是 fetch 拉片段的,
// 返回一整页登录 HTML 会被当成片段塞进窗口,那才叫莫名其妙。

import { ADMIN_PATH } from "../config.ts";
import { isAuthed } from "../auth.ts";
import { runAction } from "../actions.ts";
import { shellPage } from "../os/shell.ts";
import { isApp, renderApp } from "../os/apps.ts";
import { html } from "../ui.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleOs(req: Request, url: URL): Promise<Response> {
  if (!(await isAuthed(req))) {
    // 片段/动作请求返回 401 让前端处理;直接开外壳页的话跳去登录。
    if (req.headers.get("x-os")) return json({ ok: false, msg: "登录已过期,请重新登录" }, 401);
    return Response.redirect(new URL(ADMIN_PATH, url.origin), 302);
  }

  const rest = url.pathname.slice((ADMIN_PATH + "/os").length); // "" | "/app/xxx" | "/act"

  // 外壳
  if (rest === "" || rest === "/") return html(shellPage());

  // app 内容片段
  if (rest.startsWith("/app/") && req.method === "GET") {
    const id = rest.slice("/app/".length);
    if (!isApp(id)) return new Response("Unknown app", { status: 404 });
    const frag = await renderApp(id, url.origin, ADMIN_PATH);
    return new Response(frag, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // 变更操作
  if (rest === "/act" && req.method === "POST") {
    const f = await req.formData();
    const action = String(f.get("action") ?? "");
    const r = await runAction(action, f);
    if (!r) return json({ ok: false, msg: `不认识的操作:${action}` }, 400);
    return json(r);
  }

  return new Response("Not Found", { status: 404 });
}

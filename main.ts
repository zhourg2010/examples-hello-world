import { serveFile } from "jsr:@std/http/file-server";

// ===================== 配置(在 Deno Deploy → Settings → Environment Variables 设)=====================
//   SEED            你的秘密种子(登录码靠它派生,必填)
//   RESEND_API_KEY  Resend 的 re_xxx(要发邮件就填)
//   ADMIN_EMAIL     收件邮箱(建议=Resend 注册邮箱)
//   MAIL_FROM       发件地址(可选;没验证自己域名前用默认 onboarding@resend.dev)
const SEED = Deno.env.get("SEED") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "onboarding@resend.dev";

// ===================== 路径 =====================
const ADMIN_PATH = "/2718281828";      // e 前十位 = 管理后台
const FALLBACK_PATH = "/8281828172";   // 倒序 = 查当季码的兜底入口

const kv = await Deno.openKv();

// ===================== 工具 =====================
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混字符 I/O/0/1

function currentQuarter(d = new Date()): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

// 种子 + 季度 → 派生 10 串登录码(同季度恒定,换季自动全变)
async function quarterCodes(seed: string, quarter: string): Promise<string[]> {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${seed}::${quarter}::${i}`),
    );
    const bytes = new Uint8Array(buf);
    let code = "";
    for (let j = 0; j < 8; j++) code += CHARS[bytes[j] % CHARS.length];
    codes.push(code);
  }
  return codes;
}

// 生成 10 位随机数字 id(每台设备的密钥)
function genId(): string {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => (x % 10).toString()).join("");
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function getCookie(req: Request, name: string): string | null {
  const c = req.headers.get("cookie") ?? "";
  for (const part of c.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v ?? "");
  }
  return null;
}

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...extra },
  });
}

function redirect(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...extra } });
}

// ===================== 发邮件 =====================
// 返回 {ok, error}: ok=true 发送成功; 否则 error 为原因(用于页面提示)
async function sendMail(subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: "未设置 RESEND_API_KEY" };
  if (!ADMIN_EMAIL) return { ok: false, error: "未设置 ADMIN_EMAIL" };
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: MAIL_FROM, to: [ADMIN_EMAIL], subject, text }),
    });
    if (resp.ok) return { ok: true };
    const body = await resp.text();
    return { ok: false, error: `Resend ${resp.status}: ${body.slice(0, 300)}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 换季自动发新码(原子标记防重复)
async function maybeSendQuarterEmail() {
  if (!SEED || !RESEND_API_KEY || !ADMIN_EMAIL) return;
  const q = currentQuarter();
  const flagKey = ["sent", q];
  if ((await kv.get(flagKey)).value) return;
  const claim = await kv.atomic().check({ key: flagKey, versionstamp: null }).set(flagKey, true).commit();
  if (!claim.ok) return; // 别的请求已抢先,只发一次
  const codes = await quarterCodes(SEED, q);
  await sendMail(`订阅管理 - ${q} 登录码`, `本季(${q})登录码,任一可登录后台:\n\n${codes.join("\n")}`);
}

// ===================== 样式 =====================
const STYLE = `<style>
  :root{--bd:#e5e7eb;--fg:#1f2937;--muted:#6b7280;--blue:#2563eb;--red:#dc2626;--bg:#f9fafb}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;max-width:920px;margin:32px auto;padding:0 16px;color:var(--fg);background:#fff}
  h2{margin:28px 0 12px;font-size:18px}
  .err{color:var(--red)}
  .ok{color:#059669}
  .notice{padding:10px 14px;border-radius:8px;margin:10px 0;font-size:14px}
  .notice.good{background:#ecfdf5;color:#059669}
  .notice.bad{background:#fef2f2;color:#b91c1c;word-break:break-all}
  input,textarea{font:inherit;padding:8px 10px;border:1px solid var(--bd);border-radius:8px;outline:none}
  input:focus,textarea:focus{border-color:var(--blue)}
  button{font:inherit;font-size:13px;padding:6px 12px;border:1px solid transparent;border-radius:8px;background:var(--blue);color:#fff;cursor:pointer;transition:.15s;white-space:nowrap}
  button:hover{filter:brightness(1.08)}
  button.ghost{background:#fff;color:var(--fg);border-color:var(--bd)}
  button.ghost:hover{background:var(--bg)}
  button.danger{background:#fff;color:var(--red);border-color:#fecaca}
  button.danger:hover{background:#fef2f2}
  table{border-collapse:separate;border-spacing:0;width:100%;margin-top:8px;font-size:14px;border:1px solid var(--bd);border-radius:10px;overflow:hidden}
  th{background:var(--bg);color:var(--muted);font-weight:600;text-align:left;padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
  td{border-top:1px solid var(--bd);padding:10px 12px;vertical-align:middle}
  .url{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);word-break:break-all;max-width:280px}
  .actions{display:flex;gap:6px;align-items:center;flex-wrap:nowrap}
  .actions form{display:inline;margin:0}
  .status{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px}
  .status.on{background:#ecfdf5;color:#059669}.status.off{background:#fef2f2;color:#b91c1c}
  .addform{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px}
  .addform input{flex:1;min-width:160px}
  textarea{width:100%;font-family:ui-monospace,monospace;font-size:12px;line-height:1.5}
  .box{max-width:360px}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
  .qr-mask{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center;z-index:50}
  .qr-mask.show{display:flex}
  .qr-card{background:#fff;padding:24px;border-radius:16px;text-align:center;max-width:300px}
  .qr-card #qrbox{margin:8px auto}
  .qr-card p{font-size:12px;color:var(--muted);word-break:break-all;margin:12px 0 0}
</style>`;

// ===================== 页面 =====================
function loginPage(msg = ""): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${STYLE}
  <div class="box"><h2>管理登录</h2>${msg ? `<p class="err">${escapeHtml(msg)}</p>` : ""}
  <form method="post"><input type="hidden" name="action" value="login">
  <input name="code" placeholder="当季登录码" autocomplete="off">
  <button>登录</button></form></div>`;
}

function seedPage(msg = ""): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${STYLE}
  <div class="box"><h2>查看当季登录码</h2>${msg ? `<p class="err">${escapeHtml(msg)}</p>` : ""}
  <form method="post"><input type="hidden" name="x" value="1">
  <input name="seed" placeholder="输入种子(SEED)" autocomplete="off">
  <button>查看</button></form></div>`;
}

function codesPage(q: string, codes: string[]): string {
  return `<!doctype html><meta charset="utf-8">${STYLE}
  <h2>${escapeHtml(q)} 登录码</h2><p>任一可登录后台:</p>
  <ul>${codes.map((c) => `<li><code>${c}</code></li>`).join("")}</ul>`;
}

function dashboardPage(
  devices: Array<{ username: string; id: string; enabled: boolean; note?: string }>,
  nodes: string,
  origin: string,
  notice = "",
): string {
  const rows = devices.map((d) => {
    const link = `${origin}/l/${encodeURIComponent(d.username)}/${d.id}`;
    const j = JSON.stringify(link);
    return `<tr>
    <td><strong>${escapeHtml(d.username)}</strong></td>
    <td style="color:var(--muted)">${escapeHtml(d.note)}</td>
    <td><span class="status ${d.enabled ? "on" : "off"}">${d.enabled ? "启用" : "停用"}</span></td>
    <td class="url">${link}</td>
    <td><div class="actions">
      <button type="button" class="ghost" onclick='copyLink(${j},this)'>复制</button>
      <button type="button" class="ghost" onclick='showQR(${j})'>二维码</button>
      <form method="post"><input type="hidden" name="action" value="toggle"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="ghost">${d.enabled ? "停用" : "启用"}</button></form>
      <form method="post" onsubmit="return confirm('删除 ${escapeHtml(d.username)} ?')"><input type="hidden" name="action" value="del"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="danger">删除</button></form>
    </div></td></tr>`;
  }).join("");

  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${STYLE}
  ${notice}
  <h2>设备管理</h2>
  <form method="post" class="addform"><input type="hidden" name="action" value="add">
    <input name="username" placeholder="用户名(如 father-win)" required>
    <input name="note" placeholder="备注(可选)"><button>添加设备</button></form>
  <table><tr><th>用户名</th><th>备注</th><th>状态</th><th>订阅链接(发给家人)</th><th>操作</th></tr>${rows || `<tr><td colspan="5" style="color:var(--muted)">暂无设备</td></tr>`}</table>

  <h2>节点内容(整批替换)</h2>
  <form method="post"><input type="hidden" name="action" value="savenodes">
    <textarea name="nodes" rows="12">${escapeHtml(nodes)}</textarea>
    <div class="row"><button>保存节点</button></div></form>

  <h2>邮件测试</h2>
  <form method="post"><input type="hidden" name="action" value="testmail">
    <div class="row">
      <button class="ghost">发送测试邮件</button>
      <span style="color:var(--muted);font-size:13px">发送到 ${escapeHtml(ADMIN_EMAIL || "(未设置 ADMIN_EMAIL)")}</span>
    </div></form>

  <div class="qr-mask" id="qrmask" onclick="if(event.target===this)this.classList.remove('show')">
    <div class="qr-card"><div id="qrbox"></div><p id="qrtext"></p>
      <button class="ghost" style="margin-top:14px" onclick="document.getElementById('qrmask').classList.remove('show')">关闭</button>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
  <script>
  async function copyLink(text, btn){
    try{ await navigator.clipboard.writeText(text); }
    catch(e){ const t=document.createElement('textarea');t.value=text;document.body.appendChild(t);t.select();try{document.execCommand('copy');}catch(_){}document.body.removeChild(t); }
    const old=btn.textContent;btn.textContent='已复制';btn.disabled=true;
    setTimeout(()=>{btn.textContent=old;btn.disabled=false;},1200);
  }
  function showQR(text){
    const box=document.getElementById('qrbox');box.innerHTML='';
    new QRCode(box,{text:text,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});
    document.getElementById('qrtext').textContent=text;
    document.getElementById('qrmask').classList.add('show');
  }
  </script>`;
}

function noticeHtml(msg: string, good: boolean): string {
  return `<div class="notice ${good ? "good" : "bad"}">${escapeHtml(msg)}</div>`;
}

// ===================== 主入口 =====================
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  await maybeSendQuarterEmail(); // 换季后首次访问触发

  // ---- 订阅:/l/{username}/{id} ----
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "l" && parts.length === 3) {
    const username = decodeURIComponent(parts[1]);
    const dev = await kv.get<{ id: string; enabled: boolean }>(["device", username]);
    if (!dev.value || !dev.value.enabled || dev.value.id !== parts[2]) {
      return new Response("Not Found", { status: 404 });
    }
    const nodes = (await kv.get<string>(["nodes"])).value ?? "";
    return new Response(nodes, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  // ---- 管理后台 ----
  if (path === ADMIN_PATH) {
    const valid = await quarterCodes(SEED, currentQuarter());
    const isAuthed = () => {
      const auth = getCookie(req, "auth");
      return SEED && auth && valid.includes(auth);
    };

    if (req.method === "POST") {
      const f = await req.formData();
      const action = String(f.get("action") ?? "");

      if (action === "login") {
        const code = String(f.get("code") ?? "");
        if (SEED && valid.includes(code)) {
          return redirect(ADMIN_PATH, {
            "Set-Cookie": `auth=${encodeURIComponent(code)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000`,
          });
        }
        return html(loginPage("登录码错误"));
      }

      if (!isAuthed()) return html(loginPage("请先登录"));

      if (action === "add") {
        const username = String(f.get("username") ?? "").trim();
        const note = String(f.get("note") ?? "").trim();
        if (username && !(await kv.get(["device", username])).value) {
          await kv.set(["device", username], { id: genId(), enabled: true, note, created: Date.now() });
        }
        return redirect(ADMIN_PATH);
      } else if (action === "toggle") {
        const u = String(f.get("username") ?? "");
        const cur = await kv.get<{ id: string; enabled: boolean; note?: string }>(["device", u]);
        if (cur.value) await kv.set(["device", u], { ...cur.value, enabled: !cur.value.enabled });
        return redirect(ADMIN_PATH);
      } else if (action === "del") {
        await kv.delete(["device", String(f.get("username") ?? "")]);
        return redirect(ADMIN_PATH);
      } else if (action === "savenodes") {
        await kv.set(["nodes"], String(f.get("nodes") ?? ""));
        return renderDashboard(url.origin, noticeHtml("节点已保存", true));
      } else if (action === "testmail") {
        const r = await sendMail(
          "订阅管理 - 测试邮件",
          `这是一封测试邮件。\n如果你收到了,说明邮件配置正常。\n时间: ${new Date().toISOString()}`,
        );
        const note = r.ok
          ? noticeHtml("测试邮件已发送,请查收(含垃圾箱)", true)
          : noticeHtml("发送失败: " + (r.error ?? "未知错误"), false);
        return renderDashboard(url.origin, note);
      }
      return redirect(ADMIN_PATH);
    }

    // GET
    if (!isAuthed()) return html(loginPage());
    return renderDashboard(url.origin);
  }

  // ---- 兜底:查当季码 ----
  if (path === FALLBACK_PATH) {
    if (req.method === "POST") {
      const f = await req.formData();
      const seed = String(f.get("seed") ?? "");
      if (SEED && seed === SEED) {
        const q = currentQuarter();
        return html(codesPage(q, await quarterCodes(SEED, q)));
      }
      return html(seedPage("种子错误"));
    }
    return html(seedPage());
  }

  // ---- 其他:原来的网页 ----
  // 临时诊断:列出 KV 所有键(看完务必删除)
  if (path === "/debug-kv-9988") {
    const kv = await Deno.openKv();
    const keys: string[] = [];
    for await (const e of kv.list({ prefix: [] })) {
      keys.push(JSON.stringify(e.key));
    }
    return new Response(
      `KV 共 ${keys.length} 条:\n\n` + keys.join("\n"),
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  return serveFile(req, "./index.html");
});

// 渲染后台(读设备 + 节点),可带顶部提示条
async function renderDashboard(origin: string, notice = ""): Promise<Response> {
  const devices: Array<{ username: string; id: string; enabled: boolean; note?: string }> = [];
  for await (const e of kv.list<{ id: string; enabled: boolean; note?: string }>({ prefix: ["device"] })) {
    devices.push({ username: String(e.key[1]), ...e.value });
  }
  const nodes = (await kv.get<string>(["nodes"])).value ?? "";
  return html(dashboardPage(devices, nodes, origin, notice));
}

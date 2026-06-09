import { serveFile } from "jsr:@std/http/file-server";

// ===================== 配置(你在 Deno Deploy 后台设,我看不到)=====================
// 不要写在这里!去 Deno Deploy 项目的 Settings → Environment Variables 添加这三个:
//   SEED            你的秘密种子(登录码靠它派生,务必设,别留空)
//   RESEND_API_KEY  Resend 的 re_xxx(不发邮件可不填)
//   ADMIN_EMAIL     收登录码的邮箱(建议=Resend 注册邮箱)
const SEED = Deno.env.get("SEED") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";

// ===================== 路径 =====================
const ADMIN_PATH = "/2718281828";      // e 前十位 = 管理后台
const FALLBACK_PATH = "/8281828172";   // 倒序 = 查当季码的兜底入口

const kv = await Deno.openKv();

// ===================== 工具 =====================
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉了易混字符 I/O/0/1

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

// ===================== 换季自动发邮件(原子标记防重复)=====================
async function maybeSendQuarterEmail() {
  if (!SEED || !RESEND_API_KEY || !ADMIN_EMAIL) return;
  const q = currentQuarter();
  const flagKey = ["sent", q];
  if ((await kv.get(flagKey)).value) return;
  // 原子抢占:只有第一个请求能 set 成功,从而只发一次
  const claim = await kv.atomic().check({ key: flagKey, versionstamp: null }).set(flagKey, true).commit();
  if (!claim.ok) return;
  const codes = await quarterCodes(SEED, q);
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "onboarding@resend.dev", // 验证自己域名前用这个;之后可换成你的
        to: [ADMIN_EMAIL],
        subject: `订阅管理 - ${q} 登录码`,
        text: `本季(${q})登录码,任一可登录后台:\n\n${codes.join("\n")}`,
      }),
    });
  } catch (_) { /* 邮件失败不影响服务,可用兜底入口查码 */ }
}

// ===================== 页面 =====================
const STYLE = `<style>
  body{font-family:system-ui,sans-serif;max-width:880px;margin:32px auto;padding:0 16px;color:#222}
  h2{margin-top:28px}.err{color:#c00}
  input,textarea{font:inherit;padding:6px 8px;border:1px solid #ccc;border-radius:6px}
  button{font:inherit;padding:6px 12px;border:0;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer}
  button.danger{background:#dc2626}
  table{border-collapse:collapse;width:100%;margin-top:12px}
  td,th{border:1px solid #e5e5e5;padding:6px 8px;text-align:left;font-size:14px;vertical-align:top}
  .url{font-family:monospace;font-size:12px;word-break:break-all}
  .addform input{margin-right:6px}.box{max-width:360px}
</style>`;

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
): string {
  const rows = devices.map((d) => `<tr>
    <td>${escapeHtml(d.username)}</td>
    <td>${escapeHtml(d.note)}</td>
    <td>${d.enabled ? "✅启用" : "⛔停用"}</td>
    <td class="url">${origin}/l/${encodeURIComponent(d.username)}/${d.id}</td>
    <td>
      <form method="post" style="display:inline"><input type="hidden" name="action" value="toggle"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button>${d.enabled ? "停用" : "启用"}</button></form>
      <form method="post" style="display:inline" onsubmit="return confirm('确定删除 ${escapeHtml(d.username)} ?')"><input type="hidden" name="action" value="del"><input type="hidden" name="username" value="${escapeHtml(d.username)}"><button class="danger">删除</button></form>
    </td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${STYLE}
  <h2>设备管理</h2>
  <form method="post" class="addform"><input type="hidden" name="action" value="add">
    <input name="username" placeholder="用户名(如 father-win)" required>
    <input name="note" placeholder="备注(可选)"><button>添加设备</button></form>
  <table><tr><th>用户名</th><th>备注</th><th>状态</th><th>订阅链接(发给家人)</th><th>操作</th></tr>${rows || `<tr><td colspan="5">暂无设备</td></tr>`}</table>
  <h2>节点内容(整批替换)</h2>
  <form method="post"><input type="hidden" name="action" value="savenodes">
    <textarea name="nodes" rows="12" style="width:100%">${escapeHtml(nodes)}</textarea><br>
    <button>保存节点</button></form>`;
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
      // 其余操作需已登录
      const auth = getCookie(req, "auth");
      if (!SEED || !auth || !valid.includes(auth)) return html(loginPage("请先登录"));
      if (action === "add") {
        const username = String(f.get("username") ?? "").trim();
        const note = String(f.get("note") ?? "").trim();
        if (username && !(await kv.get(["device", username])).value) {
          await kv.set(["device", username], { id: genId(), enabled: true, note, created: Date.now() });
        }
      } else if (action === "toggle") {
        const u = String(f.get("username") ?? "");
        const cur = await kv.get<{ id: string; enabled: boolean; note?: string }>(["device", u]);
        if (cur.value) await kv.set(["device", u], { ...cur.value, enabled: !cur.value.enabled });
      } else if (action === "del") {
        await kv.delete(["device", String(f.get("username") ?? "")]);
      } else if (action === "savenodes") {
        await kv.set(["nodes"], String(f.get("nodes") ?? ""));
      }
      return redirect(ADMIN_PATH);
    }
    // GET
    const auth = getCookie(req, "auth");
    if (!SEED || !auth || !valid.includes(auth)) return html(loginPage());
    const devices: Array<{ username: string; id: string; enabled: boolean; note?: string }> = [];
    for await (const e of kv.list<{ id: string; enabled: boolean; note?: string }>({ prefix: ["device"] })) {
      devices.push({ username: String(e.key[1]), ...e.value });
    }
    const nodes = (await kv.get<string>(["nodes"])).value ?? "";
    return html(dashboardPage(devices, nodes, url.origin));
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
  return serveFile(req, "./index.html");
});

// auth.ts — 登录码的派生与验证。登录逻辑只动这里。

import { SEED } from "./config.ts";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混字符 I/O/0/1

export function currentQuarter(d = new Date()): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

// 种子 + 季度 → 派生 10 串登录码(同季度恒定,换季自动全变)
export async function quarterCodes(quarter: string = currentQuarter()): Promise<string[]> {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${SEED}::${quarter}::${i}`),
    );
    const bytes = new Uint8Array(buf);
    let code = "";
    for (let j = 0; j < 8; j++) code += CHARS[bytes[j] % CHARS.length];
    codes.push(code);
  }
  return codes;
}

// 验证一个码是否为当季有效码
export async function isValidCode(code: string): Promise<boolean> {
  if (!SEED || !code) return false;
  return (await quarterCodes()).includes(code);
}

// 验证种子(应急入口用)
export function isValidSeed(seed: string): boolean {
  return !!SEED && seed === SEED;
}

// 从请求 cookie 取登录态并验证
export async function isAuthed(req: Request): Promise<boolean> {
  const cookie = req.headers.get("cookie") ?? "";
  let auth: string | null = null;
  for (const part of cookie.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === "auth") auth = decodeURIComponent(v ?? "");
  }
  return auth ? await isValidCode(auth) : false;
}

/**
 * PUSH_KEY 鉴权(Authorization: Bearer <PUSH_KEY>)。/push、/switch、/free/* 共用一把钥匙。
 *
 * **没配 PUSH_KEY 时一律不通过** —— 没有"没设密钥就放行"这种事,不然任何人都能改节点池。
 *
 * 每次现读环境变量,而不是在模块加载时定死:定死的话测试里"设好 env 再 import"就晚了
 * (模块已经求值过),表现是断言明明写对了、跑出来全是 401,而且看不出为什么。
 * 线上 env 在启动前就位,现读一次是个 map 查找,没有代价。
 */
export function isPushKeyed(req: Request): boolean {
  const key = Deno.env.get("PUSH_KEY") ?? "";
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return !!key && token === key;
}

// 生成 10 位随机数字 id
export function genId(): string {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => (x % 10).toString()).join("");
}

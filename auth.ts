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

// 生成 10 位随机数字 id
export function genId(): string {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => (x % 10).toString()).join("");
}

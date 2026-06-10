// mail.ts — 发邮件。换邮件服务商只动这里。

import { ADMIN_EMAIL, MAIL_FROM, RESEND_API_KEY, SEED } from "./config.ts";
import { currentQuarter, quarterCodes } from "./auth.ts";
import { claimQuarterFlag } from "./kv.ts";

export async function sendMail(subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
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

// 换季后首次访问触发:发新一季登录码(原子标记防重复发送)
export async function maybeSendQuarterEmail(): Promise<void> {
  if (!SEED || !RESEND_API_KEY || !ADMIN_EMAIL) return;
  const q = currentQuarter();
  if (!(await claimQuarterFlag(q))) return; // 已发过或被别的请求抢先
  const codes = await quarterCodes(q);
  await sendMail(`订阅管理 - ${q} 登录码`, `本季(${q})登录码,任一可登录后台:\n\n${codes.join("\n")}`);
}

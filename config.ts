// config.ts — 所有配置集中一处。改配置项只动这里。
// 环境变量在 Deno Deploy → Settings → Environment Variables 设置。

export const SEED = Deno.env.get("SEED") ?? "";
export const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
export const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";
export const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "onboarding@resend.dev";

// 路径:e 前十位 = 后台;倒序 = 应急查码
export const ADMIN_PATH = "/2718281828";
export const FALLBACK_PATH = "/8281828172";

// 后台登录有效期(秒):90 天
export const AUTH_MAX_AGE = 7776000;

// 节点历史保留几份(用于"恢复上一版")
export const NODE_HISTORY = 5;

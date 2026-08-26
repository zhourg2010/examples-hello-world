// config.ts — 所有配置集中一处。改配置项只动这里。
// 环境变量在 Deno Deploy → Settings → Environment Variables 设置。

export const SEED = Deno.env.get("SEED") ?? "";
export const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
export const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";
export const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "onboarding@resend.dev";

// 路径:e 前十位 = 后台;倒序 = 应急查码
export const ADMIN_PATH = "/2718281828";
export const FALLBACK_PATH = "/8281828172";

/**
 * 旧版后台(单页 + 顶栏切 pane)的路径。
 *
 * 2026-08 起 {ADMIN_PATH} 默认给桌面版,旧版挪到这里。**没有删**,原因有两个:
 * 一是桌面版是窗口 + Dock + 右键那一套,手机上根本用不了,而查个链接这种事在手机上
 * 是要发生的;二是新界面万一出岔子,得有个立刻能用的退路。
 * 想整个回到切换之前那一版,git tag old-admin-v1。
 */
export const CLASSIC_PATH = ADMIN_PATH + "/classic";

// 后台登录有效期(秒):90 天
export const AUTH_MAX_AGE = 7776000;

// 节点历史保留几份(用于"恢复上一版")
export const NODE_HISTORY = 5;

// 订阅返回给客户端的节点数量上限。Mac 端 select_and_push.py 的 MAX_NODES 已经把推上来的
// 池子控制在这个数以内了,这里是防御性的第二道闸——上游万一推超量,客户端也不会拿到超量。
// 所有链接(默认链接和各客户端标签链接)共用这一个上限,不再像以前那样默认 50/标签 30 分开。
export const NODE_CAP = 100;

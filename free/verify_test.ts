// free/verify_test.ts — POST /free/verify 的入参校验。
// 跑: deno test -A free/verify_test.ts
//
// 这里只测**不碰数据库的那一半** —— 校验通过之后就去 saveChecks 了,而
// saveChecks 要真的 Neon 连接。没配 DATABASE_URL 时 freeStoreEnabled 是 false,
// 接口在校验之后返回 503,所以能干净地测到"校验挡住了什么、放过了什么"。
//
// 钉的是"错了会很难查"的那些:一条坏数据混进批量 INSERT,报出来的是一句
// Postgres 的外键/类型错误,看不出是第几条、哪个字段。

import { handleFreeVerify } from "../routes/free.ts";

// 自己设一把钥匙,不指望环境里有 —— 从 env 读的话 CI 里没配,校验那几条就全被跳过,
// 一条也保护不了什么。(鉴权现读 env,见 auth.ts 的 isPushKeyed。)
const KEY = "verify-test-key";
Deno.env.set("PUSH_KEY", KEY);
const H = 'a'.repeat(64); // 合法的 uri_hash 形状:64 位十六进制

function post(body: unknown, key = KEY): Request {
  return new Request("http://x/free/verify", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function statusOf(body: unknown, key = KEY): Promise<number> {
  const req = post(body, key);
  const res = await handleFreeVerify(req);
  // 早退的分支(401 / 405 / 400)不会去读请求体,Deno 的资源检查会把没读完的流
  // 判成泄漏 —— 断言明明是对的,测试却红,而且报的错跟被测逻辑毫无关系。
  // 这里显式收掉两边的流。
  if (!req.bodyUsed) await req.body?.cancel();
  await res.body?.cancel();
  return res.status;
}

function assertEq(got: unknown, want: unknown, msg: string) {
  if (got !== want) throw new Error(`${msg}\n  期望: ${want}\n  实际: ${got}`);
}

Deno.test("钥匙不对 → 401", async () => {
  // 钥匙用 ASCII:HTTP header 的值必须是 Latin-1,中文会让 new Request 直接抛
  assertEq(await statusOf({ results: [] }, "wrong-key"), 401, "钥匙不对必须 401");
});

Deno.test("服务端根本没配 PUSH_KEY → 一律 401,没有「没设密钥就放行」这种事", async () => {
  Deno.env.delete("PUSH_KEY");
  try {
    // 连"空钥匙对空钥匙"也不能过 —— 那正是没配密钥的部署被人随手改掉节点池的样子
    assertEq(await statusOf({ results: [] }, ""), 401, "没配 PUSH_KEY 必须拒");
  } finally {
    Deno.env.set("PUSH_KEY", KEY);
  }
});

Deno.test("PUT 之类的方法 → 405", async () => {
  const req = new Request("http://x/free/verify", {
    method: "PUT",
    headers: { authorization: `Bearer ${KEY}` },
  });
  const res = await handleFreeVerify(req);
  await res.body?.cancel();
  assertEq(res.status, 405, "只收 GET 和 POST");
});

Deno.test("GET 是拿历轮汇总,不该被当成写", async () => {
  // 没配 DATABASE_URL 时是 503。要紧的是它**不是 405** ——
  // GET 曾经跟 PUT 一样被挡在方法检查外面,加汇总接口时很容易漏掉这一改。
  const req = new Request("http://x/free/verify", {
    method: "GET",
    headers: { authorization: `Bearer ${KEY}` },
  });
  const res = await handleFreeVerify(req);
  await res.body?.cancel();
  assertEq(res.status, 503, "没配数据库时 503(不是 405)");
});

Deno.test("请求体不是 JSON → 400", async () => {
  assertEq(await statusOf("{这不是json"), 400, "解析不了要明确报 400,不能 500");
});

Deno.test("results 不是数组 / 空数组 → 400", async () => {
  assertEq(await statusOf({}), 400, "缺 results");
  assertEq(await statusOf({ results: "abc" }), 400, "results 不是数组");
  assertEq(await statusOf({ results: [] }), 400, "空数组没什么可存的");
});

Deno.test("uriHash 形状不对 → 400,而不是等外键去挡", async () => {
  // 让 Postgres 的外键报错去挡的话,错误信息是一句 SQL 错误,
  // 看不出是第几条、哪个字段坏了。
  assertEq(await statusOf({ results: [{ uriHash: "太短", ok: true }] }), 400, "长度不对");
  assertEq(await statusOf({ results: [{ uriHash: "Z".repeat(64), ok: true }] }), 400, "不是十六进制");
  assertEq(await statusOf({ results: [{ uriHash: H.toUpperCase(), ok: true }] }), 400, "大写:hashUri 出的是小写");
  assertEq(await statusOf({ results: [{ ok: true }] }), 400, "根本没有 uriHash");
});

Deno.test("ok 必须是布尔 → 400", async () => {
  // "true" 这种字符串在 JS 里是真值,放过去的话不通的节点会被记成通过
  assertEq(await statusOf({ results: [{ uriHash: H, ok: "true" }] }), 400, "字符串 true");
  assertEq(await statusOf({ results: [{ uriHash: H, ok: 1 }] }), 400, "数字 1");
  assertEq(await statusOf({ results: [{ uriHash: H }] }), 400, "没有 ok");
});

Deno.test("latencyMs 不合法 → 400,但可以不填", async () => {
  assertEq(await statusOf({ results: [{ uriHash: H, ok: true, latencyMs: -1 }] }), 400, "负延迟");
  assertEq(await statusOf({ results: [{ uriHash: H, ok: true, latencyMs: "240" }] }), 400, "字符串");
  // NaN 经 JSON.stringify 会变成 null —— 也就是"没测出延迟",那是合法的。
  // 这条留着当文档:别指望 NaN 能被当成坏数据挡下来,它到服务端已经不是 NaN 了。
  assertEq(await statusOf({ results: [{ uriHash: H, ok: true, latencyMs: NaN }] }), 503, "NaN 变 null,合法");
  // 不填是合法的 —— 不通的节点本来就没有延迟
  assertEq(await statusOf({ results: [{ uriHash: H, ok: false, err: "timeout" }] }), 503, "不填 latencyMs 是合法的 —— 不通的节点本来就没有延迟");
});

Deno.test("一次太多条 → 400,不让一个写错的循环把库打爆", async () => {
  const many = Array.from({ length: 10001 }, () => ({ uriHash: H, ok: true }));
  assertEq(await statusOf({ results: many }), 400, "超过 10000 条");
});

Deno.test("合法请求能过校验(没数据库时倒在 503)", async () => {
  const st = await statusOf({ results: [{ uriHash: H, ok: true, latencyMs: 240 }] });
  assertEq(st, 503, "校验全过,只是没配 DATABASE_URL");
});

// push_test.ts — GET /push 的往返性质。
// 跑: deno test -A --unstable-kv push_test.ts
//
// 这个接口存在的唯一理由是"拉回来 → 排序/合并 → 再推回去"。所以要钉的不是
// "能不能返回内容",而是**往返之后一个字节都不变**:
//   - 停用的行不能因为走了一趟就被悄悄启用(那等于替用户做了个他没同意的决定)
//   - 顺序不能变(顺序是用户在后台手动排的,有意义)
//   - count 不该把停用的算进去

import { getNodes, saveNodes } from "./kv.ts";
import { handlePush } from "./routes/push.ts";

const KEY = Deno.env.get("PUSH_KEY") ?? "";
const auth = { authorization: `Bearer ${KEY}` };
const get = (q = "") =>
  handlePush(new Request(`http://x/push${q}`, { headers: auth }), new URL(`http://x/push${q}`));

function assertEq(got: unknown, want: unknown, msg: string) {
  if (got !== want) throw new Error(`${msg}\n  期望: ${want}\n  实际: ${got}`);
}

const SAMPLE = [
  "vless://aaa@1.1.1.1:443#US_1",
  "#OFF# trojan://p@2.2.2.2:443#SG_1",
  "vmess://eyJ2IjoiMiJ9#x",
].join("\n") + "\n";

Deno.test("往返:GET 拿到的内容原样 POST 回去,池子一个字节都不变", async () => {
  await saveNodes(btoa(SAMPLE));
  const before = await getNodes();

  const text = await (await get()).text();
  // 模拟 rClash 原样推回来(它推的是 base64,跟本地实测端一个格式)
  const r = await handlePush(
    new Request("http://x/push", { method: "POST", headers: auth, body: btoa(text) }),
  );
  assertEq(r.status, 200, "推回去应该成功");
  assertEq(await getNodes(), before, "往返之后 KV 里的内容必须完全一致");
});

Deno.test("停用的行走一趟不会被悄悄启用", async () => {
  await saveNodes(btoa(SAMPLE));
  const text = await (await get()).text();
  assertEq(
    text.split("\n").filter((l) => l.startsWith("#OFF# ")).length,
    1,
    "停用行必须带着 #OFF# 前缀原样返回",
  );
});

Deno.test("顺序不变 —— 那是用户在后台手排的,有意义", async () => {
  await saveNodes(btoa(SAMPLE));
  const text = await (await get()).text();
  assertEq(text.trim(), SAMPLE.trim(), "行序必须跟存进去时一致");
});

Deno.test("json 的 count 不把停用的算进去", async () => {
  await saveNodes(btoa(SAMPLE));
  const j = await (await get("?format=json")).json();
  assertEq(j.count, 2, "3 行里有 1 行是停用的,可用的是 2");
  assertEq(j.nodes.length, 3, "但 nodes 要把停用的也列出来");
  assertEq(j.nodes[1].disabled, true, "并且标出它是停用的");
});

Deno.test("没密钥一律 401,读和写都是", async () => {
  const r1 = await handlePush(new Request("http://x/push"), new URL("http://x/push"));
  assertEq(r1.status, 401, "GET 无密钥");
  const r2 = await handlePush(new Request("http://x/push", { method: "POST", body: "x" }));
  assertEq(r2.status, 401, "POST 无密钥");
});

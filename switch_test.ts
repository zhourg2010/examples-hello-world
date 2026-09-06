// switch_test.ts — 服务总开关的语义测试。
// 跑: deno test -A --unstable-kv switch_test.ts
//
// 这里钉的两条都是"错了会很惨、但错了很难发现"的:
//   1. 默认必须是**开着**。KV 抽风、键被误删、老部署第一次升上来 —— 这些情况下
//      结果都该是"服务照常",而不是全家断网。
//   2. 关掉时返回的 404 必须**跟链接写错完全一样**。差一个字节,伪装就没了意义。

import { getServiceState, setServiceUp } from "./kv.ts";
import { handleSubscribe } from "./routes/subscribe.ts";

function assertEq(got: unknown, want: unknown, msg: string) {
  if (got !== want) throw new Error(`${msg}\n  期望: ${want}\n  实际: ${got}`);
}

const req = () => new Request("http://x/l/nobody/0000000000");

Deno.test("没配过开关时,默认是开着的", async () => {
  const s = await getServiceState();
  assertEq(s.up, true, "读不到配置就该当成开着 —— 默认关掉等于一升级就全家断网");
});

Deno.test("关掉之后订阅是 404,开回来就恢复", async () => {
  await setServiceUp(false);
  assertEq((await getServiceState()).up, false, "刚关掉");
  const down = await handleSubscribe(["l", "nobody", "0000000000"], req());
  assertEq(down.status, 404, "关掉时必须 404");

  await setServiceUp(true);
  assertEq((await getServiceState()).up, true, "开回来");
});

Deno.test("关掉时的 404 跟链接写错的 404 一个字节都不差", async () => {
  // 链接写错(服务开着)
  await setServiceUp(true);
  const wrong = await handleSubscribe(["l", "nobody", "0000000000"], req());
  const wrongBody = await wrong.text();

  // 服务关掉(链接同样写错,但根本走不到查设备那步)
  await setServiceUp(false);
  const off = await handleSubscribe(["l", "nobody", "0000000000"], req());
  const offBody = await off.text();
  await setServiceUp(true);

  assertEq(off.status, wrong.status, "状态码必须一样");
  assertEq(offBody, wrongBody, "正文必须一样");
  const hdr = (r: Response) =>
    [...r.headers].map(([k, v]) => `${k}: ${v}`).sort().join(" | ");
  assertEq(hdr(off), hdr(wrong), "响应头必须一样 —— 多一个头就等于告诉别人这里有服务");
});

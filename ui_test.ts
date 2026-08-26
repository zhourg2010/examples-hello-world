// ui_test.ts — jsonForScript 的测试。
// 跑: deno test -A ui_test.ts
//
// 这几条挡的是同一类事故:把数据用 JSON.stringify 直接写进 <script> 里。HTML 解析器
// 在 <script> 内部只找字面量 `</script`,数据里出现它就在那里提前闭合标签,后面的内容
// 当 HTML 解析 —— 而访问记录里的 User-Agent、免费节点池里的节点名,都是外面的人能随手
// 填的东西。所以"值本身没变"和"闭不掉标签"这两条必须同时钉住:只满足后者的写法(比如
// 直接删掉 `<`)会悄悄改数据,比漏洞更难发现。

import { jsonForScript } from "./ui.ts";

function assertEq(got: unknown, want: unknown, msg: string) {
  if (got !== want) throw new Error(`${msg}\n  期望: ${want}\n  实际: ${got}`);
}

Deno.test("UA 里的 </script> 闭不掉脚本标签", () => {
  const ua = "Mozilla/5.0</script><script>window.__PWNED__=1</script>";
  const out = jsonForScript([{ ua }]);
  if (out.includes("</script")) throw new Error(`还能闭合标签:${out}`);
  assertEq(JSON.parse(out)[0].ua, ua, "转义之后解析回来必须是原值");
});

Deno.test("所有 < 都转,不只是 </script", () => {
  // 只匹配 `</script` 是不够的:`<!--` 在 <script> 里同样会切换解析状态。
  const s = "a<b<!--c";
  const out = jsonForScript(s);
  assertEq(out.includes("<"), false, "输出里不该再有裸的 <");
  assertEq(JSON.parse(out), s, "值不变");
});

Deno.test("U+2028/U+2029 不会在 JS 源码里变成换行", () => {
  // JSON 允许这两个字符裸奔,但 JS 里它们是行终止符 —— 裸奔就是语法错误。
  const s = "行一 行二 行三";
  const out = jsonForScript(s);
  assertEq(out.includes(" "), false, "U+2028 应已转义");
  assertEq(out.includes(" "), false, "U+2029 应已转义");
  assertEq(JSON.parse(out), s, "值不变");
});

Deno.test("普通数据跟 JSON.stringify 结果一致", () => {
  const v = { a: 1, b: "两", c: [true, null] };
  assertEq(jsonForScript(v), JSON.stringify(v), "不含危险字符时不应该有任何差异");
});

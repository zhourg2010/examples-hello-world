// ua_test.ts — User-Agent 识别的测试。
// 跑: deno test ua_test.ts

import { describeUa, parseUa } from "./ua.ts";

function assertEq(got: unknown, want: unknown, msg: string) {
  if (got !== want) throw new Error(`${msg}\n  期望: ${want}\n  实际: ${got}`);
}

Deno.test("Clash Verge Rev(源码核实过的 UA 格式)", () => {
  const i = parseUa("clash-verge/v2.5.4");
  assertEq(i.client, "Clash Verge Rev", "客户端名");
  assertEq(i.version, "2.5.4", "版本");
  assertEq(i.known, true, "应识别");
});

Deno.test("sing-box 各平台分得开", () => {
  assertEq(parseUa("SFI/1.12.0 (io.nekohasekai.sfavt)").client, "sing-box (iOS)", "iOS");
  assertEq(parseUa("SFA/1.12.0").client, "sing-box (Android)", "Android");
  assertEq(parseUa("SFM/1.12.0").client, "sing-box (macOS)", "macOS");
  assertEq(parseUa("sing-box 1.13.0").client, "sing-box", "桌面版");
});

Deno.test("常见移动端客户端", () => {
  assertEq(parseUa("Shadowrocket/2.2.35").client, "Shadowrocket 小火箭", "小火箭");
  assertEq(parseUa("Loon/765").client, "Loon", "Loon");
  assertEq(parseUa("Stash/3.1.0 Clash/1.11.0").client, "Stash", "Stash");
  assertEq(parseUa("V2Box/1.0.0").client, "V2Box", "V2Box");
  assertEq(parseUa("Karing/1.2.3").client, "Karing", "Karing");
});

Deno.test("Quantumult X 的 UA 里空格会被编码成 %20", () => {
  assertEq(parseUa("Quantumult%20X/1.0.30").client, "Quantumult X", "编码形式");
  assertEq(parseUa("Quantumult X/1.0.30").client, "Quantumult X", "未编码形式");
  // 不能被更宽泛的 Quantumult 规则抢先匹配掉
  assertEq(parseUa("Quantumult/2.1.0").client, "Quantumult", "老版 Quantumult");
});

Deno.test("规则顺序:更具体的必须排在更宽泛的前面", () => {
  // ClashforWindows 里含 "Clash",不能被 mihomo/ClashX 之类的规则抢走
  assertEq(parseUa("ClashforWindows/0.20.39").client, "Clash for Windows", "CFW");
  // Stash 的 UA 里也带 Clash 字样,同理
  assertEq(parseUa("Stash/3.1.0 Clash/1.11.0").client, "Stash", "Stash 不被 Clash 抢");
  // clash-verge 里含 clash,不能被别的 clash 规则抢
  assertEq(parseUa("clash-verge/v2.5.4").client, "Clash Verge Rev", "Verge 不被抢");
});

Deno.test("浏览器直接打开订阅链接要能区分出来", () => {
  const i = parseUa(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  );
  assertEq(i.known, true, "应识别");
  assertEq(i.client, "Chrome(直接打开)", "认成 Chrome");
});

Deno.test("认不出来的不丢原始 UA,并明确标记未识别", () => {
  const i = parseUa("SomeRandomClient/9.9");
  assertEq(i.known, false, "未识别");
  assertEq(i.client, "", "名字为空");
  assertEq(i.raw, "SomeRandomClient/9.9", "原始 UA 保留");
  assertEq(describeUa("SomeRandomClient/9.9"), "", "描述为空串");
});

Deno.test("完全没有 UA 也不能崩", () => {
  for (const raw of ["", "?", "   "]) {
    const i = parseUa(raw);
    assertEq(i.known, false, `空 UA(${JSON.stringify(raw)})应为未识别`);
    assertEq(i.client, "", "名字为空");
  }
});

Deno.test("describeUa 拼出可读的一行", () => {
  assertEq(describeUa("clash-verge/v2.5.4"), "Clash Verge Rev 2.5.4 · 桌面", "带平台");
  // curl 规则没写 platform,不该多出一个孤零零的 " · "
  assertEq(describeUa("curl/8.4.0"), "curl(命令行) 8.4.0", "无平台时不带分隔符");
});

Deno.test("命令行工具能认出来(自己测链接时会看到)", () => {
  assertEq(parseUa("curl/8.4.0").client, "curl(命令行)", "curl");
  assertEq(parseUa("Wget/1.21.3").client, "wget(命令行)", "wget");
});

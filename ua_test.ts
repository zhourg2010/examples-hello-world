// ua_test.ts — User-Agent 识别的测试。
// 跑: deno test ua_test.ts

import { appleHintOf, describeUa, parseOs, parseUa } from "./ua.ts";

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

// ---------------------------------------------------------------- 操作系统

Deno.test("parseOs:大多数代理客户端的 UA 里没有 OS,必须返回空串而不是猜", () => {
  for (const ua of ["clash-verge/v2.5.4", "Loon/765", "V2Box/1.0.0", "mihomo/v1.19.2"]) {
    assertEq(parseOs(ua), "", `${ua} 不该猜出 OS`);
  }
});

Deno.test("parseOs:Apple 的 CFNetwork/Darwin 能对到系统版本", () => {
  const ua = "Shadowrocket/2.2.35 CFNetwork/1568.100.1 Darwin/24.0.0";
  assertEq(parseOs(ua, "ios"), "≈ iOS 18", "Darwin 24 → iOS 18");
  assertEq(parseOs(ua, "mac"), "≈ macOS 15", "同一个内核版本,mac 提示下是 macOS 15");
  // 没提示时默认按 iOS 猜(带 CFNetwork/Darwin 的多半是 iOS 客户端)
  assertEq(parseOs(ua), "≈ iOS 18", "无提示时默认 iOS");
});

Deno.test("parseOs:表里没有的 Darwin 版本如实显示内核版本,不瞎映射", () => {
  assertEq(parseOs("X/1 Darwin/99.0.0"), "Darwin 99", "未知版本");
});

Deno.test("parseOs:Windows 10 和 11 的 NT 版本一样,不能硬猜", () => {
  assertEq(
    parseOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
    "Windows 10/11",
    "NT 10.0 覆盖 Win10 和 Win11",
  );
  assertEq(parseOs("Mozilla/5.0 (Windows NT 6.1)"), "Windows NT 6.1", "老版本原样显示");
});

Deno.test("parseOs:Android / macOS / Linux", () => {
  assertEq(parseOs("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "Android 14", "Android");
  assertEq(parseOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "macOS 10.15", "macOS");
  assertEq(parseOs("Mozilla/5.0 (X11; Linux x86_64)"), "Linux", "Linux");
});

Deno.test("appleHintOf:只在单一平台存在的客户端才给提示", () => {
  assertEq(appleHintOf("sing-box (iOS)"), "ios", "SFI");
  assertEq(appleHintOf("sing-box (macOS)"), "mac", "SFM");
  assertEq(appleHintOf("Shadowrocket 小火箭"), "ios", "小火箭只有 iOS");
  // 两个平台都有的不给提示,让 parseOs 用默认
  assertEq(appleHintOf("Karing"), undefined, "Karing 跨平台");
  assertEq(appleHintOf("Clash Verge Rev"), undefined, "Verge 跨平台");
});

Deno.test("describeUa 把 OS 拼进去,没有 OS 时不留多余分隔符", () => {
  assertEq(
    describeUa("Shadowrocket/2.2.35 CFNetwork/1568.100.1 Darwin/24.0.0"),
    "Shadowrocket 小火箭 2.2.35 · 移动 · ≈ iOS 18",
    "带 OS",
  );
  assertEq(describeUa("Loon/765"), "Loon 765 · 移动", "没有 OS 时不多一个 ·");
});

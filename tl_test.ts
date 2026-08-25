// tl_test.ts — 设备时间轴刻度的测试。
// 跑: deno test -A tl_test.ts
//
// 这条轴的全部价值就在于"点的位置真的对应那个时间"。刻度函数错了,整个图就是在骗人,
// 而且骗得很难发现 —— 它照样画得挺好看。所以这里逐条钉死。

import { TL_SPAN_HOURS, TL_TICKS, tlPos } from "./ui.ts";

const H = 3600_000;
function assertEq(got: unknown, want: unknown, msg: string) {
  if (got !== want) throw new Error(`${msg}\n  期望: ${want}\n  实际: ${got}`);
}
function near(got: number, want: number, tol: number, msg: string) {
  if (Math.abs(got - want) > tol) throw new Error(`${msg}\n  期望: ${want}±${tol}\n  实际: ${got}`);
}

Deno.test("两端:现在=最右(1),7 天前=最左(0)", () => {
  assertEq(tlPos(0), 1, "刚刚访问过应该贴在最右");
  near(tlPos(TL_SPAN_HOURS * H), 0, 1e-9, "整 7 天应该落在最左");
});

Deno.test("超过 7 天一律压到最左,不会跑出轴外", () => {
  assertEq(tlPos(30 * 24 * H), 0, "30 天");
  assertEq(tlPos(365 * 24 * H), 0, "一年");
});

Deno.test("时钟漂移导致的负数不会把点甩到轴外", () => {
  // 服务器和客户端时间不同步时 last 可能比 now 还新,age 就是负的
  assertEq(tlPos(-5 * H), 1, "负的年龄按 0 处理,贴最右");
});

Deno.test("单调:越久以前,位置越靠左", () => {
  let prev = 1.0000001;
  for (const h of [0, 0.5, 1, 3, 6, 12, 24, 72, 168]) {
    const p = tlPos(h * H);
    if (p >= prev) throw new Error(`${h} 小时处不单调:${p} 应当小于前一个 ${prev}`);
    prev = p;
  }
});

Deno.test("对数刻度确实把最近几小时拉开了(这是选它而不是线性的理由)", () => {
  // 线性刻度下 0~6 小时只占 6/168 = 3.6% 的宽度,分辨不出来。
  const recent = tlPos(0) - tlPos(6 * H);
  if (recent < 0.3) throw new Error(`最近 6 小时只占了 ${(recent * 100).toFixed(1)}%,没拉开`);
  // 而 3 天到 7 天这一段本来就不需要精度,应该被压得很窄
  const old = tlPos(72 * H) - tlPos(168 * H);
  if (old > 0.25) throw new Error(`3~7 天占了 ${(old * 100).toFixed(1)}%,压得不够`);
});

Deno.test("轴上每个刻度标签的位置,就是同一个函数算出来的(轴不会跟点脱节)", () => {
  // 刻度是由 tlPos 生成的而不是写死的百分比。这里确认每个标签都落在合法范围内、
  // 且顺序跟标签文字一致(7 天前最左 → 现在最右)。
  let prev = -1;
  for (const t of TL_TICKS) {
    const p = tlPos(t.h * H);
    if (p < 0 || p > 1) throw new Error(`刻度 ${t.label} 落在 [0,1] 之外:${p}`);
    if (p <= prev) throw new Error(`刻度顺序不对:${t.label} 在前一个之后`);
    prev = p;
  }
  assertEq(TL_TICKS[0].label, "7 天前", "第一个刻度");
  assertEq(TL_TICKS[TL_TICKS.length - 1].label, "现在", "最后一个刻度");
});

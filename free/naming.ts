// free/naming.ts — 免费节点的名字前缀。
//
// 免费节点和自己付费机场的节点最终会出现在**同一个客户端列表**里,家人一眼要能分清:
// 免费节点随时会死、速度不保证、而且背后是谁在运营完全不知道。所以统一加一个前导词。
//
// 前缀在**抓取入库的时候**就打进节点名里(也就是打进分享链接的 #fragment),不是等到渲染
// 时再加。这样做的好处是它跟着节点走完全程:clash / sing-box / base64 / Surge /
// QuantumultX / Loon 每一种格式都是从同一份 URI 渲染出来的,前缀自然就都有了,不用在
// 六个渲染器里各加一遍(那样迟早会漏掉一个)。

/** 免费节点名字的前导词。改这里,全链路一起变。 */
export const FREE_PREFIX = "FREE";

/** 分隔符跟已有的节点名风格保持一致(select_and_push.py 里的 badge 也是用 | 分段的)。 */
const SEP = " | ";

/**
 * 给节点名加上 FREE 前导词。
 * 已经带前缀的不会重复加 —— 同一个节点可能被反复抓到,幂等很重要。
 */
export function withFreePrefix(name: string): string {
  const n = (name ?? "").trim();
  if (!n) return FREE_PREFIX;
  if (n === FREE_PREFIX || n.startsWith(FREE_PREFIX + SEP)) return n;
  return `${FREE_PREFIX}${SEP}${n}`;
}

/** 这个名字是不是免费节点。给下游"要不要混进家人订阅"之类的判断用。 */
export function isFreeName(name: string): boolean {
  const n = (name ?? "").trim();
  return n === FREE_PREFIX || n.startsWith(FREE_PREFIX + SEP);
}

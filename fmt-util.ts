// fmt-util.ts — 各个订阅格式转换器(clash/singbox/surge/quanx/loon)共用的小工具。
// 放在这里而不是各写一份,是因为"节点名去重"和"节点名里的非法字符处理"这两件事
// 一旦各格式实现不一致,就会出现"同一批节点在 A 客户端里能用、在 B 客户端里少几个"
// 这种极难排查的问题。

// deno-lint-ignore-file no-explicit-any

// Mac 端 select_and_push.py 会在节点列表末尾追加一个指向 127.0.0.1:1 的假节点,
// 名字形如"更新于 2026-08-24 10:30",纯粹是让家人在客户端列表里一眼看出这批节点
// 是什么时候推的。它连不通,也不该被当成真节点参与统计/测速。
export const MARKER_SERVER = "127.0.0.1";
export const MARKER_PORT = 1;

export function isMarker(n: any): boolean {
  return n?.server === MARKER_SERVER && Number(n?.server_port) === MARKER_PORT;
}

// 从节点列表里把那个时间戳假节点的名字取出来。surge/quanx/loon 这些格式没法
// 表达一个"连不通的 vless 占位节点",所以它们改成把这个字符串写进文件头的注释里——
// 信息不丢,而且比一个永远测速失败的假节点更干净。
export function batchLabelOf(nodes: any[]): string {
  const m = nodes.find(isMarker);
  return m ? m.tag : "";
}

// clash / sing-box 都要求节点名唯一,重名会被客户端拒绝或静默丢弃。
// 就地改写 tag,重名的追加 -1 -2 ...
export function dedupeTags(nodes: { tag: string }[]): void {
  const seen = new Map<string, number>();
  for (const n of nodes) {
    if (seen.has(n.tag)) {
      const c = seen.get(n.tag)! + 1;
      seen.set(n.tag, c);
      n.tag = `${n.tag}-${c}`;
    } else {
      seen.set(n.tag, 0);
    }
  }
}

// surge / quanx / loon 都是"逗号分隔的一行一个节点"的纯文本格式,节点名里如果混进
// 逗号或等号,整行的字段就会错位——轻则那个节点参数读错,重则整份配置解析失败。
// 机场给的节点名里带逗号并不罕见(比如 "US, Los Angeles"),所以必须先洗一遍。
export function sanitizeInlineName(name: string): string {
  return name
    .replace(/[,=]/g, " ") // 逗号/等号是这三种格式的字段分隔符
    .replace(/["']/g, "")  // 引号会破坏被引号包裹的字段
    .replace(/[\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "node";
}

// 按格式实际支持的协议筛掉表达不了的节点。
// 比如 Surge 既不支持 vless 也不支持 anytls,硬写进去客户端会直接报解析错误,
// 不如在这里就摘掉——宁可少几个节点,也不能让整份配置打不开。
export function keepSupported(nodes: any[], supported: readonly string[]): any[] {
  const set = new Set(supported);
  return nodes.filter((n) => set.has(String(n.type)));
}

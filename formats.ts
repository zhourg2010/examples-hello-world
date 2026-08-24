// formats.ts — 订阅输出格式的唯一登记表。
//
// 以前"哪个后缀走哪种格式""哪个后缀过滤哪些协议""后台该显示几个节点"这三件事
// 分散在 routes/subscribe.ts 和 ui.ts 两个文件里各写一份,加一种格式要改两处、
// 而且两边的协议表很容易对不上(后台显示 30 个、客户端实际只解析出 12 个)。
// 现在全部收口到这张表:加格式只动这里,订阅出口和后台页面都从这里读。
//
// protocols 字段是"这个格式**实际**能表达的协议",不是"我们希望它支持的协议"。
// 这张表是照着各客户端真实的配置语法核过的,尤其注意:
//   - Surge 的代理类型里根本没有 vless 和 anytls,这两类节点给它只会让配置解析失败。
//   - v2rayN / V2Box 对 anytls 的支持不稳定,所以这两个专用后缀也把 anytls 摘掉。
//   - Quantumult X 和 Loon 都是支持 vless + anytls 的,不要跟 Surge 混为一谈。

import { toSingboxJson } from "./singbox.ts";
import { toClashYaml } from "./clash.ts";
import { toSurgeConf } from "./surge.ts";
import { toQuanXConf } from "./quanx.ts";
import { toLoonConf } from "./loon.ts";
import { filterAndReencode } from "./protocol-filter.ts";

// 协议在本项目里的规范写法(跟分享链接的 scheme 一致)。
export type Proto = "vless" | "anytls" | "trojan" | "vmess" | "ss";

export const ALL_PROTOS: readonly Proto[] = ["vless", "anytls", "trojan", "vmess", "ss"];

export function uriPrefixOf(p: Proto): string {
  return `${p}://`;
}

export interface FormatSpec {
  tag: string;                    // 订阅链接后缀,同时也是设备"默认格式"的取值
  label: string;                  // 后台显示的格式名
  clients: string;                // 明确支持这个格式的客户端(后台原样显示给用户看)
  protocols: readonly Proto[];    // 该格式实际能表达的协议
  note?: string;                  // 局限说明,后台会显示出来
  contentType: string;
  render(nodes: string): string;  // nodes 是整段 base64 的标准订阅内容
}

// base64(标准订阅)格式:不做格式转换,只按协议筛一遍再编码回去。
function base64Render(protocols: readonly Proto[]) {
  return (nodes: string): string =>
    protocols.length === ALL_PROTOS.length
      ? nodes
      : filterAndReencode(nodes, protocols.map(uriPrefixOf));
}

const CLASH_LIKE: Proto[] = ["vless", "anytls", "trojan", "vmess", "ss"];

export const FORMATS: Record<string, FormatSpec> = {
  clash: {
    tag: "clash",
    label: "Clash / mihomo",
    clients: "OpenClash、mihomo(Clash.Meta)、Clash Verge Rev、ClashX Meta、Stash、FlClash",
    protocols: CLASH_LIKE,
    contentType: "text/yaml; charset=utf-8",
    render: toClashYaml,
  },
  // 老链接兼容:openclash 后缀跟 clash 完全等价,不要删,家里路由器上还在用。
  openclash: {
    tag: "openclash",
    label: "Clash / mihomo(OpenClash 别名)",
    clients: "OpenClash(与 /clash 输出完全一致,保留是为了兼容已经发出去的旧链接)",
    protocols: CLASH_LIKE,
    contentType: "text/yaml; charset=utf-8",
    render: toClashYaml,
  },
  singbox: {
    tag: "singbox",
    label: "sing-box",
    clients: "sing-box(Windows/macOS/Linux/Android)、SFI / SFM(iOS、macOS)、Hiddify",
    protocols: CLASH_LIKE,
    contentType: "application/json; charset=utf-8",
    render: toSingboxJson,
  },
  base64: {
    tag: "base64",
    label: "base64 标准订阅",
    clients: "v2rayN、Shadowrocket(小火箭)、NekoBox、Hiddify,以及绝大多数吃「标准订阅」的客户端",
    protocols: ALL_PROTOS,
    contentType: "text/plain; charset=utf-8",
    render: base64Render(ALL_PROTOS),
  },
  v2box: {
    tag: "v2box",
    label: "base64(V2Box 专用)",
    clients: "V2Box",
    protocols: ["vless", "trojan", "vmess", "ss"],
    note: "V2Box 底层是 Xray-core,不支持 anytls,这条链接已把 anytls 节点摘掉。",
    contentType: "text/plain; charset=utf-8",
    render: base64Render(["vless", "trojan", "vmess", "ss"]),
  },
  v2rayn: {
    tag: "v2rayn",
    label: "base64(v2rayN 专用)",
    clients: "v2rayN",
    protocols: ["vless", "trojan", "vmess", "ss"],
    note: "v2rayN 当前版本对 anytls 支持不稳定,这条链接已把 anytls 节点摘掉。",
    contentType: "text/plain; charset=utf-8",
    render: base64Render(["vless", "trojan", "vmess", "ss"]),
  },
  surge: {
    tag: "surge",
    label: "Surge 5",
    clients: "Surge 5(macOS / iOS)",
    protocols: ["trojan", "vmess", "ss"],
    note: "Surge 本身不支持 vless 和 anytls,这两类节点无法出现在这条链接里——所以它的节点数通常远少于其他格式。",
    contentType: "text/plain; charset=utf-8",
    render: toSurgeConf,
  },
  quanx: {
    tag: "quanx",
    label: "Quantumult X",
    clients: "Quantumult X(iOS)",
    protocols: CLASH_LIKE,
    note: "填在 QX 配置的 [server_remote] 里。",
    contentType: "text/plain; charset=utf-8",
    render: toQuanXConf,
  },
  loon: {
    tag: "loon",
    label: "Loon",
    clients: "Loon(iOS)",
    protocols: CLASH_LIKE,
    contentType: "text/plain; charset=utf-8",
    render: toLoonConf,
  },
};

// 设备"默认格式"(不带后缀的那条链接)可选的取值。openclash 是纯别名,不放进选项里。
export const DEFAULT_FORMAT_TAGS = ["clash", "singbox", "base64", "surge", "quanx", "loon"] as const;

// 新建设备时的默认格式。家里绝大多数设备走的是 OpenClash/mihomo 这一路,所以默认给 clash。
export const DEFAULT_FORMAT = "clash";

export function formatOf(tag: string | undefined | null): FormatSpec {
  const t = (tag ?? "").toLowerCase();
  return FORMATS[t] ?? FORMATS[DEFAULT_FORMAT];
}

export function renderFormat(tag: string | undefined | null, nodes: string): Response {
  const spec = formatOf(tag);
  return new Response(spec.render(nodes), { headers: { "content-type": spec.contentType } });
}

// 后台链接列表用:这条链接实际能给到客户端多少个节点。
// 直接按格式支持的协议去数节点池,跟上面各 render 的过滤规则同源,不会出现
// "后台显示 100、客户端只有 12"这种对不上的情况。
export function countFor(spec: FormatSpec, byProto: Record<Proto, number>): number {
  return spec.protocols.reduce((sum, p) => sum + (byProto[p] ?? 0), 0);
}

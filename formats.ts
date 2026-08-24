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
//   - v2rayN **支持** anytls,给它全协议。它带多个内核,anytls 走自带的 sing-box。
//     以前这里写着"支持不稳定"并把 anytls 摘掉,那是没有依据的旧说法,已经改掉。
//   - V2Box **不支持** anytls,给它的链接必须摘掉,否则整份订阅可能导入失败。
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

  // 后台只按"格式"列链接:一种格式一行,写清楚哪些客户端能用。
  // listed=false 的是别名或特例,不单独占一行——要么输出跟别的格式完全一致(openclash、
  // v2rayn),要么是某个格式的特例变体(v2box),挂在 variants 里当附注显示。
  // 它们的链接**依然有效**,已经发出去的旧链接不会失效。
  listed?: boolean;
  variants?: string[];            // 挂在这一行下面的变体后缀
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
    listed: true,
    contentType: "text/yaml; charset=utf-8",
    render: toClashYaml,
  },
  // 老链接兼容:openclash 后缀跟 clash 完全等价,不要删,家里路由器上还在用。
  openclash: {
    tag: "openclash",
    label: "Clash / mihomo(OpenClash 别名)",
    clients: "同 /clash",
    protocols: CLASH_LIKE,
    listed: false,
    contentType: "text/yaml; charset=utf-8",
    render: toClashYaml,
  },
  singbox: {
    tag: "singbox",
    label: "sing-box",
    // Karing 是 sing-box 内核的 Flutter 客户端,虽然它也能读 clash 订阅,但它自己
    // 说明里写的是"完全支持 clash 配置,**部分支持** clash.meta 配置"——我们的 clash
    // 输出用了 anytls / reality / client-fingerprint 这些 meta 特性,所以给 Karing
    // 应该推 sing-box 这条,而不是 clash。
    clients: "sing-box(Windows/macOS/Linux/Android)、SFI / SFM(iOS、macOS)、Karing、Hiddify",
    protocols: CLASH_LIKE,
    listed: true,
    contentType: "application/json; charset=utf-8",
    render: toSingboxJson,
  },
  base64: {
    tag: "base64",
    label: "base64 标准订阅",
    clients: "v2rayN、Shadowrocket(小火箭)、NekoBox、Karing、Hiddify,以及绝大多数吃「标准订阅」的客户端",
    protocols: ALL_PROTOS,
    listed: true,
    variants: ["v2box"],
    contentType: "text/plain; charset=utf-8",
    render: base64Render(ALL_PROTOS),
  },
  // V2Box 不支持 anytls —— 这条是仓库主人实测确认的(2026-08),不是从源码推的:
  // V2Box 是闭源的 iOS/macOS App,翻不了源码。可以佐证的一半是 Xray-core 本身完全没有
  // anytls(XTLS/Xray-core 的 proxy/ 目录下没这个协议,全仓库 grep 零命中)。
  // 注意别把这个理由套到 v2rayN 头上:v2rayN 也用 Xray,但它同时带 sing-box 并按节点
  // 切内核,所以它是支持 anytls 的(见下面 v2rayn 那条)。"底层是 Xray" 推不出
  // "不支持 anytls",两者不能混为一谈。
  //
  // 必须摘掉而不是放着不管:V2Box 解析不了的行会让**整份订阅**导入失败,不是只丢那一条。
  v2box: {
    tag: "v2box",
    label: "base64(V2Box)",
    clients: "V2Box 专用",
    protocols: ["vless", "trojan", "vmess", "ss"],
    note: "V2Box 不支持 anytls(实测确认),给它的必须是这条去掉 anytls 的。别的客户端用上面那条。",
    listed: false,
    contentType: "text/plain; charset=utf-8",
    render: base64Render(["vless", "trojan", "vmess", "ss"]),
  },
  // v2rayN 是**支持** anytls 的,全协议给它就行,不要再摘 anytls 了。
  // 核实过程(2026-08,对着 2dust/v2rayN 仓库 HEAD):
  //   - ServiceLib/Enums/EConfigType.cs         有 Anytls = 11 这个一等公民枚举
  //   - ServiceLib/Handler/Fmt/AnytlsFmt.cs     anytls:// 分享链接的解析/序列化实现
  //   - ServiceLib/Handler/Fmt/FmtHandler.cs    订阅导入时按 scheme 分发到 AnytlsFmt.Resolve
  //   - ServiceLib/Handler/ConfigHandler.cs     AddAnytlsServer() 里写死
  //                                             CoreType = ECoreType.sing_box
  // 最后那条是关键:Xray-core 确实完全不支持 anytls(XTLS/Xray-core 的 proxy/ 目录下
  // 根本没有 anytls,全仓库 grep 零命中),但 v2rayN **带多个内核并按节点绑定**——遇到
  // anytls 它自动切到自带的 sing-box 去跑,用户那头无感。所以"v2rayN 底层是 Xray
  // 所以不支持 anytls"这个推论是错的。源码结论与仓库主人的实际使用一致。
  v2rayn: {
    tag: "v2rayn",
    label: "base64(v2rayN)",
    clients: "同 /base64",
    protocols: ALL_PROTOS,
    listed: false,
    contentType: "text/plain; charset=utf-8",
    render: base64Render(ALL_PROTOS),
  },
  surge: {
    listed: true,
    tag: "surge",
    label: "Surge 5",
    clients: "Surge 5(macOS / iOS)",
    protocols: ["trojan", "vmess", "ss"],
    note: "Surge 本身不支持 vless 和 anytls,这两类节点无法出现在这条链接里——所以它的节点数通常远少于其他格式。",
    contentType: "text/plain; charset=utf-8",
    render: toSurgeConf,
  },
  quanx: {
    listed: true,
    tag: "quanx",
    label: "Quantumult X",
    clients: "Quantumult X(iOS)",
    protocols: CLASH_LIKE,
    note: "填在 QX 配置的 [server_remote] 里。",
    contentType: "text/plain; charset=utf-8",
    render: toQuanXConf,
  },
  loon: {
    listed: true,
    tag: "loon",
    label: "Loon",
    clients: "Loon(iOS)",
    protocols: CLASH_LIKE,
    contentType: "text/plain; charset=utf-8",
    render: toLoonConf,
  },
};

// 后台链接列表按格式列,一种格式一行。别名(openclash / v2rayn)和特例(v2box)不单独占行。
export const LISTED_FORMATS: FormatSpec[] = Object.values(FORMATS).filter((f) => f.listed);

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

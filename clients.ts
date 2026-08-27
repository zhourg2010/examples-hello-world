// clients.ts — 各代理客户端"是什么"的登记表:图标、配色、一句话说明。
//
// 后台的设备 Dock 用它来渲染。存在的理由很直接:看到"FlClash"三个字,不知道它是什么、
// 谁在用、跟别的客户端什么关系。这张表就是回答这个问题的地方。
//
// ## 关于图标:为什么是手绘字标而不是各家真实的 App 图标
//
// 1. 真图标只有开源那几个拿得到(Karing / FlClash / Clash Verge Rev 仓库里有 PNG),
//    Surge、Shadowrocket、Quantumult X、Loon、Stash、V2Box 全是闭源商业 App,没有。
//    一半真 logo 一半占位符,看着比全用字标更糟。
// 2. 闭源那些的 logo 是注册商标,放进一个公开仓库里不合适。
// 3. PNG 转成 data URI 会让 ui.ts 膨胀上百 KB;这里每个字标 200 字节左右。
// 4. Dock 里图标只有 36px,简洁字标比缩小到糊掉的复杂 logo 更容易一眼认出来。
//
// 配色尽量贴近各家品牌色,方便形成肌肉记忆(Clash 系偏蓝紫、sing-box 系偏靛、
// Apple 生态那几个各自的主色),但不是精确取色。

export interface ClientMeta {
  /** 这是什么 —— 时间轴上鼠标悬停时显示的主体 */
  what: string;
  /** 支持哪些平台 */
  platforms: string;
  /** 用的是哪个内核。同一内核的客户端行为相近,这条比"是谁做的"更有用 */
  core?: string;
  /** 开源与否 */
  openSource?: boolean;
  /** 官网或仓库,悬停提示里显示成纯文本(后台页面不放外链,避免点出去) */
  home?: string;
}

// key 必须跟 ua.ts 里 parseUa() 返回的 client 字段完全一致。
export const CLIENTS: Record<string, ClientMeta> = {
  "Clash Verge Rev": {
    what: "Clash 系里目前最主流的桌面客户端,界面现代、功能全。自用的 rClash 就是基于它改的(独立仓库 zhourg2010/rClash)。",
    platforms: "Windows / macOS / Linux",
    core: "mihomo(Clash.Meta)",
    openSource: true,
    home: "github.com/clash-verge-rev/clash-verge-rev",
  },
  "FlClash": {
    what: "基于 ClashMeta 的多平台代理客户端,用 Flutter 写的,开源无广告。特点是同一套界面在手机和桌面上都能跑,自适应屏幕尺寸。",
    platforms: "Android / Windows / macOS / Linux",
    core: "mihomo(Clash.Meta)",
    openSource: true,
    home: "github.com/chen08209/FlClash",
  },
  "Clash for Windows": {
    what: "老牌 Windows/macOS Clash 客户端。原作者已停止维护并删库,现在见到的多是第三方留存版本,建议换成 Clash Verge Rev。",
    platforms: "Windows / macOS / Linux",
    core: "Clash(原版,非 Meta)",
    openSource: false,
  },
  "Clash Meta for Android": {
    what: "Android 上的 Clash.Meta 客户端,mihomo 内核的官方安卓壳。",
    platforms: "Android",
    core: "mihomo(Clash.Meta)",
    openSource: true,
    home: "github.com/MetaCubeX/ClashMetaForAndroid",
  },
  "ClashX": {
    what: "macOS 上的经典 Clash 客户端,菜单栏常驻。ClashX Meta 是它换成 mihomo 内核的分支。",
    platforms: "macOS",
    core: "Clash / mihomo(Meta 版)",
    openSource: true,
  },
  "Stash": {
    what: "iOS/macOS 上的付费代理客户端,能吃 Clash 配置,规则和界面做得比较精致。",
    platforms: "iOS / macOS",
    core: "自研(兼容 Clash 配置)",
    openSource: false,
  },
  "mihomo 内核": {
    what: "Clash.Meta 的正式名字,是个命令行内核而不是图形客户端。看到它说明请求来自路由器上的 OpenClash/直接跑的内核进程,或者某个把 UA 透传出来的壳。",
    platforms: "路由器 / 各平台命令行",
    core: "自身即内核",
    openSource: true,
    home: "github.com/MetaCubeX/mihomo",
  },
  "OpenClash": {
    what: "OpenWrt 路由器上的 Clash 插件。装在路由器上之后全家设备都自动走代理,不用每台单独配。",
    platforms: "OpenWrt 路由器",
    core: "mihomo / Clash",
    openSource: true,
    home: "github.com/vernesong/OpenClash",
  },
  "sing-box (iOS)": {
    what: "sing-box 的 iOS 官方客户端(App Store 里叫 sing-box)。sing-box 是新一代代理内核,协议支持最全,anytls / reality 这些新东西它都有。",
    platforms: "iOS / iPadOS",
    core: "sing-box",
    openSource: true,
    home: "github.com/SagerNet/sing-box",
  },
  "sing-box (Android)": {
    what: "sing-box 的 Android 官方客户端。",
    platforms: "Android",
    core: "sing-box",
    openSource: true,
  },
  "sing-box (macOS)": {
    what: "sing-box 的 macOS 官方客户端。",
    platforms: "macOS",
    core: "sing-box",
    openSource: true,
  },
  "sing-box (tvOS)": {
    what: "sing-box 的 Apple TV 客户端。",
    platforms: "tvOS",
    core: "sing-box",
    openSource: true,
  },
  "sing-box": {
    what: "sing-box 内核本体(命令行)。看到它说明是直接跑的内核进程,不是图形客户端。",
    platforms: "各平台命令行",
    core: "自身即内核",
    openSource: true,
  },
  "Karing": {
    what: "sing-box 内核的 Flutter 图形客户端,平台覆盖最广的一个。它是少数支持发送 X-HWID(硬件标识)的客户端 —— 后台设备列表里那个 # 开头的小标签就是它发来的。",
    platforms: "iOS / Android / Windows / macOS / Linux",
    core: "sing-box(魔改版)",
    openSource: true,
    home: "github.com/KaringX/karing",
  },
  "Shadowrocket 小火箭": {
    what: "iOS 上最老牌的付费代理客户端,俗称小火箭。协议支持广,但不支持 anytls。",
    platforms: "iOS / iPadOS",
    core: "自研",
    openSource: false,
  },
  "Quantumult X": {
    what: "iOS 上的付费代理客户端,以强大的重写/脚本能力著称。订阅要填在配置的 [server_remote] 段里。",
    platforms: "iOS / iPadOS",
    core: "自研",
    openSource: false,
  },
  "Quantumult": {
    what: "Quantumult X 的上一代产品,已经很少用了。",
    platforms: "iOS",
    core: "自研",
    openSource: false,
  },
  "Surge": {
    what: "Apple 平台上功能最强也最贵的网络调试/代理工具。注意它不支持 vless 和 anytls,所以给它的订阅链接节点数会明显少于其他格式。",
    platforms: "iOS / macOS",
    core: "自研",
    openSource: false,
  },
  "Loon": {
    what: "iOS 上的付费代理客户端,定位介于小火箭和 Quantumult X 之间,支持 vless 和 anytls。",
    platforms: "iOS / iPadOS",
    core: "自研",
    openSource: false,
  },
  "V2Box": {
    what: "iOS/Android 上的免费代理客户端。不支持 anytls —— 所以后台给它单独留了一条去掉 anytls 的链接。",
    platforms: "iOS / Android",
    core: "Xray",
    openSource: false,
  },
  "NekoBox": {
    what: "Android 上的开源代理客户端,协议支持很全。",
    platforms: "Android",
    core: "sing-box",
    openSource: true,
  },
  "NekoRay": {
    what: "桌面端的开源代理客户端,NekoBox 的桌面版本。",
    platforms: "Windows / Linux",
    core: "Xray / sing-box",
    openSource: true,
  },
  "Hiddify": {
    what: "跨平台开源代理客户端,主打开箱即用,订阅格式兼容性很好。",
    platforms: "全平台",
    core: "sing-box",
    openSource: true,
  },
  "v2rayNG": {
    what: "Android 上最主流的开源代理客户端,v2rayN 的安卓版。",
    platforms: "Android",
    core: "Xray",
    openSource: true,
  },
  "v2rayN": {
    what: "Windows 上的老牌开源客户端。它带多个内核,遇到 anytls 会自动切到自带的 sing-box,所以全协议都能用。注意它的 User-Agent 是可配置的,默认多半认不出来。",
    platforms: "Windows / macOS / Linux",
    core: "Xray + sing-box(按节点自动切)",
    openSource: true,
    home: "github.com/2dust/v2rayN",
  },
  "PassWall": {
    what: "OpenWrt 路由器上的代理插件,跟 OpenClash 同类。",
    platforms: "OpenWrt 路由器",
    openSource: true,
  },
  "Shadowsocks": {
    what: "Shadowsocks 系客户端。协议本身比较老,现在多作为兼容选项存在。",
    platforms: "各平台",
    openSource: true,
  },
  "curl(命令行)": {
    what: "命令行工具,不是代理客户端。看到它多半是你自己在终端里测这条链接通不通。",
    platforms: "命令行",
    openSource: true,
  },
  "wget(命令行)": {
    what: "命令行工具,同 curl。",
    platforms: "命令行",
    openSource: true,
  },
  "Go 程序": {
    what: "某个 Go 写的程序在拉这条链接,没有更具体的标识。可能是某个内核或脚本。",
    platforms: "—",
  },
  "Python 脚本": {
    what: "某个 Python 脚本在拉这条链接。本仓库 nodepipe/ 下的工具用的就是 Python。",
    platforms: "—",
  },
};

/** 浏览器直接打开的情况,parseUa 返回的 client 形如 "Chrome(直接打开)" */
const BROWSER_META: ClientMeta = {
  what: "有人用浏览器直接打开了这条订阅链接,不是代理客户端在拉取。多半是自己在检查链接是否正常。",
  platforms: "浏览器",
};

const UNKNOWN_META: ClientMeta = {
  what: "这个客户端还没被识别。把它的 User-Agent(鼠标停在图标上能看到)加进 ua.ts 的规则表,再在 clients.ts 里补一条说明,就能认出来了。",
  platforms: "未知",
};

export function metaOf(client: string): ClientMeta {
  if (!client) return UNKNOWN_META;
  if (CLIENTS[client]) return CLIENTS[client];
  if (client.includes("直接打开")) return BROWSER_META;
  return UNKNOWN_META;
}

// ua.ts — 把订阅请求的 User-Agent 认成"哪个客户端"。
//
// 先说清楚这东西的**边界**,免得后台那个"最近访问的设备"列表被当成它不是的东西:
//
//   订阅接口是个普通 HTTP GET,客户端不带 cookie,也不带任何设备标识。整个请求里
//   能拿到的只有三样:User-Agent、IP、时间。所以这里认出来的是**客户端类型**,
//   不是设备身份 —— 家里两台 iPhone 都装 Shadowrocket,在这儿长得一模一样。
//   要区分具体的人/设备,靠的是订阅链接本身不同(每台设备一个用户名+id),不是靠 UA。
//
// 表里的匹配规则分两类,注释里标清楚了:
//   [源码核实]  去客户端仓库里翻到过实际发送的 UA 字符串
//   [常见取值]  社区里普遍见到的写法,没有从源码核实过 —— 可能不准,也可能漏
//
// 认不出来的不会被丢掉:UI 上照样显示原始 UA,并标成"未识别"。看到经常出现的未识别
// UA,把它加进下面的表就行,加一行的事。

export interface UaInfo {
  /** 客户端名字,认不出来时是空串 */
  client: string;
  /** 版本号,认不出来或 UA 里没带就是空串 */
  version: string;
  /** 大致平台(桌面/移动/路由器),纯属参考,很多 UA 里根本没这信息 */
  platform: string;
  /** 是否命中了下面的表 */
  known: boolean;
  /** 原始 UA,原样保留 */
  raw: string;
}

interface Rule {
  /** 匹配到就算命中。用正则是因为多数客户端的 UA 形如 "名字/版本" */
  re: RegExp;
  client: string;
  platform?: string;
  /** 版本取正则的第几个捕获组,不填就是第 1 组 */
  verGroup?: number;
}

// 顺序有意义:从上往下匹配,第一个命中的赢。
// 所以更具体的规则要放在更宽泛的前面(比如 ClashforWindows 必须排在 Clash 前面,
// 否则会被 /Clash/ 抢先匹配掉)。
const RULES: Rule[] = [
  // [源码核实] clash-verge/v2.5.4
  //   src-tauri/src/utils/network.rs 里:format!("clash-verge/v{}", CARGO_PKG_VERSION)
  { re: /clash-verge\/v?([\d.]+)/i, client: "Clash Verge Rev", platform: "桌面" },

  // 以下均为 [常见取值],没有从源码逐个核实。不准的话改这里。
  { re: /ClashforWindows\/([\d.]+)/i, client: "Clash for Windows", platform: "桌面" },
  { re: /ClashMetaForAndroid\/?([\d.]*)/i, client: "Clash Meta for Android", platform: "移动" },
  { re: /ClashX[^/]*\/?([\d.]*)/i, client: "ClashX", platform: "桌面" },
  { re: /FlClash\/?([\d.]*)/i, client: "FlClash", platform: "桌面/移动" },
  { re: /Stash\/([\d.]+)/i, client: "Stash", platform: "移动" },
  { re: /mihomo\/v?([\d.]+)/i, client: "mihomo 内核", platform: "路由器/桌面" },
  { re: /OpenClash\/?([\d.]*)/i, client: "OpenClash", platform: "路由器" },

  // sing-box 一家。SFI=iOS,SFA=Android,SFM=macOS,SFT=tvOS
  { re: /SFI\/([\d.]+)/i, client: "sing-box (iOS)", platform: "移动" },
  { re: /SFA\/([\d.]+)/i, client: "sing-box (Android)", platform: "移动" },
  { re: /SFM\/([\d.]+)/i, client: "sing-box (macOS)", platform: "桌面" },
  { re: /SFT\/([\d.]+)/i, client: "sing-box (tvOS)", platform: "电视" },
  { re: /sing-box[ /]v?([\d.]+)/i, client: "sing-box", platform: "桌面" },

  { re: /Karing\/?v?([\d.]*)/i, client: "Karing", platform: "移动/桌面" },
  { re: /Shadowrocket\/?([\d.]*)/i, client: "Shadowrocket 小火箭", platform: "移动" },
  { re: /Quantumult(?:%20| )?X\/?([\d.]*)/i, client: "Quantumult X", platform: "移动" },
  { re: /Quantumult\/?([\d.]*)/i, client: "Quantumult", platform: "移动" },
  { re: /Surge[^/]*\/([\d.]+)/i, client: "Surge", platform: "移动/桌面" },
  { re: /Loon\/?([\d.]*)/i, client: "Loon", platform: "移动" },
  { re: /V2Box\/?([\d.]*)/i, client: "V2Box", platform: "移动" },
  { re: /NekoBox\/?([\d.]*)/i, client: "NekoBox", platform: "移动" },
  { re: /Nekoray\/?([\d.]*)/i, client: "NekoRay", platform: "桌面" },
  { re: /Hiddify[^/]*\/?([\d.]*)/i, client: "Hiddify", platform: "移动/桌面" },
  { re: /v2rayNG\/?([\d.]*)/i, client: "v2rayNG", platform: "移动" },
  // v2rayN 的 UA 是**可配置**的(源码里的候选是 chrome/firefox/edge/curl/golang),
  // 所以默认情况下它多半**认不出来**,只有用户手动填了才会带 v2rayN 字样。
  { re: /v2rayN\/?([\d.]*)/i, client: "v2rayN", platform: "桌面" },
  { re: /Passwall\/?([\d.]*)/i, client: "PassWall", platform: "路由器" },
  { re: /ShadowsocksR?[- ]?(?:Android|Windows)?\/?([\d.]*)/i, client: "Shadowsocks", platform: "" },

  // 通用工具:多半是你自己在命令行测,或者某个客户端把 UA 设成了这些
  { re: /^curl\/([\d.]+)/i, client: "curl(命令行)", platform: "" },
  { re: /^Wget\/([\d.]+)/i, client: "wget(命令行)", platform: "" },
  { re: /^Go-http-client\/([\d.]+)/i, client: "Go 程序", platform: "" },
  { re: /^Python-urllib\/([\d.]+)/i, client: "Python 脚本", platform: "" },
];

export function parseUa(raw: string): UaInfo {
  const ua = (raw ?? "").trim();
  if (!ua || ua === "?") {
    // 有些客户端确实一个 UA 都不发。这不是异常,如实标出来即可。
    return { client: "", version: "", platform: "", known: false, raw: ua };
  }

  for (const r of RULES) {
    const m = r.re.exec(ua);
    if (m) {
      return {
        client: r.client,
        version: (m[r.verGroup ?? 1] ?? "").trim(),
        platform: r.platform ?? "",
        known: true,
        raw: ua,
      };
    }
  }

  // 浏览器 UA 单独说一句:说明有人直接用浏览器打开了订阅链接。
  // 不是客户端在拉订阅,值得区分出来。
  if (/Mozilla\/5\.0/.test(ua)) {
    const browser = /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
      ? "Safari"
      : /Firefox\//.test(ua)
      ? "Firefox"
      : "浏览器";
    return { client: `${browser}(直接打开)`, version: "", platform: "", known: true, raw: ua };
  }

  return { client: "", version: "", platform: "", known: false, raw: ua };
}

/** 给 UI 用的一行短描述,比如 "Clash Verge Rev 2.5.4 · 桌面"。认不出来就返回空串。 */
export function describeUa(raw: string): string {
  const i = parseUa(raw);
  if (!i.known) return "";
  const parts = [i.client];
  if (i.version) parts.push(i.version);
  return i.platform ? `${parts.join(" ")} · ${i.platform}` : parts.join(" ");
}

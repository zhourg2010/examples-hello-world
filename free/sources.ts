// free/sources.ts — 免费节点源登记表。加源只动这个文件。
//
// 源分三类(kind):
//   clash   URL 直接返回 Clash 配置(整份配置或裸 proxies 列表都行)
//   base64  URL 返回一整段 base64 的分享链接列表(v2rayN 那种"标准订阅")
//   index   URL 返回的是一个**索引页**(README / HTML),里面列着一堆真正的节点文件地址。
//           先抓索引页,用 pick 正则挑出要的链接,再按 itemKind 逐个抓。
//           用户说的"有的页面可能需要分析"就是这一类。
//
// verified 字段是我在开发沙箱里**实际抓下来并解析成功**过的标记:
//   true   抓通了,解析出的节点数记在 note 里
//   false  沙箱的出网策略挡住了(只放行 raw.githubusercontent.com 之类),代码路径按同类
//          源写好了,但没跑通过真实响应。部署到 Deno Deploy / 本机上出网不受限,应该能work,
//          第一次跑完看 /free 面板上这个源的计数就知道了。
// 不把没验证过的偷偷标成验证过 —— 这两种情况在排障时的意义完全不同。

export type SourceKind = "clash" | "base64" | "index";

export interface Source {
  id: string;
  label: string;
  url: string;
  kind: SourceKind;
  /** index 专用:从索引页文本里挑链接的正则,第 1 个捕获组是 URL */
  pick?: RegExp;
  /** index 专用:挑出来的链接按什么格式解析 */
  itemKind?: "clash" | "base64";
  /** index 专用:最多抓几个文件。索引页动辄列几百个文件,不设上限一轮能跑到天荒地老 */
  maxFiles?: number;
  /** 是否默认启用。留 false 的是"登记在册但先不跑"的源 */
  enabled: boolean;
  verified: boolean;
  note: string;
}

// 单个响应的大小上限。聚合源里有 2MB 的文件是常态,但也见过把整个仓库打包塞进来的,
// 留 8MB 的余量,超了就当这个源坏了 —— 免得一个源把整轮抓取的内存和时间吃光。
export const MAX_BYTES = 8 * 1024 * 1024;
/** 单个请求超时。免费源的可用性本来就飘,卡住的直接放弃,不要拖累整轮。 */
export const FETCH_TIMEOUT_MS = 20_000;

export const SOURCES: Source[] = [
  {
    id: "au1rxx-us",
    label: "Au1rxx / free-vpn-subscriptions(美国分组)",
    url: "https://raw.githubusercontent.com/Au1rxx/free-vpn-subscriptions/main/output/by-country/clash-US.yaml",
    kind: "clash",
    enabled: true,
    verified: true,
    // 这个源对我们最有价值:它自己就按国家分好了文件,拿到手已经全是美国节点。
    // 注意"它说是美国"只是个预筛,本地那道严格 GeoIP 该怎么验还是怎么验 —— 免费源的
    // 国家标注比机场的还随意,不能当判据。
    note: "沙箱实测:648 个节点,转成 URI 609 个(39 个 hysteria2 暂不支持)。已按国家预分组。",
  },
  {
    id: "au1rxx-all",
    label: "Au1rxx / free-vpn-subscriptions(全量)",
    url: "https://raw.githubusercontent.com/Au1rxx/free-vpn-subscriptions/main/output/clash.yaml",
    kind: "clash",
    enabled: false,
    verified: false,
    note: "全量池,上面那条已经是它的美国子集。想扩大候选面时再打开。",
  },
  {
    id: "zhuhai",
    label: "zhuhaiuk / free-nodes",
    url: "https://raw.githubusercontent.com/zhuhaiuk/free-nodes/main/clash_config.yaml",
    kind: "clash",
    enabled: true,
    verified: true,
    note: "沙箱实测:43 个节点(其中 17 个是 http 代理,不在支持协议里)。",
  },
  {
    id: "dongtai",
    label: "wenxig / dongtai-sub",
    url: "https://raw.githubusercontent.com/wenxig/dongtai-sub/refs/heads/main/data/sub.yaml",
    kind: "clash",
    enabled: true,
    verified: true,
    note: "沙箱实测:2 个节点。源本身就很小。",
  },
  {
    id: "wenxig-free",
    label: "wenxig / free-nodes-sub",
    // 注意:是 sub.yaml 不是 sub.yml。给的链接写的 .yml,实测 404,.yaml 才是 200。
    url: "https://raw.githubusercontent.com/wenxig/free-nodes-sub/main/data/sub.yaml",
    kind: "clash",
    enabled: true,
    verified: true,
    note: "沙箱实测 200。原始给的 .yml 是 404,已改成 .yaml。",
  },
  {
    id: "v2rayfree",
    label: "free-nodes / v2rayfree",
    url: "https://raw.githubusercontent.com/free-nodes/v2rayfree/main/sub",
    kind: "base64",
    enabled: true,
    verified: true,
    note: "沙箱实测:663KB base64,解析出 1670 个(ss 417 / vless 673 / vmess 573 / trojan 7)。",
  },
  {
    id: "barabama",
    label: "Barabama / FreeNodes(索引页)",
    url: "https://raw.githubusercontent.com/Barabama/FreeNodes/main/README.md",
    kind: "index",
    // 只要 raw.githubusercontent.com 上的 .yaml,不要 gh-proxy.com 那份镜像(同样的内容,
    // 多抓一遍纯属浪费),也不要 .txt(同一批节点的另一种格式,会整批重复)。
    pick: /(https:\/\/raw\.githubusercontent\.com\/Barabama\/FreeNodes\/[^)"'\s]+\.yaml)/g,
    itemKind: "clash",
    maxFiles: 10,
    enabled: true,
    verified: true,
    note: "沙箱实测:索引页列出 8 个 .yaml;抽查 nodefree.yaml 解析出 23 个节点。每日 12 点更新。",
  },
  {
    id: "sub-config-extractor",
    label: "asgharkapk / Sub-Config-Extractor(索引页)",
    url: "https://raw.githubusercontent.com/asgharkapk/Sub-Config-Extractor/main/README.md",
    pick:
      /(https:\/\/raw\.githubusercontent\.com\/asgharkapk\/Sub-Config-Extractor\/[^)"'\s]*output_configs\/clash\/[^)"'\s]+)/g,
    kind: "index",
    itemKind: "clash",
    // 索引页列了 592 个文件(其中 clash 目录 156 个),单个能到 2MB。全抓没有意义:
    // 实测其中一个 6037 个节点的文件里,6000 个 vmess 背后只有 4 套凭据(见 identity.ts),
    // 抓再多也是同样的东西。取前几个够了。
    maxFiles: 5,
    enabled: true,
    verified: true,
    note: "沙箱实测:索引页 156 个 clash 文件;抽查一个 2MB 的解析出 6037 个,但去重后只剩 4 套凭据。",
  },
  {
    id: "udptoos",
    label: "nodes.udptoos.com",
    url: "https://nodes.udptoos.com/subscriptions/clash.yaml",
    kind: "clash",
    enabled: true,
    // 地址是用户确认过的(他那边能打开)。这里仍标 false,因为 verified 说的是**我实际抓到
    // 并解析成功过**——开发沙箱的出网策略只放行 raw.githubusercontent.com 一类的域名,
    // 这个域名一直是 CONNECT 403,所以它返回的**内容长什么样**我没见过,不知道解析器认不认。
    // 地址对不对和格式认不认是两件事,不能因为前者成立就把后者也标成验证过。
    verified: false,
    note: "地址已由用户确认可用;沙箱出网被挡,没见过真实响应,格式是否能解析未知。" +
      "部署后第一轮看面板:出 0 条会红着报错(不会绿着显示 0),照着错误信息调即可。",
  },
  {
    id: "v2cross",
    label: "v2cross.com(索引页)",
    url: "https://v2cross.com/",
    kind: "index",
    // 这是个博客首页,节点藏在文章里。这条正则捞的是页面上出现的订阅/节点文件链接;
    // 没跑通过真实页面,选择器八成要按实际结构再调 —— 所以默认关着,别让它拖慢每轮抓取。
    pick: /(https?:\/\/[^\s"'<>)]+\.(?:ya?ml|txt)(?:\?[^\s"'<>)]*)?)/g,
    itemKind: "clash",
    maxFiles: 5,
    enabled: false,
    verified: false,
    note: "博客首页,节点在文章里。沙箱出网被挡(CONNECT 403),正则没在真实页面上验过,先默认关闭。",
  },
];

export function enabledSources(): Source[] {
  return SOURCES.filter((s) => s.enabled);
}

export function sourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}

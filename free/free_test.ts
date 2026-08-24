// free/free_test.ts — 免费节点抓取链路的测试。
// 跑: deno test free/free_test.ts
//
// 用例大多来自开发过程中真实踩到的坑,不是照着函数签名补出来的:
//   - IPv6 未加引号(真实源里的写法,按第一个冒号切会全解析错)
//   - vmess 分享链接不能带 #fragment(带了 62 个 vmess 一个都活不下来)
//   - CF 扇出(6000 条背后 4 套凭据)—— 去重口径不对的话整个池子就废了

import { parseClashProxies } from "./parse.ts";
import { credentialId, endpointId, isJunk } from "./identity.ts";
import { normalizeType, toUri } from "./uri.ts";
import { FREE_PREFIX, isFreeName, withFreePrefix } from "./naming.ts";
import { parseNodes } from "../singbox.ts";

function assertEq(got: unknown, want: unknown, msg: string) {
  if (got !== want) throw new Error(`${msg}\n  期望: ${want}\n  实际: ${got}`);
}

// ---------------------------------------------------------------- 解析

Deno.test("块状 YAML:能从整份配置里只捞出 proxies,不把 proxy-groups 捞进来", () => {
  const y = `
mixed-port: 7890
proxies:
  - name: A
    type: ss
    server: 1.2.3.4
    port: 8388
    cipher: aes-256-gcm
    password: pw
  - name: B
    type: vless
    server: example.com
    port: 443
    uuid: u-1
proxy-groups:
  - name: 节点选择
    type: select
    proxies: [A, B]
`;
  const r = parseClashProxies(y);
  assertEq(r.proxies.length, 2, "只应捞出 2 个节点");
  assertEq(r.proxies[0].name, "A", "第一个");
  assertEq(r.proxies[1].type, "vless", "第二个的协议");
});

Deno.test("一行 flow 版式:整份配置写成一个 {} 也要能捞出 proxies", () => {
  const y = `{port: 7890,mode: rule,proxies: [{name: "X",server: 1.1.1.1,port: 443,type: trojan,password: pw}],proxy-groups: [{name: G,type: select}]}`;
  const r = parseClashProxies(y);
  assertEq(r.proxies.length, 1, "1 个节点");
  assertEq(r.proxies[0].password, "pw", "密码");
});

Deno.test("未加引号的 IPv6 地址必须解析对(按第一个冒号切会全错)", () => {
  // 这是真实源里的写法。YAML flow 里 `:` 只有后面跟空白时才是分隔符,
  // 所以 2001:bc8:32d7:1a9::2 整个是一个标量。
  const y = `{proxies: [{name: "v6",server: 2001:bc8:32d7:1a9::2,port: 23388,type: vmess,uuid: abc}]}`;
  const r = parseClashProxies(y);
  assertEq(r.proxies.length, 1, "应解析出 1 个");
  assertEq(r.proxies[0].server, "2001:bc8:32d7:1a9::2", "IPv6 地址完整");
  assertEq(r.proxies[0].port, 23388, "端口是端口,不是 IPv6 的一段");
});

Deno.test("嵌套的 ws-opts / headers 不被顶层逗号切坏", () => {
  const y =
    `{proxies: [{name: n,server: a.com,port: 443,type: vmess,uuid: u,network: ws,ws-opts: {path: /p,headers: {Host: h.com}}}]}`;
  const p = parseClashProxies(y).proxies[0];
  const ws = p["ws-opts"] as Record<string, unknown>;
  assertEq(ws.path, "/p", "path");
  assertEq((ws.headers as Record<string, unknown>).Host, "h.com", "Host 头");
});

Deno.test("值里含斜杠和点的未加引号标量原样保留", () => {
  const y = `{proxies: [{name: n,server: a.com,port: 1,type: ss,cipher: aes-256-gcm,password: github.com/Alvin9999/x}]}`;
  assertEq(parseClashProxies(y).proxies[0].password, "github.com/Alvin9999/x", "密码里的斜杠");
});

Deno.test("裸列表(整份文件就是 - {...})也要认", () => {
  const y = `- {name: n,server: a.com,port: 1,type: trojan,password: p}\n- {name: m,server: b.com,port: 2,type: trojan,password: q}`;
  assertEq(parseClashProxies(y).proxies.length, 2, "2 个");
});

Deno.test("缺 server/port/type 的条目被跳过并计数,不静默丢", () => {
  const y = `{proxies: [{name: ok,server: a.com,port: 1,type: ss,cipher: c,password: p},{name: 没有server,port: 1,type: ss}]}`;
  const r = parseClashProxies(y);
  assertEq(r.proxies.length, 1, "只留 1 个");
  assertEq(r.skipped, 1, "跳过数要记下来");
});

// ---------------------------------------------------------------- 垃圾过滤

Deno.test("isJunk:占位符/私有地址/代理组能认出来", () => {
  // 聚合源第一条永远是这个占位符
  assertEq(!!isJunk({ name: "测试节点", server: "a", port: 1, type: "trojan" }), true, "server 是单字母");
  assertEq(!!isJunk({ server: "127.0.0.1", port: 8080, type: "ss" }), true, "本地地址");
  assertEq(!!isJunk({ server: "192.168.1.1", port: 8080, type: "ss" }), true, "私有地址");
  assertEq(!!isJunk({ server: "172.16.0.1", port: 8080, type: "ss" }), true, "172.16 私有段");
  assertEq(!!isJunk({ server: "a.com", port: 70000, type: "ss" }), true, "端口越界");
  assertEq(!!isJunk({ name: "G", server: "x", port: 1, type: "select" }), true, "代理组");
  // 正常节点不能被误伤
  assertEq(isJunk({ server: "1.2.3.4", port: 443, type: "vless" }), null, "正常 IPv4");
  assertEq(isJunk({ server: "a.example.com", port: 443, type: "vless" }), null, "正常域名");
  assertEq(isJunk({ server: "2001:bc8::2", port: 443, type: "vmess" }), null, "正常 IPv6");
  // 172.32 不在私有段里,不能一起误杀
  assertEq(isJunk({ server: "172.32.0.1", port: 443, type: "vless" }), null, "172.32 是公网");
});

// ---------------------------------------------------------------- 去重口径

Deno.test("credentialId:CDN 前置时,不同边缘 IP 算同一套凭据", () => {
  // 真实数据:同一个 uuid + 同一个 Host,套在一千多个 Cloudflare 边缘 IP 上。
  // 按 endpoint 去重一条都去不掉,按 credential 才能收敛成一条。
  const mk = (server: string) => ({
    type: "vmess",
    server,
    port: 2086,
    uuid: "7d92ffc9-02e1-4087-8a46-cc4d76560917",
    servername: "m116.164748.xyz",
    network: "ws",
    "ws-opts": { path: "/gh", headers: { Host: "m116.164748.xyz" } },
  });
  const a = mk("104.18.114.1"), b = mk("104.21.238.8");
  assertEq(credentialId(a) === credentialId(b), true, "同一套凭据");
  assertEq(endpointId(a) === endpointId(b), false, "但 endpoint 不同 —— 所以只按 endpoint 去重是不够的");
});

Deno.test("credentialId:同一台机器上不同账号要算不同的服务", () => {
  const base = { type: "vless", server: "1.2.3.4", port: 443, servername: "a.com" };
  assertEq(
    credentialId({ ...base, uuid: "u1" }) === credentialId({ ...base, uuid: "u2" }),
    false,
    "uuid 不同就是不同的服务",
  );
});

// ---------------------------------------------------------------- 转 URI

Deno.test("vmess 分享链接不能带 #fragment(带了整条解析不出来)", () => {
  const uri = toUri({
    name: "测试 vmess",
    type: "vmess",
    server: "1.2.3.4",
    port: 443,
    uuid: "11111111-2222-3333-4444-555555555555",
    cipher: "auto",
  });
  assertEq(uri.includes("#"), false, "vmess 链接里不该有 #");
  // 真正的判据:仓库自己的解析器认不认
  const back = parseNodes(uri);
  assertEq(back.length, 1, "parseNodes 要能认出来");
  assertEq(back[0].server, "1.2.3.4", "server 不走样");
  assertEq(back[0].tag, "测试 vmess", "名字从 JSON 的 ps 字段里还原");
});

Deno.test("五种协议转出来的 URI 都能被仓库自己的解析器读回去", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["vless", { type: "vless", name: "v", server: "a.com", port: 443, uuid: "u-1", tls: true, servername: "a.com" }],
    ["trojan", { type: "trojan", name: "t", server: "b.com", port: 443, password: "pw" }],
    ["anytls", { type: "anytls", name: "y", server: "c.com", port: 443, password: "pw" }],
    ["vmess", { type: "vmess", name: "m", server: "d.com", port: 443, uuid: "u-2" }],
    ["ss", { type: "ss", name: "s", server: "e.com", port: 8388, cipher: "aes-256-gcm", password: "pw" }],
  ];
  for (const [label, p] of cases) {
    const uri = toUri(p);
    if (!uri) throw new Error(`${label} 没转出 URI`);
    const back = parseNodes(uri);
    assertEq(back.length, 1, `${label} 应能被 parseNodes 读回`);
    assertEq(back[0].server, p.server, `${label} 的 server`);
    assertEq(Number(back[0].server_port), Number(p.port), `${label} 的端口`);
  }
});

Deno.test("节点名里的中文和特殊字符不能把 URI 弄坏", () => {
  const uri = toUri({ type: "trojan", name: "美国 洛杉矶 #01 | 测试", server: "a.com", port: 443, password: "p w/d" });
  const back = parseNodes(uri);
  assertEq(back.length, 1, "应能读回");
  assertEq(back[0].tag, "美国 洛杉矶 #01 | 测试", "名字原样还原(含 # 和 |)");
  assertEq((back[0] as { password?: string }).password, "p w/d", "密码里的空格和斜杠");
});

Deno.test("不支持的协议返回空串,由调用方计数(不是静默丢)", () => {
  assertEq(normalizeType("hysteria2"), "", "hysteria2 暂不支持");
  assertEq(normalizeType("tuic"), "", "tuic 暂不支持");
  assertEq(normalizeType("http"), "", "http 代理不在范围里");
  assertEq(normalizeType("shadowsocks"), "ss", "全称要归一成 ss");
  assertEq(toUri({ type: "hysteria2", server: "a.com", port: 443, password: "p" }), "", "转不出来");
});

Deno.test("缺关键字段时返回空串而不是拼出一条坏链接", () => {
  assertEq(toUri({ type: "vless", server: "a.com", port: 443 }), "", "vless 缺 uuid");
  assertEq(toUri({ type: "ss", server: "a.com", port: 443, password: "p" }), "", "ss 缺 cipher");
});

// ---------------------------------------------------------------- FREE 前缀

Deno.test("FREE 前导词:加得上、幂等、认得出", () => {
  assertEq(withFreePrefix("美国 01"), `${FREE_PREFIX} | 美国 01`, "正常加前缀");
  assertEq(withFreePrefix(withFreePrefix("美国 01")), `${FREE_PREFIX} | 美国 01`, "重复加不会叠");
  assertEq(withFreePrefix(""), FREE_PREFIX, "空名字就只有前缀");
  assertEq(isFreeName(`${FREE_PREFIX} | 美国 01`), true, "认得出");
  assertEq(isFreeName("FREEDOM 机场"), false, "不能把 FREEDOM 误认成 FREE");
  assertEq(isFreeName("美国 01"), false, "普通节点");
});

Deno.test("FREE 前缀能穿过 URI 往返(名字在客户端里看得到)", () => {
  const p = { type: "trojan", name: withFreePrefix("洛杉矶 01"), server: "a.com", port: 443, password: "pw" };
  const back = parseNodes(toUri(p));
  assertEq(back[0].tag, `${FREE_PREFIX} | 洛杉矶 01`, "前缀跟着节点走到解析后");
  assertEq(isFreeName(back[0].tag), true, "还认得出是免费节点");
});

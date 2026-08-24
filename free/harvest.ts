// free/harvest.ts — 抓一轮免费节点:拉取 → 解析 → 转 URI → 去重 → 落库。
//
// 一轮的产出是一份"战报"(HarvestReport),每个源单独一行,成功失败都留痕。免费源随时会
// 坏(仓库删了、路径改了、被限流),所以这里的原则是**一个源坏掉不影响其它源**:每个源
// 单独 try,失败记进报告继续下一个,绝不让整轮抛出去。

import { parseClashProxies, type Proxy } from "./parse.ts";
import { credentialId, endpointId, isJunk } from "./identity.ts";
import { normalizeType, toUri } from "./uri.ts";
import { withFreePrefix } from "./naming.ts";
import { parseNodes } from "../singbox.ts";
import {
  enabledSources,
  FETCH_TIMEOUT_MS,
  MAX_BYTES,
  type Source,
} from "./sources.ts";
import { type FreeNode, hashUri, recordHarvest, upsertNodes } from "./store.ts";

/**
 * 每套凭据最多入库几条。见下面 harvestAll 里那段说明 —— 这个常量决定了免费池是
 * "一千多个不同的服务"还是"同一台机器的四千个入口 IP"。
 */
export const PER_CRED_CAP = 3;

/**
 * 单个源最多入库几条。跟 PER_CRED_CAP 是同一个道理,只是高了一层:限了凭据之后,
 * 聚合源 Sub-Config-Extractor 一家还是占了整池的 89%(17034 / 19149)—— 它一个源就把
 * 别的源全淹了,后面按 seen_count 排序取一批出来,取到的几乎全是它的。
 * 免费源之间是互相抄的关系,谁抄得多不代表谁的质量好,不该让"抄得多"直接换成"占坑多"。
 */
export const PER_SOURCE_CAP = 2000;

export interface SourceReport {
  id: string;
  label: string;
  ok: boolean;
  /** 从这个源解析出来的原始条目数 */
  parsed: number;
  /** 转成 URI 且通过去重后,真正入库的条目数 */
  kept: number;
  /** 按协议统计的丢弃数(hysteria2/tuic 这些暂不支持的会出现在这里) */
  dropped: Record<string, number>;
  /** index 类型的源实际抓了几个子文件 */
  files?: number;
  err: string;
}

export interface HarvestReport {
  startedAt: string;
  sources: SourceReport[];
  /** 全部源合起来、跨源去重之后的入库条数 */
  totalKept: number;
  stored: boolean;
}

/** 带超时和大小上限的抓取。免费源什么妖怪都有,这两道闸必须有。 */
async function fetchText(url: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "user-agent": "nodes-sub-free-harvester/1.0" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(`响应 ${(buf.byteLength / 1048576).toFixed(1)}MB,超过 ${MAX_BYTES / 1048576}MB 上限`);
    }
    const text = new TextDecoder().decode(buf);
    // 非 GitHub 的源最常见的坏法不是 404,而是**200 返回一个 HTML 页面**:Cloudflare 的
    // 人机校验、登录墙、或者把 404 页面当 200 发。这种响应喂给解析器只会得到"0 个节点",
    // 看起来跟"这个源今天没货"一模一样。这里提前认出来,报一个说得清的错。
    const head = text.slice(0, 400).trimStart().toLowerCase();
    if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<head>")) {
      throw new Error("拿到的是 HTML 页面而不是节点文件(可能是登录墙 / Cloudflare 校验 / 404 当 200 发)");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把 base64 订阅解析成 proxy 记录。
 *
 * 这里复用 singbox.ts 的 parseNodes(仓库里已有的那份分享链接解析器),再把它产出的
 * sing-box outbound 映射回 Clash 字段名 —— 因为下游的 toUri 吃的是 Clash 形状。
 * 绕这一圈是有意的:分享链接的解析规则(vmess 的 base64 JSON、ss 的 SIP002 两种写法……)
 * 只维护那一份,不在这里再写一遍。
 */
function proxiesFromBase64(text: string): Proxy[] {
  // deno-lint-ignore no-explicit-any
  return parseNodes(text).map((o: any) => {
    const p: Proxy = {
      name: o.tag,
      type: o.type === "shadowsocks" ? "ss" : o.type,
      server: o.server,
      port: o.server_port,
    };
    if (o.uuid) p.uuid = o.uuid;
    if (o.password) p.password = o.password;
    if (o.method) p.cipher = o.method;
    if (o.security) p.cipher = o.security;
    if (o.alter_id !== undefined) p.alterId = o.alter_id;
    if (o.flow) p.flow = o.flow;
    if (o.tls?.enabled) {
      p.tls = true;
      if (o.tls.server_name) p.servername = o.tls.server_name;
      if (o.tls.utls?.fingerprint) p["client-fingerprint"] = o.tls.utls.fingerprint;
      if (o.tls.reality?.public_key) {
        p["reality-opts"] = {
          "public-key": o.tls.reality.public_key,
          "short-id": o.tls.reality.short_id ?? "",
        };
      }
    }
    const t = o.transport;
    if (t?.type === "ws") {
      p.network = "ws";
      p["ws-opts"] = { path: t.path ?? "/", headers: { Host: t.headers?.Host?.[0] ?? "" } };
    } else if (t?.type === "grpc") {
      p.network = "grpc";
      p["grpc-opts"] = { "grpc-service-name": t.service_name ?? "" };
    }
    return p;
  });
}

function parseByKind(kind: "clash" | "base64", text: string): Proxy[] {
  return kind === "base64" ? proxiesFromBase64(text) : parseClashProxies(text).proxies;
}

/** 从索引页文本里挑出子文件地址。去重 + 截断到 maxFiles。 */
function pickLinks(text: string, src: Source): string[] {
  if (!src.pick) return [];
  const out = new Set<string>();
  // 正则带 /g,每次用之前把 lastIndex 归零 —— 正则字面量在模块级是共享的,
  // 不重置的话第二次调用会从上次的位置接着找,漏掉前面的链接。
  src.pick.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = src.pick.exec(text)) !== null) {
    out.add(m[1]);
    if (out.size >= (src.maxFiles ?? 10)) break;
  }
  return [...out];
}

async function harvestOne(src: Source): Promise<{ report: SourceReport; nodes: FreeNode[] }> {
  const report: SourceReport = {
    id: src.id,
    label: src.label,
    ok: false,
    parsed: 0,
    kept: 0,
    dropped: {},
    err: "",
  };
  const nodes: FreeNode[] = [];
  const bump = (k: string) => report.dropped[k] = (report.dropped[k] ?? 0) + 1;

  try {
    let raw: Proxy[] = [];
    if (src.kind === "index") {
      const idx = await fetchText(src.url);
      const links = pickLinks(idx, src);
      report.files = links.length;
      if (links.length === 0) throw new Error("索引页里没匹配到任何子文件链接(pick 正则可能要调)");
      for (const link of links) {
        try {
          raw = raw.concat(parseByKind(src.itemKind ?? "clash", await fetchText(link)));
        } catch (e) {
          // 单个子文件坏掉不影响这个源的其它子文件
          bump(`子文件失败(${e instanceof Error ? e.message : String(e)})`);
        }
      }
    } else {
      raw = parseByKind(src.kind, await fetchText(src.url));
    }

    report.parsed = raw.length;
    // 抓到了内容却一个节点都没解析出来,几乎一定是这个源的格式变了(或者 pick 正则/kind
    // 配错了),而不是"今天恰好没货"。判成失败,面板上才会红着提醒;否则它会绿着显示 0,
    // 跟正常但空的源长得一样,坏了几个月都不会有人发现。
    if (raw.length === 0) {
      throw new Error(`抓到了内容,但一个节点都没解析出来 —— 这个源的格式可能变了(kind=${src.kind})`);
    }

    const seen = new Set<string>();
    for (const p of raw) {
      const junk = isJunk(p);
      if (junk) { bump(junk.replace(/\(.*/, "")); continue; }
      const t = normalizeType(p.type);
      // 暂不支持的协议(hysteria2 / tuic / hysteria / http)在这里被记下来。
      // 想知道"放开这些能多拿多少节点"的时候,看战报里的这几项就有数了。
      if (!t) { bump(`协议未支持:${String(p.type)}`); continue; }
      // FREE 前导词在这里打进节点名,之后跟着 URI 走完全程(见 naming.ts)
      p.name = withFreePrefix(String(p.name ?? ""));
      const uri = toUri(p);
      if (!uri) { bump(`${t}:缺关键字段`); continue; }
      if (seen.has(uri)) { bump("源内重复"); continue; }
      seen.add(uri);
      nodes.push({
        uriHash: await hashUri(uri),
        uri,
        proto: t,
        name: String(p.name ?? "").slice(0, 200),
        server: String(p.server),
        port: Number(p.port),
        endpointId: endpointId(p),
        credId: credentialId(p),
        sourceId: src.id,
      });
    }
    report.kept = nodes.length;
    report.ok = true;
  } catch (e) {
    report.err = e instanceof Error ? e.message : String(e);
  }
  return { report, nodes };
}

/**
 * 跑一轮抓取。
 *
 * 各个源是并发抓的 —— 免费源普遍慢,串行跑一轮要几分钟。并发之后跨源去重在内存里做
 * (同一个节点被好几个源同时收录是常态,尤其是那几个互相抄的聚合仓库)。
 */
export async function harvestAll(): Promise<HarvestReport> {
  const startedAt = new Date().toISOString();
  const srcs = enabledSources();
  const results = await Promise.all(srcs.map((s) => harvestOne(s)));

  // 跨源去重 + 每套凭据限流。
  //
  // 限流这一步不是可选的优化,是这一整轮抓取有没有意义的关键。实测一轮的数字:
  //     可用节点     8330 条
  //     不同 endpoint 2268 个
  //     不同 credential 1439 套   ← 真正不同的"服务"只有这么多
  // 其中**一套**凭据(某个 CF 前置的 vmess)自己就占了 4000 条 —— 同一个 uuid、同一个
  // Host,套在四千个 Cloudflare 边缘 IP 上。不限流的话,库里 3 万多行有 6/7 是这一套东西,
  // 既撑爆 Neon 的免费额度,又让后面"取一批出来实测"永远只测到同一台机器。
  //
  // 留 PER_CRED_CAP 条而不是只留 1 条,是因为同一套凭据下不同的入口 IP 速度确实有差别,
  // 留几个备选有意义;但留几千个没有意义。3 → 池子约 1880 条,量级正合适。
  const merged: FreeNode[] = [];
  const seen = new Set<string>();
  const credCount = new Map<string, number>();
  for (const { report, nodes } of results) {
    let dupes = 0, capped = 0, overflow = 0, fromSource = 0;
    for (const n of nodes) {
      if (seen.has(n.uriHash)) { dupes++; continue; }
      const c = credCount.get(n.credId) ?? 0;
      if (c >= PER_CRED_CAP) { capped++; continue; }
      if (fromSource >= PER_SOURCE_CAP) { overflow++; continue; }
      credCount.set(n.credId, c + 1);
      fromSource++;
      seen.add(n.uriHash);
      merged.push(n);
    }
    if (dupes) {
      report.dropped["跨源重复"] = (report.dropped["跨源重复"] ?? 0) + dupes;
    }
    if (capped) {
      report.dropped[`同凭据超过 ${PER_CRED_CAP} 条`] = capped;
    }
    if (overflow) {
      report.dropped[`单源超过 ${PER_SOURCE_CAP} 条`] = overflow;
    }
    report.kept -= dupes + capped + overflow;
  }

  let stored = false;
  try {
    const n = await upsertNodes(merged);
    stored = n > 0;
  } catch (e) {
    // 落库失败不该让整轮抓取看起来"什么都没发生":报告照常返回,stored 标 false。
    for (const { report } of results) {
      if (!report.err) report.err = `入库失败:${e instanceof Error ? e.message : String(e)}`;
    }
  }

  for (const { report } of results) {
    await recordHarvest(report.id, report.ok, report.parsed, report.kept, report.err).catch(() => {});
  }

  return {
    startedAt,
    sources: results.map((r) => r.report),
    totalKept: merged.length,
    stored,
  };
}

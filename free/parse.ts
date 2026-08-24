// free/parse.ts — 把免费节点源的原始响应解析成一组 proxy 记录。
//
// 为什么不用 jsr:@std/yaml
// ----------------------
// 这些免费源是各路脚本自动生成的,格式好坏参半:有的是标准 Clash 块状 YAML,有的是
// 一整行 flow 风格 `{a: 1,b: 2}`,逗号后面还不带空格;有的文件里混着 HTML 报错页;
// 有的 6000 行里夹一行坏的。严格 YAML 解析器碰到一处坏的就整份抛异常 —— 对我们来说
// 这等于"一个源挂了就全丢",太脆。
//
// 所以这里自己写一个**只认 proxies 列表**的扫描器:逐项解析,坏的那一项跳过并计数,
// 好的照收。它不追求成为通用 YAML 解析器,只要能从这堆文件里稳定捞出节点即可。
//
// 一个必须处理对的坑:**未加引号的 IPv6 地址**。真实数据里有
//     {name: "x",server: 2001:bc8:32d7:1a9::2,port: 23388,type: vmess}
// 按 YAML 1.2 的规矩,flow 上下文里 `:` 只有**后面跟空白**时才是键值分隔符,所以
// `2001:bc8:32d7:1a9::2` 整个是一个普通标量。下面切分键值时严格按"第一个后面跟空白的
// 冒号"来切,就是为了这个 —— 按第一个冒号切会把 IPv6 节点全部解析错。

/** 解析出来的一条 proxy。字段名保持 Clash 的原样,不做重命名。 */
export type Proxy = Record<string, unknown>;

export interface ParseResult {
  proxies: Proxy[];
  /** 跳过的条目数(解析失败或缺关键字段),用来判断某个源是不是整体坏掉了 */
  skipped: number;
}

// ---------------------------------------------------------------- flow 标量

/** flow 上下文里一个标量的字面量 → JS 值。只认引号、布尔、数字,其余原样当字符串。 */
function scalar(raw: string): unknown {
  const s = raw.trim();
  if (!s) return "";
  if ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'")) {
    const body = s.slice(1, -1);
    // 只处理双引号里的转义;单引号在 YAML 里是字面量('' 表示一个 ')
    return s[0] === '"'
      ? body.replace(/\\(["\\/])/g, "$1").replace(/\\n/g, "\n")
      : body.replace(/''/g, "'");
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  // 端口号这种要转成数字。注意别把 "2001" 之外的 IPv6 片段误转 —— 这里要求整串是纯数字。
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  return s;
}

/**
 * 按顶层逗号切分 flow 集合的内容(已去掉外层的 {} 或 [])。
 * 跟踪 {}[] 的嵌套深度和引号状态,所以嵌套的 ws-opts / alpn 列表不会被切坏。
 */
function splitTop(body: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;          // 跳过转义字符
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

/** 把一段 flow 字面量(可能是 {...} / [...] / 标量)解析成 JS 值。 */
function flowValue(raw: string): unknown {
  const s = raw.trim();
  if (s.startsWith("{") && s.endsWith("}")) return flowMap(s.slice(1, -1));
  if (s.startsWith("[") && s.endsWith("]")) return splitTop(s.slice(1, -1)).map(flowValue);
  return scalar(s);
}

/** 切出键名:第一个**后面跟空白**的冒号才是分隔符(见文件头关于 IPv6 的说明)。 */
function splitPair(item: string): [string, string] | null {
  let quote = "";
  for (let i = 0; i < item.length; i++) {
    const c = item[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === ":" && (i + 1 >= item.length || /\s/.test(item[i + 1]))) {
      const k = item.slice(0, i).trim();
      const key = (k[0] === '"' || k[0] === "'") ? String(scalar(k)) : k;
      return [key, item.slice(i + 1).trim()];
    }
  }
  return null;
}

function flowMap(body: string): Proxy {
  const obj: Proxy = {};
  for (const item of splitTop(body)) {
    const pair = splitPair(item);
    if (!pair) continue;              // 不是键值对的碎片,跳过
    obj[pair[0]] = flowValue(pair[1]);
  }
  return obj;
}

// ---------------------------------------------------------------- 块状 YAML

/** 一行的缩进宽度(tab 按 1 个字符算 —— 这些文件里几乎不会出现 tab)。 */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * 把块状写法的一项(已经按缩进切好的若干行,首行的 "- " 已去掉)解析成对象。
 * 支持一层嵌套(ws-opts / grpc-opts / headers 这些),再深的极少见,忽略即可。
 */
function blockItem(lines: string[]): Proxy {
  const obj: Proxy = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const pair = splitPair(line.trim());
    if (!pair) { i++; continue; }
    const [key, rest] = pair;
    if (rest !== "") {
      obj[key] = flowValue(rest);
      i++;
      continue;
    }
    // 值为空 → 下面缩进更深的行是它的子结构
    const base = indentOf(line);
    const child: string[] = [];
    i++;
    while (i < lines.length && (!lines[i].trim() || indentOf(lines[i]) > base)) {
      child.push(lines[i]);
      i++;
    }
    const nonEmpty = child.filter((l) => l.trim());
    if (nonEmpty.length && nonEmpty[0].trim().startsWith("- ")) {
      obj[key] = nonEmpty.map((l) => flowValue(l.trim().slice(2)));
    } else {
      obj[key] = blockItem(child);
    }
  }
  return obj;
}

// ---------------------------------------------------------------- proxies 提取

/**
 * 从 Clash 配置文本里捞出 proxies 列表。
 *
 * 三种版式都认:
 *   1. 整份是一行 flow:  `{port: 7890,...,proxies: [{...},{...}],...}`
 *   2. 块状:            `proxies:\n  - name: x\n    type: ss\n  - {name: y,...}`
 *   3. 裸列表:          文件本身就是 `- {name: x,...}` 或 `- name: x`
 */
export function parseClashProxies(text: string): ParseResult {
  const proxies: Proxy[] = [];
  let skipped = 0;

  const push = (p: unknown) => {
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const o = p as Proxy;
      // server/port/type 三样缺一不可 —— 缺了的不是节点(常见的是分组、规则被误捞进来)
      if (o.server && o.port && o.type) proxies.push(o);
      else skipped++;
    } else skipped++;
  };

  // 版式 1:整份就是一个 flow map。直接找 `proxies:` 后面那个平衡的 [...]。
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const arr = extractBalanced(trimmed, /(?:^|[,{\s])proxies\s*:\s*\[/);
    if (arr) {
      for (const item of splitTop(arr)) push(flowValue(item));
      return { proxies, skipped };
    }
  }

  // 版式 2/3:按行走。找到 `proxies:` 这一行之后开始收,遇到同级或更浅的非列表键就停。
  const lines = text.split(/\r?\n/);
  let start = -1, listIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*proxies\s*:\s*(#.*)?$/.test(lines[i])) {
      start = i + 1;
      listIndent = indentOf(lines[i]);
      break;
    }
  }
  if (start < 0) {
    // 没有 proxies: 这一行 —— 可能整份就是裸列表
    const firstReal = lines.find((l) => l.trim() && !l.trim().startsWith("#"));
    if (!firstReal || !firstReal.trim().startsWith("- ")) return { proxies, skipped };
    start = 0;
    listIndent = -1;
  }

  let cur: string[] | null = null;
  let curIndent = 0;
  const flush = () => { if (cur) { push(blockOrFlow(cur)); cur = null; } };

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const ind = indentOf(line);
    const isItem = line.trimStart().startsWith("- ");
    if (isItem && (cur === null || ind <= curIndent)) {
      flush();
      cur = [line.trimStart().slice(2)];
      curIndent = ind;
      continue;
    }
    if (cur !== null && ind > curIndent) { cur.push(line); continue; }
    // 缩进回到 proxies: 同级(或更浅)的普通键 → proxies 段结束
    if (!isItem && ind <= listIndent) break;
    if (!isItem && listIndent < 0 && cur === null) break;
  }
  flush();
  return { proxies, skipped };
}

/** 一项可能是 flow(`{...}`)也可能是块状,这里分流。 */
function blockOrFlow(lines: string[]): unknown {
  const head = lines[0].trim();
  if (head.startsWith("{")) {
    // flow 项可能跨行,拼起来再解析
    const joined = lines.map((l) => l.trim()).join(" ");
    return flowValue(joined);
  }
  // 块状:首行是 `key: value`,后续行缩进更深。把首行的缩进补齐成和后续行一致。
  const rest = lines.slice(1);
  const childIndent = rest.find((l) => l.trim()) ? indentOf(rest.find((l) => l.trim())!) : 0;
  return blockItem([" ".repeat(childIndent) + head, ...rest]);
}

/** 从 re 匹配到的 `[` 开始,取出平衡括号内的内容(不含首尾方括号)。 */
function extractBalanced(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  if (!m) return null;
  const open = text.indexOf("[", m.index);
  if (open < 0) return null;
  let depth = 0, quote = "";
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

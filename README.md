# proxy-sub · 开发维护说明

家庭代理订阅分发系统。日常使用看《订阅系统使用手册》;这份是给改代码的人看的。

## 文件结构

```
main.ts            入口。只做请求分派。基本不用改。
config.ts          所有环境变量 + 常量路径。改配置在这。
auth.ts            登录码派生、验证、cookie、id 生成。
kv.ts              所有数据库读写收口。改存储结构只动这。
mail.ts            发邮件(测试邮件 + 季度登录码邮件)。
ui.ts              所有页面 HTML 和 CSS。改外观只动这。
singbox.ts         base64 节点 → sing-box JSON(vmess/vless/trojan/anytls/ss 解析层,给 clash.ts 复用)
clash.ts           复用 singbox.ts 的解析层 → Clash/mihomo YAML
protocol-filter.ts 按协议前缀过滤节点(给不支持 anytls 的客户端标签用,如 v2box/v2rayn)
node-stats.ts      从推送的原始节点列表里解析这批次的协议统计+批次标签(给"状态"面板用)
routes/
  subscribe.ts     /l/{user}/{id}[/{clientTag}] 发节点 + 记录访问
                   不带 clientTag:走设备默认 format(旧链接兼容)
                   带 clientTag(singbox/clash/openclash/v2box/v2rayn):格式+协议子集由标签决定
  admin.ts         后台:登录、设备增删改、节点、备份、邮件
  fallback.ts      应急查码入口
  tools.ts         工具箱路由(需登录)
  push.ts          接收本地测速推送(PUSH_KEY 保护)→ 写 KV nodes
index.html         默认伪装首页(无敏感信息)
deno.json          本地开发任务
```

## 客户端标签(2026-07-18 新增)

同一个设备的订阅链接可以加一段客户端标签后缀,不用在后台切换格式:

| 标签 | 格式 | 协议子集 | 适用客户端 |
|---|---|---|---|
| (无) | 设备默认 format | 全部 | 旧链接,兼容不变 |
| `singbox` | sing-box JSON | 全部(含 anytls) | sing-box |
| `clash` / `openclash` | Clash YAML | 全部(含 anytls) | OpenClash、mihomo |
| `v2box` | base64 | 仅 vless+trojan | V2Box(Xray-core,不支持 anytls) |
| `v2rayn` | base64 | 仅 vless+trojan | v2rayN(anytls 支持不稳定,先按此处理) |

例:`https://域名/l/zhourg/78989/singbox`

## 后台"状态"面板(2026-07-18 新增)

后台多了一个"状态"标签页,只读,不含任何操作按钮:
- **本批次**:从时间戳假节点的名字里解出这批是什么时候推的、是否有协议在吃缓存兜底(带 ⚠ 会额外提示),以及这批节点的协议分布(vless/anytls/trojan 各多少个,不含假节点)
- **服务器**:部署地址、当前服务器时间、设备总数
- **设备访问一览**:每台设备的累计访问次数 + 最近一次访问时间(跟设备管理页的信息一样,只是这里是纯只读一览表,不用来回切换)

## 工具箱布局(2026-07-18 改版)

从九宫格卡片改成了左侧工具列表 + 右侧内容区(`tools_ui.ts` 里的 `.tools-nav`/`.tool-panel`)。以后加新工具:左侧 `<nav>` 里加一个 `<a data-tool="xxx">`,右侧加一个 `<div class="tool-panel" id="tool-xxx">`,不用再考虑网格怎么排。

## Mac mini 端:按协议桶的缓存兜底(2026-07-18 新增)

`nodepipe/select_and_push.py` 把节点分两个独立配额桶选:vless 一桶,anytls+trojan 合并一桶("other"),各自按地区优先级排、各自截取,互相不补齐。

问题:如果上游订阅源某次完全没有 vless 节点(实际发生过),`v2box`/`v2rayn` 这两个标签只要 vless+trojan,会直接变成空订阅。

解决:每次推送成功后,把"这次有货"的桶存本地缓存(`~/nodepipe/state/last_good.json`,按桶分开存,不进 git)。下次如果某个桶又是空的,就用缓存顶上(哪怕是几天前的),而不是让依赖那个协议的客户端断供。用了缓存会在 push.log 里留 WARN,并且推送到订阅里的"时间戳假节点"名字后面会带 `⚠vless为缓存` / `⚠其他为缓存` 提示——不用翻日志,看客户端节点列表最后一条就知道这次是不是有协议在吃老本。

## 设计原则

- **职责隔离**:数据库只在 `kv.ts`,外观只在 `ui.ts`,配置只在 `config.ts`。改一处不波及其他。
- **main.ts 极薄**:只分派,不含业务逻辑。
- **加新功能的标准动作**:新建一个 `routes/xxx.ts`,在 `main.ts` 加一行分派。其余文件基本不动。

## 加新路由的例子

```ts
// routes/stats.ts
export async function handleStats(req: Request): Promise<Response> {
  return new Response("...");
}
```

```ts
// main.ts 里加一行
import { handleStats } from "./routes/stats.ts";
if (path === "/你的隐藏路径") return await handleStats(req);
```

## 环境变量(Deno Deploy → Settings → Environment Variables)

| 变量 | 说明 | 必填 |
|---|---|---|
| SEED | 登录码总钥匙,最高机密 | 是 |
| RESEND_API_KEY | 邮件密钥 re_xxx | 用邮件才填 |
| ADMIN_EMAIL | 收件邮箱(免费版须=Resend 注册邮箱) | 用邮件才填 |
| MAIL_FROM | 发件地址,默认 onboarding@resend.dev | 否 |
| DATABASE_URL | Neon 连接串,用于领取日志归档+看板;不填则日志只留 KV 最近100条 | 否 |

改环境变量后必须**重新部署**才生效。

## 数据存哪

- 设备名单、节点内容、节点历史、季度发信标记 → Deno KV(`kv.ts` 里的 key 前缀:`device` / `nodes` / `nodes_history` / `nodes_updated` / `sent`)。
- SEED 等机密 → 环境变量,不入库、不入代码。

## 本次包含的功能

- 设备增删改、停用/启用、**换链接**(保留名字备注只换 id)
- 复制链接、二维码
- 节点整批替换、**保存前自动留历史**、**一键恢复上一版**、**防手滑存空**
- **导出/恢复备份**(全部设备+节点存成 JSON)
- **访问侦测**(每台显示最近访问时间+累计次数)
- 登录码按季度派生轮换、应急查码入口
- 季度换码自动发邮件、测试邮件

## 部署

GitHub 仓库连 Deno Deploy,入口 `main.ts`,push 自动部署。KV 在 Deno Deploy 默认可用,无需额外开关。

## 后台"节点内容"编辑器(2026-07-18 加强)

- 每个节点显示协议徽章 + 名字拆成的信息 badge(Mac mini 测速时写进节点名字里的内容,按 `|` 拆分显示,具体是什么字段取决于 subs-check 的配置,不是这边额外测的)
- ↑↓ 手动排序,只在同一组(启用/停用)内挪动
- "停用"按钮:停用的节点自动沉到列表最底,存回去时会打上 `#OFF# ` 前缀。这不是只在页面上看不见——`protocol-filter.ts` 的 `stripDisabled()` 会在返回给任何格式/客户端标签之前把这些行整个剔除,真正不会被推给客户端,随时可以点"启用"恢复
- 批量勾选删除照旧保留

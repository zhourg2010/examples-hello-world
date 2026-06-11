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
routes/
  subscribe.ts     /l/{user}/{id} 发节点 + 记录访问
  admin.ts         后台:登录、设备增删改、节点、备份、邮件
  fallback.ts      应急查码入口
  tools.ts         工具箱路由(需登录)
index.html         默认伪装首页(无敏感信息)
deno.json          本地开发任务
```

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

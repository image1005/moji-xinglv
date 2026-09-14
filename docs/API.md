# API 说明

所有接口均为 JSON；除标注「匿名」外都需要登录会话（Cookie）。错误统一为
`{ statusCode, statusMessage }`。所有入参均经 Zod 校验，所有数据库读写走 Drizzle。

## 鉴权（Better Auth）

挂载在 `/api/auth/**`（catch-all，`server/api/auth/[...all].ts`）：

- `POST /api/auth/sign-up/email` — 注册 `{ email, password, name }`
- `POST /api/auth/sign-in/email` — 登录 `{ email, password }`
- `POST /api/auth/sign-out` — 退出
- `GET  /api/auth/get-session` — 当前会话（前端 `authClient.getSession()`）

角色：`user` / `admin`（admin 插件）。首个管理员由 `bun run db:seed` 创建。

## 当前用户

- `GET /api/me` → `{ user: { id, email, name, role } }`

## 规划

- `GET /api/plans` → 列表（按更新时间倒序，含最新版本号）
- `POST /api/plans` → `{ title?, planJson?, contentMd? }`，创建空白或指定行程，返回 `{ planId, version }`
- `GET /api/plans/:id` → `{ id, title, summary, contentMd, coverUrl, plan, version, createdAt, updatedAt }`
- `PATCH /api/plans/:id` → `{ title?, summary?, contentMd? }`（仅资料，不产生版本）
- `DELETE /api/plans/:id` → 删除规划及其版本 / 会话（级联）

### 保存与版本

- `POST /api/plans/:id/save` → `{ planJson?, conversationId? }`
  手动保存：内容有变化生成新版本（`source=user`）；无变化返回 `skipped: true` 不产生版本。
  传入 `conversationId` 时插入一条系统消息与预览卡片。
- `POST /api/plans/:id/rollback` → `{ version, conversationId? }`
  Undo 到指定版本：基于该版本内容**新建**版本（`source=rollback`），历史不删除；附带系统消息。
- `GET /api/plans/:id/versions` → 版本列表（含 `source`、`diffJson`、`parentVersionId`、`messageId`）
- `GET /api/plans/:id/versions/:version` → `{ plan }` 指定版本的完整 JSON

## 会话与消息

- `GET /api/conversations?planId=` → 会话列表（按更新时间倒序）
- `POST /api/conversations` → `{ planId, title? }`
- `GET /api/conversations/:id` → `{ conversation, messages[] }`
  `messages` 含 `role`、`content`、`toolCalls`、`preview`、`planVersion`
- `DELETE /api/conversations/:id`

## 聊天（流式）

`POST /api/chat`

```json
{ "conversationId": 1, "planId": 1, "messages": [/* AI SDK UIMessage[] */] }
```

- 服务端：写入最新用户消息 → 预建 assistant 消息行 → 构建带当前规划快照与 AGENTS.md 的 Mastra Agent →
  `@mastra/ai-sdk` `handleChatStream` 流式输出（AI SDK v5 协议）
- 工具产出的预览会随流返回（`tool-*/output.preview`），并在流结束时回写
  `messages.content / tool_calls / preview_json / plan_version_id`
- 客户端使用 `@ai-sdk/vue` 的 `Chat` + `DefaultChatTransport`，附带 `conversationId` 与 `planId`

## AGENTS.md 偏好

- `GET /api/agents-md?planId=` → `{ planId, content, version }`（`planId` 省略为全局）
- `PUT /api/agents-md` → `{ planId: number | null, content }`
  服务端执行长度上限（4000 字）与注入过滤；注入优先级：本规划 > 全局 > 系统默认；
  支持 `{{nickname}}`、`{{currency}}` 占位符。

## 百度地图代理（AK 仅服务端）

- `GET /api/panorama?location=lng,lat&width=640&height=360&heading=0&fov=90`
  返回 JPEG 图片。首次请求写入 `panoramas` 表，之后直接命中（响应头 `x-cache`）。
- `GET /api/staticmap?center=lng,lat&zoom=12&width=800&height=520&markers=lng,lat&markers=...&paths=...`
  返回 PNG 图片（`markers` / `paths` 支持重复参数），结果写入 `cache` 表。
- `GET /api/poi?q=西湖&region=杭州` → `{ results: [{ name, address, lng, lat }] }`（JSON 缓存 24h）

未配置 `BAIDU_MAP_AK` 时以上接口返回 501，前端会优雅降级。

## 后台（需要 admin）

- `GET /api/admin/stats` → 规划 / 会话 / 消息计数、缓存统计、百度调用统计（街景 / 静态图 / POI）
- `GET /api/admin/users` → 用户列表（含规划数）
- `PATCH /api/admin/users/:id` → `{ role?: 'user'|'admin', banned?: boolean }`（不能修改自己）
- `GET /api/admin/plans` → 全站规划列表
- `DELETE /api/admin/plans/:id`
- `GET /api/admin/cache` → 缓存统计 + 最近 50 条明细
- `DELETE /api/admin/cache` → `{ prefix? }` 清空缓存（Nitro storage + SQLite）

`/admin/**` 页面由 `server/middleware/admin-guard.ts` 守卫（未登录 / 非管理员重定向登录页），
API 侧再由 `requireAdmin` 二次校验。

## 缓存与命中约定

- 缓存键：`hashKey(api, params)`（SHA-256，参数顺序无关）
- 后端：Nitro storage（L1）→ SQLite `cache` 表（L2，`expires_at` 校验）→ 未命中才请求百度并回写
- 前端：`app/utils/idb.ts` 对 `GET /api/panorama`、`/api/staticmap`、`/api/poi` 做 IndexedDB 缓存（TTL + LRU）

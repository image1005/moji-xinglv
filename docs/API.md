# API 说明

山海行笺接口除地图 / 街景图片与聊天流外均为 JSON；除标注「匿名」外都需要登录会话（Cookie）。错误响应包含
`{ statusCode, statusMessage }`。所有入参均经 Zod 校验，所有数据库读写走 Drizzle。无效参数返回 400，乐观锁版本冲突返回 409。

## 鉴权（Better Auth）

挂载在 `/api/auth/**`（catch-all，`server/api/auth/[...all].ts`）：

- `POST /api/auth/sign-up/email` — 注册 `{ email, password, name }`
- `POST /api/auth/sign-in/email` — 登录 `{ email, password }`
- `POST /api/auth/sign-out` — 退出
- `GET  /api/auth/get-session` — 当前会话（前端 `authClient.getSession()`）

角色：`user` / `admin`（admin 插件）。首个管理员由 `bun run db:seed` 创建，凭据通过环境变量自行配置；登录页不公开默认密码。

## 当前用户

- `GET /api/me` → `{ user: { id, email, name, role } }`

## 规划

- `GET /api/plans` → 列表（按更新时间倒序，含当前版本号）
- `POST /api/plans` → `{ title?, planJson?, contentMd? }`，创建空白或指定行程，返回 `{ planId, version }`
- `GET /api/plans/:id` → `{ id, title, summary, contentMd, coverUrl, plan, version, createdAt, updatedAt }`
- `PATCH /api/plans/:id` → `{ title?, summary?, cover?, tags?, tips?, budget?, contentMd?, expectedVersion? }`。标题 / 简介 / 封面 / 标签 / 提示 / 预算变化时同步规划 JSON 并追加版本（无变化不追加）；仅 Markdown 正文变化不新增 JSON 版本。
- `DELETE /api/plans/:id` → 删除规划及其版本 / 会话（级联）

### 保存与版本

- `POST /api/plans/:id/save` → `{ planJson?, conversationId?, expectedVersion? }`
  手动保存：内容有变化生成新版本（`source=user`）；无变化返回 `skipped: true` 不产生版本。
  传入 `conversationId` 时先校验该会话属于当前用户与规划，再插入系统消息与预览卡片。
- `POST /api/plans/:id/switch` → `{ version, conversationId?, expectedVersion? }`
  切换当前版本到指定版本：**只移动 `plans.current_version_id` 指针，不新建版本**，历史完整保留；附带系统消息与预览卡片。
  之后继续编辑会以 `max(version)+1` 追加新版本，`parent_version_id` 指向切换后的当前版本，在版本路线图中形成分叉。
- `expectedVersion` 为客户端最后读取的**当前版本号**（非负整数，可能是切换回来的较早版本），不是切换目标版本号。API 当前允许省略，但本应用保存 / 切换与 smoke 均应发送它；省略时不提供客户端旧版本冲突检测。传入值与当前版本不一致返回 409；即使保存内容相同也须先检查版本。客户端应重新读取并由用户处理冲突，不能静默覆盖。
- 版本写入与规划快照更新在同一事务内；切换版本只更新规划快照与指针，不写入新版本。路由先校验会话归属，成功后追加系统消息；消息追加目前不与规划写入共用事务，不能承诺其失败会撤销已保存版本。参数 / 版本校验失败的 400 / 409 不应留下新版本或系统消息。
- `GET /api/plans/:id/versions` → 版本列表（含 `source`、`diffJson`、`parentVersionId`、`messageId`）
- `GET /api/plans/:id/versions/:version` → `{ plan }` 指定版本的完整 JSON

### 行程 JSON 扩展

唯一契约为 `shared/schemas/plan.ts`。`foodJournal`（美食手账）与 `checklist`（出行清单）缺省为 `[]`，保留在规划版本中；条目 `id` 在各自数组内唯一。

契约为严格模式（`strictObject`）：出现契约之外的字段时返回 400，并附带改名建议（如 `stay → lodging`、`duration → durationMinutes`），不会静默丢弃字段。缺字段仍按默认值兼容历史数据。界面不提供 JSON 源码编辑，所有编辑经可视化表单或 AI patch 进入该契约。

- `foodJournal`：`id`、`name` 必填；支持 `restaurant`、`city`、`address`、`date`、`meal`（breakfast/lunch/dinner/snack）、`status`（wishlist/tasted）、`cost`、`rating`（0–5）、`notes`、`tags`。
- `checklist`：`{ id, text, done }`，`done` 默认 `false`。
- `Spot` 增加 `address`（默认空串）、`category`（sight/food/stay/transport，默认 sight）、`durationMinutes`（默认 60）、`cost`（默认 0）。`lng` / `lat` 均为 `number | null`，未知时同时为 `null`，缺省亦为 `null`；不能只填一个坐标或编造坐标。
- AI 仅通过结构化 patch 修改当前规划，不提供全量覆盖工具；手工 JSON 保存仍由 schema 校验并受 `expectedVersion` 保护。

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
  `@mastra/ai-sdk` `handleChatStream` 流式输出（AI SDK v5 协议），多步工具循环（`maxSteps: 12`）
- 工具集（均校验 `planId` 作用域）：`get_plan`、`apply_plan_edits`（原子操作数组）、`patch_plan_json`（兜底）、`get_panorama`、`search_poi`；
  编辑不要求先读取，`expectedVersion` 为可选 CAS，冲突返回 409 由模型重读重试
- 一轮对话只保留一个版本：同一 `assistantMessageId` 且仍是当前版本时原地更新该版本（diff 对父版本重算），否则追加
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

静态图的 `paths` 仅为已有景点按日排序的顺序连线，不是导航路线，不提供道路距离或预计用时。未知坐标为 `null`，不传入图片代理，界面提示人工补全。

未配置 `BAIDU_MAP_AK` 时静态图 / 街景接口返回 501，前端显示未配置提示，其余编辑功能可继续使用。百度 secret 仅由 `server/services/baidu.ts` 读取，不下发客户端。

### 当前规划地点检索（非在线 POI）

`GET /api/poi?planId=1&q=景点名&region=城市` → `{ results: [{ name, address, lng, lat }], source: 'current-plan' }`。`planId` 与非空 `q` 必填，`region` 可选；按名称 / 地址检索，最多 20 条。

该接口与 Agent 的 `search_poi` 只检索已授权的当前规划已有且具备坐标的景点，不调用百度在线地点搜索或地理编码；按 `planId` 进行所有权与工作区作用域校验。规划内未知坐标仍为 `null`，不进入地点检索结果，需由用户人工补全；无需地图 key。

## 后台（需要 admin）

- `GET /api/admin/stats` → 规划 / 会话 / 消息计数、缓存统计、百度调用统计（街景 / 静态图；不新增在线 POI 调用）
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
- 前端：`app/utils/idb.ts` 对 `GET /api/panorama`、`/api/staticmap` 做 IndexedDB 缓存（TTL + LRU）；当前规划 POI 本地检索不使用百度缓存。

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

- `GET /api/plans` → 兼容旧调用的列表（按更新时间倒序，含当前版本号与 `revision`）
- `GET /api/plans?paged=true&limit=50&q=杭州&sort=updated&cursor=...` → `{ items, nextCursor, hasMore }`。`q` 为全库授权范围内的搜索，最长 100 字；`sort` 为 `updated`（默认）或 `created`，均倒序。
- `POST /api/plans` → `{ title?, planJson?, contentMd? }`，创建空白或指定行程，返回 `{ planId, version }`
- `GET /api/plans/:id` → `{ id, title, summary, contentMd, coverUrl, plan, version, revision, createdAt, updatedAt }`
- `PATCH /api/plans/:id` → `{ title?, summary?, cover?, tags?, tips?, budget?, contentMd?, expectedVersion?, expectedRevision? }`，返回 `{ ok: true, revision }`。标题 / 简介 / 封面 / 标签 / 提示 / 预算变化时同步规划 JSON 并追加版本（无变化不追加）；仅 Markdown 正文变化不新增 JSON 版本，但仍递增修订号。
- `DELETE /api/plans/:id` → 删除规划及其版本 / 会话（级联）

### 保存与版本

- `POST /api/plans/:id/save` → `{ planJson?, conversationId?, expectedVersion?, expectedRevision? }`
  手动保存：内容有变化生成新版本（`source=user`）；无变化返回 `skipped: true` 不产生版本。
  传入 `conversationId` 时先校验该会话属于当前用户与规划，再插入系统消息与预览卡片。
- `POST /api/plans/:id/switch` → `{ version, conversationId?, expectedVersion?, expectedRevision? }`
  切换当前版本到指定版本：**只移动 `plans.current_version_id` 指针，不新建版本**，历史完整保留；附带系统消息与预览卡片。
  之后继续编辑会以 `max(version)+1` 追加新版本，`parent_version_id` 指向切换后的当前版本，在版本路线图中形成分叉。
- 保存返回 `{ planId, version, revision, versionId, skipped, preview }`；切换返回 `{ version, revision, versionId, switched: true, preview }`。
- `expectedVersion` 为客户端最后读取的**当前版本号**，不是切换目标；`expectedRevision` 为该快照的单调递增修订号。手工客户端应同时发送两者，防止切回旧版本和 AI 同轮原地更新绕过旧版本检测。API 为兼容旧调用允许省略；单独发送版本号不能检测同版本内更新。任一已传值不匹配返回 409；无变化保存也先检查。冲突后保留本地草稿，读取最新内容并由用户明确重新应用，不自动覆盖。
- 规划快照、版本、修订号与关联系统消息在同一事务中写入；AI 提交时同事务更新关联助手消息的预览和版本引用。参数、归属和冲突校验失败不留下部分修改。切换版本不新增版本；规划修订号仍向前推进，不随历史版本倒退。
- `GET /api/plans/:id/versions` → 版本列表（含 `source`、`diffJson`、`parentVersionId`、`messageId`）
- `GET /api/plans/:id/versions?paged=true&limit=50&cursor=...` → `{ items, nextCursor, hasMore }`
- `GET /api/plans/:id/versions/:version` → `{ plan }` 指定版本的完整 JSON

### 行程 JSON 扩展

唯一契约为 `shared/schemas/plan.ts`。`foodJournal`（美食手账）与 `checklist`（出行清单）缺省为 `[]`，保留在规划版本中；条目 `id` 在各自数组内唯一。

契约为严格模式（`strictObject`）：出现契约之外的字段时返回 400，并附带改名建议（如 `stay → lodging`、`duration → durationMinutes`），不会静默丢弃字段。缺字段仍按默认值兼容历史数据。界面不提供 JSON 源码编辑，所有编辑经可视化表单或 AI patch 进入该契约。

- `foodJournal`：`id`、`name` 必填；支持 `restaurant`、`city`、`address`、`date`、`meal`（breakfast/lunch/dinner/snack）、`status`（wishlist/tasted）、`cost`、`rating`（0–5）、`notes`、`tags`。
- `checklist`：`{ id, text, done }`，`done` 默认 `false`。
- `Spot` 增加 `address`（默认空串）、`category`（sight/food/stay/transport，默认 sight）、`durationMinutes`（默认 60）、`cost`（默认 0）。`lng` / `lat` 均为 `number | null`，未知时同时为 `null`，缺省亦为 `null`；不能只填一个坐标或编造坐标。
- AI 仅通过结构化编辑修改当前规划，不提供全量覆盖工具；手工保存仍由 schema 校验并受 `expectedVersion` / `expectedRevision` 保护。

## 会话与消息

- `GET /api/conversations?planId=` → 会话列表（按更新时间倒序）
- `GET /api/conversations?planId=1&paged=true&limit=50&q=周末&cursor=...` → `{ items, nextCursor, hasMore }`；`q` 按会话标题搜索，最长 100 字。
- `POST /api/conversations` → `{ planId, title? }`
- `GET /api/conversations/:id` → `{ conversation, messages[] }`
  `messages` 含 `role`、`content`、`toolCalls`、`preview`、`planVersion`
- `GET /api/conversations/:id?paged=true&limit=50&cursor=...` → `{ conversation, messages, messagePage: { nextCursor, hasMore } }`；首批为最新消息，数组内按时间正序，游标用于加载更早消息。
- `DELETE /api/conversations/:id`

分页接口的 `limit` 默认 50，范围 1–200；`cursor` 为不透明字符串，绑定用户、列表与筛选作用域。调用者原样传回 `nextCursor`，不要自行拼装。工作区或会话搜索词、工作区排序变化必须丢弃旧游标，从首页开始；无效或作用域不匹配的游标返回 400。未传 `paged=true` 的历史列表调用保留原形状，前端工作台使用分页接口。

## 聊天（流式）

`POST /api/chat`

请求 `Content-Type: application/x-ndjson`，一行一条记录，以换行结束；当前一次发送一条用户消息。响应同为 `application/x-ndjson; charset=utf-8`。旧的 JSON messages 数组入口已移除，SQLite 旧历史仍兼容。

```jsonl
{"protocolVersion":1,"type":"message","requestId":"req-example-001","messageId":"user-001","conversationId":1,"planId":1,"configuration":{"model":"deepseek-flash","webSearch":false,"thinking":"standard"},"message":{"id":"user-001","role":"user","parts":[{"type":"text","text":"请增加一天杭州行程"}]}}
```

附件 part 为 `{"type":"file","attachmentId":"上传接口返回的UUID"}`，允许只有图片；二进制不进入聊天 JSONL。事件带 protocolVersion/requestId/messageId/seq，类型为 status、chunk、error、terminal。chunk 内复用 SDK text/file/tool parts；搜索来源由工具结果承载，行程预览由真实事务结果承载。详见 [JSONL 契约与边界](JSONL.md)。

- 服务端：登记请求和额度 → 使用数据库可信历史与最新用户消息 → 预建 assistant 消息行 → 构建带当前规划快照与 AGENTS.md 的 Mastra Agent →
  `@mastra/ai-sdk` `handleChatStream` 输出 AI SDK v5 消息流，再由薄适配层封装为应用 JSONL；Mastra 管理多步工具循环（`maxSteps: 12`）
- 工具集（均校验 `planId` 作用域）：`get_plan`、`apply_plan_edits`（原子操作数组）、`patch_plan_json`（兜底）、`get_panorama`、`search_poi`；
  工具执行侧维护读取修订号；冲突返回 409 后必须重读。`get_plan` 支持 `section=all|overview|metadata|budget|tips|day|foodJournal|checklist`、`dayIndex`、`offset`、`limit`；分段结果带 `hasMore` / `nextOffset`，不能当成完整数组覆盖。
- 一轮对话只保留一个版本：同一 `assistantMessageId` 且仍是当前版本时原地更新该版本（diff 对父版本重算），否则追加
- 工具预览随流返回（`tool-*/output.preview`），在规划提交事务中持久化；文本和工具记录在工具完成、周期检查点和收尾时写回。重启后任务标为 `interrupted`，保留已提交结果，不重新执行工具或续传未保存的 token。
- `requestId` 必填；幂等身份包含用户、规划、会话、规范化消息内容、附件 ID 和本轮实际模型／搜索／思考配置。重复提交同 ID 返回 409，配置或内容不同明确报冲突，不错误复用结果。普通丢响应重试复用 ID；用户明确新一轮才生成新 ID，已提交改动仍保留。
- `GET /api/chat/runs?conversationId=1` → 最近 20 个授权任务，字段为 `requestId`、`status`、`assistantMessageId`、`planId`、`conversationId`、`steps`、`errorCode`、`startedAt`、`updatedAt`、`finishedAt`。状态为 `queued|running|completed|cancelled|failed|interrupted`。
- 每轮最多 12 步、服务端总超时 180 秒；输入采用 UTF-8 字节预算，输出 token、用户/全局并发、队列和周期请求额度由 `.env.example` 的 `AI_*` 配置。流建立前输入超预算返回 400；已在流中的工具结果超预算以流错误结束，保留已提交修改。限额/等待超时返回 429 和 `Retry-After`。供应商不提供的 token 用量不推算。
- 客户端使用 `@ai-sdk/vue` 的 `Chat` + 扩展 DefaultChatTransport 的 JsonlChatTransport；消息只由 SDK 管理。同规划视图切换保持流，切换会话或规划停止。

### 模型配置、附件与资源

- `GET /api/model-settings` → `{ defaults, capabilities }`；`PUT /api/model-settings` 接收 `{ model, webSearch, thinking, searchProvider? }`，校验实际能力并保存当前用户默认值。thinking 为 off/light/standard/deep；searchProvider 由服务端重算，开启搜索时保存到每轮 chat_runs.configurationJson。官方 DeepSeek 或 Tavily 可用时允许联网。
- `POST /api/attachments`：multipart/form-data，字段 planId 与 file；返回 `{ id, url, mediaType, filename, size, width, height }`。每张≤5 MiB、8192 px 单边和24M像素，真实解码 JPEG/PNG/WebP 后统一重编码；一轮最多4张。
- `GET /api/attachments/:id`：验证用户与所属规划，再返回图片正文；`DELETE` 移除未发送附件，已关联消息的附件受引用规则保护。跨用户、跨工作区访问不泄露存在性。清理规则见媒体文档。
- `GET /api/plans/:id/resources` → `{ revision, resources }`；每个资源以稳定 entityId 关联，包含状态、图片来源／提供方／署名／类型及已确认坐标系和来源。
- `POST /api/plans/:id/resources` 接收 `{ expectedRevision, entityId? }`，逐步获取实际图片和地点；写回重新检查用户、规划、revision、实体指纹，不增加行程版本。失败保留明确状态供重试。
- `GET /api/plans/:id/resource-image?entityId=...&v=<实体指纹>&image=<图片缓存键>`：按规划授权后代理已确认图片，检查域名、大小和真实解码，禁止任意 URL 代理。image 为64位十六进制缓存键，更换图片会改变地址；传入旧图片键返回404。兼容旧请求缺少v/image，但新客户端消费服务端生成的完整URL。保持 `private, no-store`，前端持久缓存由按用户隔离的IndexedDB负责。
- 开启联网才向 Mastra 注册 `search_web`，每轮至多3次、每次最多5条、12秒超时。返回标题、链接、摘要、获取时间与真实提供方 DeepSeek/Tavily；未提供摘要时为空串并在界面说明；外部资料作为不可信参考，不改变工具权限。

## AGENTS.md 偏好

- `GET /api/agents-md?planId=` → `{ planId, content, version }`（`planId` 省略为全局）
- `PUT /api/agents-md` → `{ planId: number | null, content, expectedVersion? }`
  服务端执行长度上限（4000 字）与注入过滤；注入优先级：本规划 > 全局 > 系统默认；
  支持 `{{nickname}}`、`{{currency}}` 占位符。
  当前客户端发送读取时的偏好版本；尚不存在的偏好以 0 为基线，冲突返回 409 并保留本地草稿。

## 百度地图代理（AK 仅服务端）

- `GET /api/panorama?location=lng,lat&width=640&height=360&heading=0&fov=90`
  返回 JPEG 图片。首次请求写入 `cache` 表，之后直接命中（响应头 `x-cache`）；历史 `panoramas` 表不再作为新请求写入目标。
- `GET /api/staticmap?center=lng,lat&zoom=12&width=800&height=520&markers=lng,lat&markers=...&paths=...`
  返回 PNG 图片（`markers` / `paths` 支持重复参数），结果写入 `cache` 表。

静态图的 `paths` 仅为已有景点按日排序的顺序连线，不是导航路线，不提供道路距离或预计用时。未知坐标为 `null`，不传入图片代理，界面提示人工补全。

未配置 `BAIDU_MAP_AK` 时静态图 / 街景接口返回 501，前端显示未配置提示，其余编辑功能可继续使用。百度 secret 仅由 `server/services/baidu.ts` 读取，不下发客户端。

### 当前规划地点检索（非在线 POI）

`GET /api/poi?planId=1&q=景点名&region=城市` → `{ results: [{ name, address, lng, lat }], source: 'current-plan' }`。`planId` 与非空 `q` 必填，`region` 可选；按名称 / 地址检索，最多 20 条。

该接口与 Agent 的 `search_poi` 只检索已授权的当前规划已有且具备坐标的景点，保留其本地检索语义，无需地图 key。新的 resources 服务另行调用百度地点搜索／地理编码，按城市、名称和地址消歧；不确认就保持待定位。已确认的资源坐标用于城市地图，不后台覆盖用户行程或生成图片版本。AI 新增地点禁止自行提交猜测坐标。

## 后台（需要 admin）

- `GET /api/admin/stats` → `{ plans, conversations, messages, cache: { total, expired, bytes }, metrics, runs, recentRuns }`。`metrics` 按服务包含 `requests`、`errors`、`cacheHits`、`durationMs`、`inputTokens`、`outputTokens`、`usageSamples`、`steps`；`runs` 为状态计数，`recentRuns` 为最近 20 个任务。外部请求指标与缓存条目数分开，不提供虚构调用量或费用。
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
- 后端缓存默认 512 MiB，`CACHE_MAX_BYTES` 可调整，启动/定时维护分批淘汰过期与超额记录；单批有界，容量在多批中回落。后台容量统计不读取图片正文。
- 前端：`app/utils/idb.ts` 按用户缓存图片与规划详情，48 MiB / 300 条上限、TTL 与最近访问索引；相同 URL 请求合并，最后一个订阅者取消才中止请求。规划快照先展示再向服务端校验；网络故障时显示只读离线状态，401 / 403 / 404 不降级展示旧缓存。当前规划 POI 本地检索不使用百度缓存。
- 图片默认7天；图片按钮“重试”删除该URL的IndexedDB记录并使用HTTP reload，普通刷新不强制绕过缓存。新下载必须为非空且不超过8 MiB的PNG/JPEG/WebP，浏览器支持createImageBitmap时解码成功才缓存。
- 服务端公开推荐图按城市/名称/地址/类型及实际启用来源复用最终选图（1天），按来源URL缓存已解码字节（7天），并合并同图并发下载，最多12个独立下载任务。腾讯搜索命中1天、空结果10分钟，错误不作为空结果缓存。详见 [IMAGE_CACHE](IMAGE_CACHE.md)。

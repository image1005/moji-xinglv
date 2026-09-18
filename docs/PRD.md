# PRD — 山海行笺 · 国风旅游行程规划智能体

> 本文件是项目的完整需求规格。AGENTS.md 是精简执行约束；两者冲突时，以本文件「0. 已裁决事项」为准。

## 0. 已裁决事项（决策记录）

1. **鉴权使用 Better Auth（核心库）**：`better-auth` + Drizzle adapter + admin 插件与 RBAC。
   - 集成方式：catch-all 路由 `server/api/auth/[...all].ts`；`/admin/**` 的 `routeRules` 式守卫以 `server/middleware/admin-guard.ts` 等价实现，并在 API 层用 `requireAdmin` 双重校验。
   - 表结构以 better-auth 规范为准：`user` / `session` / `account` / `verification`（`server/database/auth-schema.ts` 由 Better Auth CLI 生成，勿手改）。
   - **覆盖**第 4 节中 `users` / `sessions` 的简表设计；密码哈希存于 `account` 表（credential provider），不在 `users.password_hash`。
   - 初始 admin 账号由 `db:seed` 创建，邮箱和密码通过 `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` 显式配置；登录页与文档不公开默认密码。
2. **地图/街景全部服务端代理，不引入百度 JS API GL**：后端代理 `staticimage/v2`（支持 `markers`、`paths` 绘制路线）与 `panorama/v2`（需 "for server" 类型 AK），前端只消费后端图片 URL。
   - 满足验收标准「百度 AK 不出现在前端」；代价是地图不可缩放拖动（静态图）。
   - **覆盖**技术栈中「百度地图 JS API GL」的表述；禁止引入浏览器端 AK。
3. **DB 单一写入者 = Drizzle**：所有写入（含 better-auth 通过 drizzle adapter）走同一 `bun:sqlite` 连接；Mastra 不接 SQLite 存储（避免双写与锁冲突），会话历史由 `messages` 表持久化并显式传给 Agent。
4. **AI SDK 版本对齐**：`ai` / `@ai-sdk/vue` 必须与 `@mastra/ai-sdk` 支持的 v5 消息协议一致（`handleChatStream` 与 SDK parts；持久化记录通过明确映射恢复）；应用边界另使用 JSONL 薄适配，升级 major 前必须跑通完整对话流。
5. **运行时约束**：Bun ≥ 1.4，Nuxt 脚本（含 prepare/typecheck）经 `bun --bun` 执行（`bun:sqlite` 依赖 Bun 运行时）；质量入口为 `bun run check`。端到端冒烟用 `bun run smoke`，仅对已启动的独立测试环境使用显式凭据执行，不得用真实业务数据库。
6. **UI 采用 dsh 式工作区模型（两栏）**：左栏为可折叠的「工作区（= 规划）」文件夹树——顶部「新会话」，文件夹内第一项为「规划预览与编辑」，其下是该工作区的会话；中间主区在「对话 / 版本路线」与「规划预览与编辑（行程总览 / 路线舆图 / 风物食记 / 沿途街景 / 旅行偏好）」之间切换，另有「设置」视图（全局 AGENTS.md、账号、退出）；不提供 JSON 源码编辑，编辑全部走可视化表单与结构化 patch。
   - **覆盖**第 3.1 节的三栏布局与独立右侧栏设计；视觉保持国风浅色，仅参考 dsh 的布局与比例。
   - 会话必须归属工作区（`conversations.plan_id` NOT NULL），不实现「未分组」区。
7. **SSR 兼容**：`nuxt.config.ts` 保留 `vite.ssr.noExternal: ['zod']`——`shared/` 目录经 Vite 优化后，SSR 下会丢失 zod 命名导出（报 `z.object` undefined）。
8. **山海行笺数据扩展**：`foodJournal` 美食手账与 `checklist` 出行清单均默认空数组；景点增加地址、类别、停留时长与花费。未知经纬度同时为 `null`，不得由 AI 编造，允许人工补全；历史 JSON 用 schema 默认值兼容，不破坏已有数据。
9. **乐观锁与事务**：规划有独立、单调递增的 `revision`；保存、切换版本与手工编辑携带 `expectedVersion` / `expectedRevision`，过期快照返回 409。`version` 可以切回历史值，同轮 AI 可原地更新当前版本，因此修订号不可用版本号代替。API 为旧调用保留可选字段，当前客户端必须发送；AI 执行侧维护读取时修订号并在冲突后重读。规划快照、版本、修订号和关联预览/系统消息在同一事务内提交，参数/作用域错误在写入前拒绝。AI 仅提交结构化编辑，不开放全量覆盖工具。**切换版本直接使用目标版本，不新建版本；revision 仍递增**。
10. **地点与路线边界（2026-09-18 扩展）**：POI / `search_poi` 保留当前用户当前规划的本地检索。新增服务端受控在线地点查询和地理编码，用城市、名称与地址消歧，保存供应商、坐标系及来源；无可靠结果保持待定位，模型不得填写猜测坐标。百度密钥仍仅在 `server/services/baidu.ts` 读取。静态地图支持城市总览、每日标记和顺序连线，连线不是道路导航，不给出道路距离或预计用时。无 AK / 无坐标时显示说明，不影响编辑。
11. **验收真实性**：CI 使用冻结锁文件的 Bun 安装、`bun run check` 与构建，测试凭据为 dummy，不依赖真实 AI / 百度。smoke 仅写本次临时规划与会话，finally 清理，不注册持久用户或改偏好；默认只接受 localhost/127.0.0.1，远端必须显式授权。验收结论以本次实际命令结果报告为准，不沿用历史「全绿」声明。
12. **编辑与移动端连续性**：地点、食记、规划资料及旅行偏好草稿按用户、工作区、对象存于本机；刷新及 A→B→A 后可恢复。409 保留草稿，用户先比较最新内容，再明确重新应用并保存；偏好另以自身版本校验。抽屉关闭时 inert，打开时约束焦点，Escape 关闭并返回触发按钮；页签支持方向键，布局适配动态视口。草稿不是跨设备同步或数据库备份。
13. **AI 生命周期与恢复**：同工作区查看预览或设置不停止生成；跨工作区/会话停止。生成请求使用唯一 ID，在 `chat_runs` 记录状态及检查点；重复 ID 不再次执行工具，明确新一轮重试才创建新 ID。重启恢复已提交行程、预览与中断状态，不承诺续传未保存 token；当前按单实例部署。
14. **有界上下文和确定性检查**：可信历史来自数据库；首批用户需求与近期对话按字节预算整理，长规划只注入概要，通过工具分段读取。输入包含规则、工具契约、历史及工具结果，输出另设 token 上限。行程检查提示日期、时间重叠、重复地点、密度、缺坐标和预算明细问题，不提供实时营业/路况或真实模型准确率保证。
15. **分页和缓存**：工作区、会话、消息、版本首批默认 50 条，采用有作用域的游标；工作区搜索和排序在服务端覆盖授权全库。图片按视口和面板活动状态加载、滑块防抖及请求合并。前端图片/规划缓存按用户隔离，48 MiB / 300 条并按元数据淘汰；网络故障的规划快照只读，401/403/404 不使用旧缓存。后端默认 512 MiB、分批回收，历史 `panoramas` 表兼容保留，新图片只写 `cache`。
16. **运行治理与发布**：用户/全局并发、队列和周期请求额度可配置；AI/地图指标来自实际服务边界，供应商未返回的 token 保持未知。发布检查增加临时数据库 HTTP 与本地模拟 AI 浏览器验收；SQLite 备份必须是一致性新副本，恢复演练不得覆盖业务数据库。实现与本轮验证记录见 [OPTIMIZATION_IMPLEMENTATION.md](OPTIMIZATION_IMPLEMENTATION.md)。
17. **应用聊天 JSONL**：请求为一条版本化用户消息记录，响应为 `application/x-ndjson` 事件流；含 requestId、messageId、事件序号与明确终态。客户端使用 AI SDK Chat 和薄传输适配；上游继续使用模型与 Mastra 所需协议。文本、附件、工具、来源、预览使用 SDK parts，附件正文只在上传与模型边界出现。服务端数据库历史为权威来源，刷新恢复已保存检查点，不承诺续传未保存 token。
18. **模型配置与能力**：独立联网开关和关闭/轻量/标准/深度思考选项，按实际模型能力映射参数，不支持项禁用。用户默认配置持久化，每次运行保存快照并参与幂等身份；附件标识和规范化文字同样参与。DeepSeek 原生搜索只能在实际接口支持时启用；独立搜索工具明确标记真实提供方，关闭联网不得执行搜索。
19. **图文行程和多模态**：景点、食记及城市用稳定实体标识关联媒体资源；媒体状态独立存储，不为每张图片生成版本。异步补图绑定用户、规划、实体及修订条件，不覆盖后续编辑。图片保存来源、署名和类型，实景与菜品示意分开，不猜网址或以生成图冒充实景。上传支持纯图消息、选择/拖拽/粘贴、进度和重试；权限、格式、尺寸与数量在服务端验证。刷新和后续追问恢复附件引用，非视觉模型明确拒绝。
20. **渐进架构与验证**：保留 Nuxt、Bun、Better Auth、Drizzle、Mastra、AI SDK 和现有 SQLite 数据；模块化单体，规划快照/revision/版本/关联预览在统一事务入口写入。Knip 同时检查生产和全工程入口，保留框架自动导入和兼容证据。实现、依赖决策、迁移和本轮真实检查结果以 [DELIVERY.md](DELIVERY.md) 为准；历史文档中的验收记录不代表本次结果。

## 1. 目标

开发一个旅游行程规划智能体，界面参考 dsh、Codex 等 AI 聊天工作台的三栏布局。用户可与 AI 对话，AI 通过工具读写行程 JSON，JSON 中保存图片地址、街景信息、每日行程、景点、交通、住宿、备注等内容。每次 AI 编辑 JSON 后，聊天流中都要输出一个可视化预览版本；聊天输入框下方提供「保存」按钮。左侧栏为「我的规划」，支持按时间排序、标题、简介、Markdown 内容、编辑与删除。系统需包含账号系统和后台系统；后台账号登录后自动跳转后台。百度地图街景图片与规划 JSON 需在前端缓存、后端缓存，并持久化到数据库，减少百度 API 调用。

## 2. 技术栈

- 运行时/包管理：Bun（唯一）
- 框架：Nuxt 4 + Vue 3 + TypeScript strict
- 数据库：Bun 自带 SQLite + Drizzle ORM（类型安全、迁移、Schema）
- Agent：Mastra（Agent、Tools、Workflow、Memory）
- AI UI：Vercel AI SDK（流式聊天、结构化输出；版本对齐见裁决 4）
- 样式：SCSS + 国风设计令牌；**不引入 UI 组件库**（手写组件，保证可靠、精简、可维护）
- 校验：Zod（全链路）
- 鉴权：Better Auth（`better-auth` 核心库）+ Drizzle Adapter + RBAC
- Markdown：编辑 `md-editor-v3`，渲染 `@nuxtjs/mdc`
- 缓存：前端 IndexedDB/localStorage + 后端 Nitro Storage + SQLite `cache` 表
- 地图：百度静态图 API + 百度全景/街景静态图 API（服务端代理，见裁决 2）
- 工程化：ESLint、Prettier、TypeScript strict、环境变量校验、统一错误处理、日志、迁移与种子数据、测试（Vitest + 快照测试）

## 3. 核心功能

### 3.1 聊天工作台

> 布局以裁决 6 为准：两栏工作区模型，主区在对话与规划预览编辑之间切换。

- 左栏：工作区文件夹（= 规划）+ 会话列表（可折叠）
- 主区：AI 对话 / 版本路线 ⇄ 规划预览与编辑（行程总览 / 路线舆图 / 风物食记 / 沿途街景 / 旅行偏好）
- 不提供 JSON 源码编辑：JSON 仅作为存储与契约，编辑全部走可视化表单与结构化 patch

### 3.2 AI 对话

- 支持流式输出
- AI 可调用 Mastra Tools 读取与编辑行程 JSON（多步工具循环，无强制先读顺序）
- 工具集以当前规划作用域内的 `get_plan`、`apply_plan_edits`（原子操作）、`patch_plan_json`（兜底）、街景与本地 `search_poi` 为限；不向 AI 暴露全量覆盖工具，新增规划由明确的工作区创建操作完成
- 一轮对话只保留一个版本：同一 `assistantMessageId` 仍是当前版本时原地更新，指针移动或换轮后以当前版本为父追加

### 3.3 可视化编辑与 JSON 契约

- 定义 Zod Schema（严格模式：未知字段返回 400 并给出改名建议，不静默丢弃）
- AI 只返回结构化 patch；服务端校验后合并，生成新版本
- 界面不提供 JSON 源码编辑：行程资料、路线与景点、风物食记、出行清单均在可视化表单中编辑

### 3.4 预览输出

- 每次编辑后，在聊天流中插入预览卡片
- 展示行程摘要、每日安排、街景缩略图
- 可展开、复制、保存、Diff

### 3.5 保存与版本

- 聊天下方「保存」按钮将当前 JSON 保存为规划
- `plan_versions` 表保存历史版本，支持版本切换
- AI 编辑或有内容变化的手工保存生成 `plan_version`（递增版本号 + diff + 来源，同轮 AI 遵循裁决 9）；无变化保存返回 `skipped: true`，但仍检查 `expectedVersion` 与 `expectedRevision`。切换版本直接使用目标版本（不新建、不删除历史），独立 revision 仍递增。

### 3.6 我的规划

- 左栏按更新时间/创建时间排序
- 支持标题、简介、Markdown 内容、编辑、删除、搜索

### 3.7 账号系统

- 注册、登录、退出、会话管理
- 角色分为 user/admin

### 3.8 后台系统

- `/admin` 路由，登录后台账号自动跳转
- 支持用户管理、规划管理、缓存管理、百度 API 调用统计

### 3.9 百度地图

- 获取目标地点街景图片
- 后端统一代理百度 API，AK 不暴露前端
- 图片代理使用 `staticimage/v2`（markers/paths）、`panorama/v2`；受控地点查询使用 `place/v2/search` / `geocoding/v3`
- 本地 POI 检索保持原作用域；在线定位必须由供应商核实并记录坐标系，未知坐标为 `null`
- 每日连线仅示意访问顺序，不是导航；无 key 时优雅提示，其余功能正常使用

### 3.10 缓存策略

- 前端：IndexedDB 存街景图片 Blob 与规划 JSON，localStorage 存轻量索引，TTL + LRU
- 后端：Nitro Storage + SQLite `cache` 表，`key = hash(api + params)`，value = JSON/BLOB，`expires_at`
- 请求百度前先查缓存；未命中再请求，写回缓存与数据库

### 3.11 聊天对话保存

- 每个规划（plan）对应一个或多个 conversation，conversation 绑定 `plan_id`
- `messages` 表持久化每条 user/assistant/tool 消息，含 role、content、tool_calls、preview_json、plan_version_id、created_at
- 刷新、切换设备后可恢复完整会话
- 左栏可切换/新建/删除会话
- 支持「另存为新规划」「复制对话到其他规划」

### 3.12 工作区选择（编辑某个规划）

- 顶部工作区切换器：当前编辑的 plan（标题 + 缩略图 + 版本号）
- 左栏点击某规划即切换工作区，中栏对话与右栏预览同步切换到该 plan
- 新建对话时默认绑定当前工作区；无工作区时引导先创建或从模板生成
- AI Tools 的所有读写都以「当前 plan_id」为作用域，禁止跨规划误写

### 3.13 AGENTS.md 系统

- 每个用户有一份全局 AGENTS.md（全局偏好），每个 plan 可选一份局部 AGENTS.md
- 前端提供 Markdown 编辑器：实时预览、语法高亮、保存、重置、版本历史
- 内容示例：出行偏好、预算、忌口、节奏、必去/避开地点、语言风格、称呼、输出格式要求
- 后端在调用 Mastra Agent 时，将 AGENTS.md 作为 system prompt 的一部分注入
- 优先级：plan 级 > user 级 > 系统默认
- 支持变量占位（如 `{{nickname}}`、`{{currency}}`）与安全过滤（长度上限、禁止注入指令越权）

### 3.14 JSON 历史版本与 Undo

- 每条 assistant 回复下方显示版本徽标（如 v7）与操作：查看 diff、切换到此版本、复制 JSON
- Undo 直接切换到目标版本（只移动当前版本指针，不回删历史、不新建版本），并在聊天流插入一条系统消息说明切换；之后继续编辑会以该版本为父分叉出新版本
- `plan_versions` 表增加字段：`parent_version_id`、`source`（ai/user/rollback）、`diff_json`、`message_id`

### 3.15 美食手账与出行清单

- 美食手账记录想吃 / 已尝、餐厅、城市、地址、日期、餐次、花费、评分、备注与标签，纳入规划 JSON 保存、版本与切换。
- 出行清单支持条目与完成状态，条目使用唯一 ID；新建与历史规划缺省为空数组。
- 景点详情支持地址、类别、停留时长与花费；未知坐标不影响文字行程编辑，也不会被当作 `(0,0)` 绘制。

## 4. 数据模型

> 注：users / sessions 由裁决 1 覆盖（Better Auth 表结构），其余表按此实现。

### users（被裁决 1 覆盖）

`id`、`email`、`password_hash`、`role`、`created_at`

### sessions（被裁决 1 覆盖）

`id`、`user_id`、`token`、`expires_at`

### plans

`id`、`user_id`、`title`、`summary`、`content_md`、`plan_json`、`cover_url`、`current_version_id`、`revision`、`created_at`、`updated_at`

### plan_versions

`id`、`plan_id`、`version`、`plan_json`、`created_by`、`created_at`、`parent_version_id`、`source`、`diff_json`、`message_id`

### panoramas

`id`、`location`、`width`、`height`、`image_blob`、`hash`、`created_at`

仅保留历史兼容，新图片统一进入 `cache`。

### cache

`key`、`value`、`type`、`expires_at`、`created_at`

### conversations

`id`、`user_id`、`plan_id`、`title`、`created_at`、`updated_at`

### messages

`id`、`conversation_id`、`role`、`content`、`tool_calls`、`preview_json`、`plan_version_id`、`created_at`

### agents_md

`id`、`user_id`、`plan_id`（nullable）、`content`、`version`、`created_at`、`updated_at`

### chat_runs

`id`、`user_id`、`request_id`、`request_hash`、`plan_id`、`conversation_id`、`assistant_message_id`、`status`、`steps`、`error_code`、`started_at`、`updated_at`、`finished_at`。用户与请求 ID 联合唯一，用于去重和恢复，不存储聊天正文。

### usage_metrics

按 `day`、`user_id`、`service` 聚合 `requests`、`errors`、`cache_hits`、`duration_ms`、`input_tokens`、`output_tokens`、`usage_samples`、`steps`；指标不复制用户规划或提示词。

## 5. 行程 JSON Schema

```ts
{
  title: string
  summary: string
  cover: string
  days: Array<{
    date: string
    city: string
    spots: Array<{
      name: string
      lng: number | null // 默认 null，未知坐标必须与 lat 同时为空
      lat: number | null // 默认 null
      address: string // 默认空串
      category: 'sight' | 'food' | 'stay' | 'transport' // 默认 sight
      durationMinutes: number // 默认 60
      cost: number // 默认 0
      time: string
      notes: string
      imageUrl: string
      panorama: string
    }>
    transport: string
    lodging: string
    meals: string[]
  }>
  tips: string[]
  budget: { total: number; currency: string; breakdown?: Record<string, number> }
  tags: string[]
  foodJournal: Array<{ // 默认 []；同数组内 id 唯一
    id: string
    name: string
    restaurant: string // 默认空串
    city: string
    address: string
    date: string
    meal: 'breakfast' | 'lunch' | 'dinner' | 'snack' // 默认 snack
    status: 'wishlist' | 'tasted' // 默认 wishlist
    cost: number // 默认 0
    rating: number // 0–5，默认 0
    notes: string
    tags: string[] // 默认 []
  }>
  checklist: Array<{ id: string; text: string; done: boolean }> // 默认 []，done 默认 false，id 唯一
}
```

唯一实现来源：`shared/schemas/plan.ts`。

## 6. 工程要求

- 合并重复逻辑，抽象为 composables、server services、schemas、types、utils
- 优先使用成熟库，不重复造轮子
- 代码数量尽可能精简，UI 库非必要不引入，但保证可靠、可读、可维护
- 所有 API 使用 Zod 校验；所有数据库操作走 Drizzle；所有 AI 输出走结构化校验
- 环境变量统一管理：`BAIDU_MAP_AK`、`DATABASE_URL`、`AUTH_SECRET`、`AI_*` 等
- 提供 `bun install`、`bun dev`、`bun run build`、`bun run db:migrate`、`bun run db:seed` 命令
- 提供清晰目录结构、关键文件、运行说明、部署说明
- 不提交真实密钥；提供 `.env.example`
- 写测试文件（Vitest + 快照）
- 移动端适配

## 7. 美术风格

国风/古风/复古：宣纸底色、墨色、朱砂、竹青、鎏金；宋体/楷体标题；印章式按钮；水墨、云纹、窗棂、留白；圆角克制，层次清晰。整体像现代 AI 工作台，但视觉语言为东方古典。

## 8. 交付物

1. 完整可运行项目代码
2. 数据库 Schema 与迁移文件
3. 百度地图/街景代理接口
4. Mastra Agent 与 Tools 实现
5. Vercel AI SDK 聊天 UI
6. 前端缓存与后端缓存实现
7. 账号系统与后台系统
8. README：启动、配置、部署、验收说明
9. API 说明文档，开发文档

## 9. 验收标准

- `bun install && bun dev` 可运行，`bun run build` 可构建
- 百度 AK 不出现在前端
- 同一街景/规划重复请求优先命中缓存，不重复调用百度 API
- AI 可连续编辑 JSON，每次编辑后聊天流出现预览
- 规划可保存、排序、编辑、删除、版本切换
- 后台账号登录后自动跳转 `/admin`
- UI 符合国风/古风/复古风格，采用裁决 6 的两栏工作区布局（覆盖原三栏设计）

## 10. 本机环境备注

- Windows + PowerShell 5.1；Bun 为唯一运行时（初始化时曾观察到 `bun` 不在 PATH，执行前先验证）
- 网络：优先镜像源（npmmirror）；需要时代理 `127.0.0.1:7897`（仅本地开发，勿写进代码）

# PRD — 国风旅游行程规划智能体

> 本文件是项目的完整需求规格。AGENTS.md 是精简执行约束；两者冲突时，以本文件「0. 已裁决事项」为准。

## 0. 已裁决事项（决策记录）

1. **鉴权使用 Better Auth（核心库）**：`better-auth` + Drizzle adapter + admin 插件与 RBAC。
   - 集成方式：catch-all 路由 `server/api/auth/[...all].ts`；`/admin/**` 的 `routeRules` 式守卫以 `server/middleware/admin-guard.ts` 等价实现，并在 API 层用 `requireAdmin` 双重校验。
   - 表结构以 better-auth 规范为准：`user` / `session` / `account` / `verification`（`server/database/auth-schema.ts` 由 Better Auth CLI 生成，勿手改）。
   - **覆盖**第 4 节中 `users` / `sessions` 的简表设计；密码哈希存于 `account` 表（credential provider），不在 `users.password_hash`。
   - 初始 admin 账号由 `db:seed` 创建（默认 `admin@example.com` / `admin123456`）。
2. **地图/街景全部服务端代理，不引入百度 JS API GL**：后端代理 `staticimage/v2`（支持 `markers`、`paths` 绘制路线）与 `panorama/v2`（需 "for server" 类型 AK），前端只消费后端图片 URL。
   - 满足验收标准「百度 AK 不出现在前端」；代价是地图不可缩放拖动（静态图）。
   - **覆盖**技术栈中「百度地图 JS API GL」的表述；禁止引入浏览器端 AK。
3. **DB 单一写入者 = Drizzle**：所有写入（含 better-auth 通过 drizzle adapter）走同一 `bun:sqlite` 连接；Mastra 不接 SQLite 存储（避免双写与锁冲突），会话历史由 `messages` 表持久化并显式传给 Agent。
4. **AI SDK 版本对齐**：`ai` / `@ai-sdk/vue` 必须与 `@mastra/ai-sdk` 支持的 v5 消息协议一致（`handleChatStream` + `toAISdkV5Messages`）；升级 major 前必须跑通完整对话流。
5. **运行时约束**：Nuxt 脚本经 `bun --bun` 执行（`bun:sqlite` 依赖 Bun 运行时）；端到端验收用 `bun run scripts/smoke.ts`（需先 `bun dev`）。
6. **UI 采用 dsh 式工作区模型（两栏）**：左栏为可折叠的「工作区（= 规划）」文件夹树——顶部「新会话」，文件夹内第一项为「规划预览与编辑」，其下是该工作区的会话；中间主区在「对话 / 轨迹」与「规划预览与编辑（行程 / 地图 / 街景 / JSON / AGENTS.md）」之间切换，另有「设置」视图（全局 AGENTS.md、账号、退出）。
   - **覆盖**第 3.1 节的三栏布局与独立右侧栏设计；视觉保持国风浅色，仅参考 dsh 的布局与比例。
   - 会话必须归属工作区（`conversations.plan_id` NOT NULL），不实现「未分组」区。
7. **SSR 兼容**：`nuxt.config.ts` 保留 `vite.ssr.noExternal: ['zod']`——`shared/` 目录经 Vite 优化后，SSR 下会丢失 zod 命名导出（报 `z.object` undefined）。

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

### 3.1 三栏聊天工作台

- 左栏：规划列表 + 会话列表（可折叠）
- 中栏：AI 对话与 JSON 预览
- 右栏：行程详情 / 地图 / 街景 / JSON 源码 / AGENTS.md（Tab 切换）

### 3.2 AI 对话

- 支持流式输出
- AI 可调用 Mastra Tools 读取、创建、修改、保存行程 JSON
- 工具集：`get_plan`、`create_plan`、`patch_plan_json`、`update_plan_json`、`get_panorama`、`search_poi`、`save_plan`

### 3.3 JSON 编辑

- 定义 Zod Schema
- AI 只返回结构化 patch
- 服务端校验后合并，生成新版本

### 3.4 预览输出

- 每次编辑后，在聊天流中插入预览卡片
- 展示行程摘要、每日安排、街景缩略图
- 可展开、复制、保存、Diff

### 3.5 保存与版本

- 聊天下方「保存」按钮将当前 JSON 保存为规划
- `plan_versions` 表保存历史版本，支持回滚
- 每次 AI 编辑或用户手动保存，都生成一个 `plan_version`（递增版本号 + diff + 来源）

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
- 仅使用：`staticimage/v2`（markers/paths）、`panorama/v2`

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

- 每条 assistant 回复下方显示版本徽标（如 v7）与操作：查看 diff、Undo 到此版本、复制 JSON、恢复为新分支
- Undo 会基于目标版本创建「新版本」（不回删历史），并在聊天流插入一条系统消息说明回滚来源
- `plan_versions` 表增加字段：`parent_version_id`、`source`（ai/user/rollback）、`diff_json`、`message_id`

## 4. 数据模型

> 注：users / sessions 由裁决 1 覆盖（Better Auth 表结构），其余表按此实现。

### users（被裁决 1 覆盖）

`id`、`email`、`password_hash`、`role`、`created_at`

### sessions（被裁决 1 覆盖）

`id`、`user_id`、`token`、`expires_at`

### plans

`id`、`user_id`、`title`、`summary`、`content_md`、`plan_json`、`cover_url`、`created_at`、`updated_at`

### plan_versions

`id`、`plan_id`、`version`、`plan_json`、`created_by`、`created_at`、`parent_version_id`、`source`、`diff_json`、`message_id`

### panoramas

`id`、`location`、`width`、`height`、`image_blob`、`hash`、`created_at`

### cache

`key`、`value`、`type`、`expires_at`、`created_at`

### conversations

`id`、`user_id`、`plan_id`、`title`、`created_at`、`updated_at`

### messages

`id`、`conversation_id`、`role`、`content`、`tool_calls`、`preview_json`、`plan_version_id`、`created_at`

### agents_md

`id`、`user_id`、`plan_id`（nullable）、`content`、`version`、`created_at`、`updated_at`

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
      lng: number
      lat: number
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
- 规划可保存、排序、编辑、删除、版本回滚
- 后台账号登录后自动跳转 `/admin`
- UI 符合国风/古风/复古风格，三栏布局参考 dsh、Codex

## 10. 本机环境备注

- Windows + PowerShell 5.1；Bun 为唯一运行时（初始化时曾观察到 `bun` 不在 PATH，执行前先验证）
- 网络：优先镜像源（npmmirror）；需要时代理 `127.0.0.1:7897`（仅本地开发，勿写进代码）

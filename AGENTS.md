# AGENTS.md — 国风旅游行程规划智能体

Nuxt 4 + Bun 全栈项目：AI 旅游行程规划工作台，dsh 式**两栏**布局（左侧：工作区文件夹树 + 会话；主区：对话 ⇄ 规划预览与编辑 ⇄ 设置）。
工作区 = 规划（含 JSON 与版本）；会话必须归属某个工作区（`conversations.plan_id` NOT NULL，无「未分组」）。

完整产品规格、数据模型与验收标准见 `docs/PRD.md`（已通过 `opencode.json` 自动加载，动手前先读）。

当前仓库为从零搭建状态：若「目标结构」中的文件尚不存在，说明正在执行初始化任务，按 PRD 落盘并保持本文件全部约束。

## 命令（必须提供并保持的脚本接口）

- `bun install` — 安装依赖。Windows 环境优先镜像源（`bunfig.toml` → `https://registry.npmmirror.com`），必要时用本地代理 `127.0.0.1:7897`
- `bun dev` — 启动开发服务器
- `bun run build` / `bun run preview`
- `bun run db:generate` — drizzle-kit 生成迁移
- `bun run db:migrate` — 应用迁移（bun:sqlite migrator）
- `bun run db:seed` — 种子数据（含初始 admin 账号）
- `bun run lint` / `bun run typecheck`（vue-tsc）/ `bun run test`（vitest run）
- 单测：`bunx vitest run <file> -t "<name>"`
- 端到端冒烟（先 `bun dev`）：`bun run scripts/smoke.ts`

规则：

- Bun 是唯一运行时与包管理器；禁止 npm / pnpm / yarn、`package-lock.json`、`pnpm-lock.yaml`
- ⚠️ Nuxt 脚本必须经 `bun --bun`（已内置在 package.json）；直接用 Node 跑 `nuxt dev` 会报 `Received protocol 'bun:'`，生产运行用 `bun .output/server/index.mjs`
- npm scripts 必须跨平台（Windows PowerShell 5.1）；不要用 `rm` / `cp` 等 POSIX 命令，优先 Bun API 或 `node:fs`
- 初始化时本机 `bun` 不在 PATH；执行命令前先 `bun --version` 验证，缺失则安装（`powershell -c "irm bun.sh/install.ps1 | iex"`）并重开终端
- 任务完成前必须通过：`bun run lint` + `bun run typecheck` + `bun run test`

## 技术选型（已锁定，勿擅自更换）

- Nuxt 4（`app/` 目录）+ Vue 3 + TypeScript strict；不引入 UI 组件库，手写 SCSS 国风设计令牌
- DB：`bun:sqlite` + `drizzle-orm/bun-sqlite` + drizzle-kit；**单一写入者** = Drizzle；Mastra 不接 SQLite 存储（避免双写与锁冲突）
- 鉴权：`better-auth` + Drizzle adapter + admin 插件（`server/utils/auth.ts`，catch-all 挂在 `/api/auth/[...all]`）；`/admin/**` 由 `server/middleware/admin-guard.ts` 守卫 + API `requireAdmin` 双重校验；表结构以 better-auth 为准（`server/database/auth-schema.ts` 由 CLI 生成，勿手改），覆盖 PRD 中 users/sessions 简表设计
- Agent：Mastra 跑在 Nitro 路由内；聊天流用 `@mastra/ai-sdk` 的 `handleChatStream` + `toAISdkV5Messages`，客户端用 `@ai-sdk/vue`
- ⚠️ AI SDK 版本对齐：`ai` / `@ai-sdk/vue` 必须与 `@mastra/ai-sdk` 支持的 v5 消息协议一致；不要盲目升到最新 major，升级前先跑通完整对话流
- ⚠️ SSR 与 zod：`nuxt.config.ts` 的 `vite.ssr.noExternal: ['zod']` 不能删——`shared/` 目录经 Vite 优化后在 SSR 下会丢失 zod 命名导出（报 `z.object` undefined）
- LLM：OpenAI 兼容接口，环境变量 `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL`
- 校验：Zod 全链路（API 入参、AI tool 参数、plan JSON、env）
- Markdown：编辑用 `md-editor-v3`，渲染用 `@nuxtjs/mdc`
- 测试：Vitest + 快照（patch 合并、版本 diff、缓存 key）

## 目标结构（关键文件）

```
app/                       # Nuxt 4 前端
  pages/                   # / 工作台、/login、/admin/**
  components/              # WorkspaceSidebar（工作区文件夹树）、MainPanel（模式路由）、
                           # ConversationView（对话/版本路线）、PlanWorkspaceView（行程/地图/食记/街景/偏好）、
                           # SettingsView、ChatMessage/PreviewCard/ToolCallCard、国风组件与 AppIcon
  composables/             # useWorkspace（工作区/会话/消息/版本单例）、useCurrentUser
  utils/idb.ts             # IndexedDB 缓存（街景 Blob、plan JSON，TTL + LRU）
  assets/styles/           # 国风设计令牌 SCSS
server/
  api/chat.post.ts         # 流式聊天入口（Mastra + AI SDK）
  services/baidu.ts        # 唯一允许读 BAIDU_MAP_AK 的文件
  services/cache.ts        # SQLite cache 表 + Nitro storage
  database/schema.ts       # 全部 Drizzle 表定义
  database/migrations/     # drizzle-kit 生成，勿手改
  agents/ + tools/         # Mastra Agent 与工具集
shared/schemas/plan.ts     # 行程 JSON 的唯一 Zod schema 与类型来源
scripts/smoke.ts           # 端到端冒烟测试（需先 bun dev）
docs/PRD.md                # 完整产品规格（必读）
docs/API.md / docs/DEV.md  # API 与开发文档
```

## 硬约束（最容易踩的坑）

1. 百度 AK 仅服务端：只允许 `server/services/baidu.ts` 读 `BAIDU_MAP_AK`；只代理 `staticimage/v2`（markers/paths 画路线）与 `panorama/v2`；禁止引入百度 JS API GL、禁止浏览器端 AK（已决策，见 PRD）
2. 缓存优先：请求百度前必须先查前端 IndexedDB → 后端 `cache` 表 / Nitro storage（`key = hash(api + params)`，校验 `expires_at`）；未命中才请求并写回（内存 + DB）
3. AI 只产出结构化编辑（工具返回值经 Zod 校验）；服务端校验后合并生成新版本；禁止用 AI 文本整体覆盖 `plan_json`。优先 `apply_plan_edits` 原子操作，`patch_plan_json` 仅兜底，不向 AI 暴露全量覆盖工具。行程 JSON 为严格契约：未知字段必须 400 拒绝并给出改名提示（如 `stay → lodging`），禁止静默丢弃；界面不提供 JSON 源码编辑，全部走可视化表单
4. 工具作用域：每个 tool 必须接收并校验当前 `plan_id`，禁止跨规划读写
5. 版本只追加不删除：`plan_versions` 含 `version`（自增）、`parent_version_id`、`source`、`diff_json`、`message_id`；Undo（切换版本）= 移动 `plans.current_version_id` 指针直接使用目标版本 + 聊天流插入系统消息，不新建版本；之后继续编辑以当前版本为父分叉
6. 每次 AI 编辑后，聊天流必须插入可视化预览卡片（摘要 / 每日安排 / 街景缩略图；可展开、复制、保存、Diff）
7. 会话持久化：conversation 绑定 `plan_id`；messages 存 role / content / tool_calls / preview_json / plan_version_id；刷新或换设备后可恢复完整会话
8. AGENTS.md 注入：优先级 plan 级 > user 级 > 系统默认；支持 `{{nickname}}`、`{{currency}}` 等占位符；长度上限 + 防注入过滤；在服务端拼装 system prompt
9. 角色 user/admin 以服务端为准；admin 登录后自动跳转 `/admin`；`/admin/**` 需服务端 middleware 与 API 双重校验
10. 密钥仅存 `.env`；保持 `.env.example` 同步；前端 bundle 不得出现 `BAIDU_MAP_AK`、`AUTH_SECRET`
11. 国风视觉：宣纸底 / 墨 / 朱砂 / 竹青 / 鎏金，宋楷标题，印章式按钮，克制圆角；移动端左侧栏折叠为抽屉
12. 新 API 必须有 Zod 校验（入参用 `readValidatedBody` / `getValidatedQuery` 以返回 400）；新表必须走 migration；所有 DB 操作走 Drizzle
13. 工作区模型：工作区 = 规划；每个会话必须绑定 `plan_id`；左栏为可折叠工作区文件夹（顶部「规划预览与编辑」入口 + 会话列表）；中间主区在「对话/版本路线」与「规划预览与编辑」之间切换，不再有独立右栏
14. AI 编辑以工具驱动（ReAct 多步循环），不强制读后写顺序；一轮对话（同一 `assistantMessageId`）只保留一个版本：仍是当前版本时原地更新，指针移动或换轮后追加

## 环境变量（.env，保持 .env.example 同步）

- `BAIDU_MAP_AK` — 百度服务端 AK（全景需申请 "for server" 类型）
- `AUTH_SECRET`、`BETTER_AUTH_URL`
- `DATABASE_URL` — 形如 `file:./data/app.db`
- `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` — OpenAI 兼容 LLM
- 本机网络：优先镜像源；需要代理时仅本地 shell 设置 `$env:HTTP_PROXY="http://127.0.0.1:7897"`，不要写进代码

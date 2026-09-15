# 山海行笺开发文档

## 架构总览

```
浏览器（Nuxt 4 / Vue 3）
  ├─ app/composables/useWorkspace.ts   按 Nuxt app 隔离的工作区状态：规划 / 会话 / 消息 / 版本
  ├─ @ai-sdk/vue Chat ──► POST /api/chat（流式，AI SDK v5 协议）
  └─ IndexedDB 缓存（街景 Blob、静态图，TTL + LRU；POI 仅检索当前规划）

Nitro（Bun 运行时）
  ├─ server/agents/        Mastra Agent + 受限工具集（全部以 planId 作用域校验，AI 仅 patch）
  ├─ server/services/      plan / conversation / cache / baidu / agents-md
  ├─ server/api/           REST 路由（Zod 校验入参）
  └─ SQLite（bun:sqlite + Drizzle，单一写入者）
```

关键数据流：

1. **AI 编辑**：`apply_plan_edits(edits[])`（原子操作：plan/day/spot/food/checklist × add/update/remove/move/status/toggle）→
   服务端在同一事务内按序应用、`PlanSchema` 校验、写入版本与更新 `plans.plan_json`；`patch_plan_json` 仅作兜底。
   **一轮对话只保留一个版本**：同一 `assistantMessageId` 且仍是当前版本时原地更新（diff 对父版本重算），指针被移动或换轮后追加新版本。
   工具不再要求先 `get_plan`；`expectedVersion` 为可选 CAS，冲突返回 409 由模型重读。AI 不提供全量覆盖工具。
2. **切换版本（Undo）**：校验当前版本 `expectedVersion` 与会话归属 → 读取目标版本 → 直接把它设为当前版本（更新 `plans.plan_json` 与 `current_version_id`，**不新建版本**）→
   成功后追加系统消息 + 预览卡片；历史永不删除。过期写入返回 409。切换后继续编辑会以 `max(version)+1` 追加版本、以当前版本为父，版本路线图据此分叉。
   当前消息追加与版本写入尚非同一事务，消息写入异常不会撤销已经成功的规划版本。
3. **百度请求**：相同参数单飞去重 → `hashKey(api, params)` → Nitro storage → SQLite `cache` 表 → 未命中才带 AK 请求百度 → 回写。二进制 L1 使用可序列化 base64 与绝对过期时间，L2 命中回填剩余 TTL；前端再包一层按用户隔离的 IndexedDB。历史 `panoramas` 表保留兼容，但新图片统一使用 `cache`。
   仅允许 `staticimage/v2` 与 `panorama/v2`，不使用在线 POI、路线导航或浏览器地图 SDK。

## 目录与关键文件

| 路径 | 职责 |
| --- | --- |
| `shared/schemas/plan.ts` | 行程 JSON 唯一 Zod schema 与类型；改动需同步 `docs/PRD.md` |
| `shared/utils/{merge-patch,diff,hash,json}.ts` | patch 合并、结构化 diff、缓存键、稳定序列化 |
| `server/database/schema.ts` | 全部 Drizzle 表；auth 四表由 CLI 生成（`auth-schema.ts`） |
| `server/agents/tools.ts` | Mastra 工具集：get_plan / apply_plan_edits / patch_plan_json（兜底）/ get_panorama / search_poi（含 planId 越权校验） |
| `server/agents/travel-agent.ts` | 按请求构建 Agent（模型配置 + system prompt 注入） |
| `server/api/chat.post.ts` | 流式聊天：消息持久化 + 流观察器 + finish 回写 |
| `app/composables/useWorkspace.ts` | 前端唯一状态源（工作区树 / 会话 / 消息 / 版本，按 Nuxt app 实例隔离，拒绝过期响应写回） |
| `app/components/WorkspaceSidebar.vue` | 左栏：新会话、可折叠工作区文件夹、搜索/排序、设置 |
| `app/components/MainPanel.vue` | 主区模式路由：对话 ⇄ 规划预览与编辑 ⇄ 设置 |
| `app/components/ConversationView.vue` | 对话/版本路线页签 + 输入区（保存 / 停止 / 发送） |
| `app/components/PlanWorkspaceView.vue` | 行程总览 / 路线舆图 / 风物食记 / 沿途街景 / 旅行偏好（无 JSON 源码编辑，全部可视化） |
| `app/utils/idb.ts` | IndexedDB TTL + LRU 缓存 |

## 数据库

- 鉴权：`user` / `session` / `account` / `verification`（Better Auth CLI 生成，勿手改；
  修改鉴权配置后运行 `bunx --bun @better-auth/cli generate --config <auth.ts> --output server/database/auth-schema.ts`）
- 业务：`plans`、`plan_versions`、`panoramas`、`cache`、`conversations`、`messages`、`agents_md`
- 迁移：改 `schema.ts` → `bun run db:generate` → `bun run db:migrate`；不要手改 `server/database/migrations/`

## 约定与约束

- **Bun 是唯一运行时**：Nuxt 脚本必须走 `bun --bun`（否则 `bun:sqlite` 无法加载）；
  禁止 npm / pnpm / yarn 与对应 lockfile。
- **单一写入者**：所有写入（含 Better Auth 的 drizzle adapter）走同一 `db` 实例；
  不要给 Mastra 配置 SQLite 存储（会话历史由 `messages` 表承担）。
- **AI SDK 版本**：`ai@5.x` + `@ai-sdk/vue@2.x` 与 `@mastra/ai-sdk` 的 v5 消息协议对齐；
  升级前必须跑通完整对话流（`handleChatStream` / `toAISdkV5Messages`）。
- **SSR 与 zod**：`vite.ssr.noExternal: ['zod']` 必须保留，否则 `shared/` 的 schema 在 SSR 下报 `z.object` undefined。
- **工作区模型**：工作区 = 规划；`conversations.plan_id` NOT NULL（无未分组会话）；
  左栏点击文件夹内第一项进入「规划预览与编辑」（`mainMode = 'plan'`），点击会话回到对话。
- **AI 只产 patch**：工具入参、输出、最终 JSON 全链路 Zod 校验；禁止用模型文本整体覆盖 `plan_json`，不向 AI 暴露全量覆盖工具。原子编辑优先 `apply_plan_edits`，`patch_plan_json` 仅兜底；工具无需先读，409 冲突时由模型重读重试。
- **严格契约**：Day / Spot / Budget / 食记 / 清单 / 行程对象均为 `z.strictObject`；未知字段返回 400 与改名提示（`formatPlanIssues`），不静默丢弃。手工编辑全部走可视化表单（行程总览「编辑资料」、路线舆图、风物食记、出行清单）。
- **数据扩展**：`foodJournal` / `checklist` 缺省 `[]`，条目 ID 各自唯一。`Spot.lng` / `lat` 缺省且未知时同时为 `null`；`address=''`、`category='sight'`、`durationMinutes=60`、`cost=0`。所有入口经同一 schema 归一化，旧 JSON 无需破坏性迁移。
- **乐观锁**：保存与切换版本应携带当前 `expectedVersion`（API 当前为可选非负整数）；服务端在同一事务检查版本并写入。省略版本不提供旧版本冲突检测。即使无变化保存也先检查已传入的版本。收到 409 后保留本地草稿，刷新后由用户处理，不自动重试覆盖。
- **版本指针**：当前版本 = `plans.current_version_id`（为兼容历史数据，指针为空时回退到最新版本）。切换版本只改指针与规划快照；新版本编号取 `max(version)+1`，因此切换后继续编辑可能跳号并在路线图中分叉。
- **地图边界**：只允许静态图与 panorama 服务端代理。POI 仅检索当前规划；未知坐标不生成地图请求、不由 AI 猜测。路线只是景点顺序连线，不是导航；无 key 提示降级，不阻断行程编辑。
- **密钥边界**：`BAIDU_MAP_AK` 只允许在 `server/services/baidu.ts` 读取；
  前端产物不得出现 AK / AUTH_SECRET / AI_API_KEY 的**值**。
- **页面缓存（KeepAlive）**：`/` 与 `/admin` 通过 `definePageMeta({ keepalive: true })` 保留页面本地状态
  （输入框、滚动位置、Tab 选择）；`useWorkspace` 按 Nuxt app 实例隔离，不能使用跨 SSR 请求的模块级单例。
  **退出登录必须调用 `resetWorkspace()` + `clearUser()`**，并使在途响应失效，避免旧请求复写换号后的数据。
  切换工作区 / 会话时同样验证请求归属；返回页面后需要新数据时用 `onActivated` + 一次性 guard 刷新（参考 `admin/index.vue`）。
- **Windows 跨平台**：package scripts 不使用 `rm` / `cp` 等 POSIX 命令；最低 Bun 版本为 1.4（`bun.lock` 为 lockfileVersion 2）。

## 测试

- `tests/`：Vitest 单测 + 内联快照（schema、merge patch、diff、缓存键与相关回归）。
- `bun run check`：依次执行 lint、typecheck、test；另执行 `bun run build`。CI 使用 Bun ≥ 1.4、`bun install --frozen-lockfile`、dummy 配置与独立测试数据库，不使用 npm，不运行真实服务 smoke。
- `bun run smoke`（`bun run scripts/smoke.ts` 的别名）：先启动使用独立测试数据库的 `bun dev`，显式提供已有测试账号 `SMOKE_EMAIL` / `SMOKE_PASSWORD`。默认 `SMOKE_BASE=http://localhost:3000`，只允许 localhost / 127.0.0.1；远端必须获授权并设置 `SMOKE_ALLOW_REMOTE=true`。`SMOKE_TIMEOUT_MS` 默认 15000，覆盖请求与响应体读取。
- smoke 创建随机标记的独立临时规划与会话，断言 schema 默认值、美食 / 清单持久化、真实内容、400 / 409、v1→v2→v3 与系统消息；finally 只删除本次创建的规划，并验证会话级联清理。不注册用户、不修改全局或规划偏好、不请求 AI / 百度。不针对真实业务 DB 执行。
- smoke 退出码：0 全部通过、1 检查或清理失败、2 配置错误。清理失败会报告本次规划 ID；进程被强制终止或创建响应丢失时仍须人工检查本次随机标记，禁止批量删除其他资源。
- `bun run scripts/verify-isolated.ts`：先完成生产构建，再执行此自包含验收入口。脚本生成临时 SQLite 与随机凭据、应用迁移、启动仅监听 127.0.0.1:3219 的生产服务，调用 11 项 HTTP 冒烟，最后停止自身服务并清理自身临时目录；不读写 `data/app.db`。脚本清空自身进程代理并设置 NO_PROXY，避免本机代理干扰回环请求，不修改系统代理。
- 聊天回归覆盖不可信历史过滤、活动规划锁、失败/取消单次收尾及工具输出版本关联；影像代理回归覆盖响应脱敏、文件签名、体积上限及并发去重。它们是隔离测试，不替代真实模型/百度联调。
- 验收结论以本次实际命令的退出码与输出报告为准；未运行 smoke、浏览器、AI 或百度实测时须明确说明，不能由 lint / 单测推断已经验收。

## 常见改法

- **加一个 AI 工具**：在 `server/agents/tools.ts` 用 `createTool`（`inputSchema` 必须含 `planId` 并
  `ensureScope`），注册进返回对象并同步 `server/agents/tool-names.ts`；若产生新版本，返回值带上 `preview` 与 `versionId`。
- **加一个 API**：`server/api/**` 新建路由，用 Zod 校验入参、`requireUser/requireAdmin` 鉴权、
  业务逻辑放 `server/services/`。
- **调整行程字段**：改 `shared/schemas/plan.ts` → 跑测试 → 迁移（若涉及 DB 列）→ 更新 `docs/PRD.md` 与预览卡片展示。
- **新增缓存源**：在 `server/services/cache.ts` 提供 get/set，键用 `hashKey(api, params)`，
  并考虑前端 `idb.ts` 是否需要对应缓存。

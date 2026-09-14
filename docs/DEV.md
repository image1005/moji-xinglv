# 开发文档

## 架构总览

```
浏览器（Nuxt 4 / Vue 3）
  ├─ app/composables/useWorkspace.ts   工作台单例：规划 / 会话 / 消息 / 版本
  ├─ @ai-sdk/vue Chat ──► POST /api/chat（流式，AI SDK v5 协议）
  └─ IndexedDB 缓存（街景 Blob、静态图、POI JSON，TTL + LRU）

Nitro（Bun 运行时）
  ├─ server/agents/        Mastra Agent + 7 个工具（全部以 planId 作用域校验）
  ├─ server/services/      plan / conversation / cache / baidu / agents-md
  ├─ server/api/           REST 路由（Zod 校验入参）
  └─ SQLite（bun:sqlite + Drizzle，单一写入者）
```

关键数据流：

1. **AI 编辑**：`patch_plan_json(patch)` → 服务端 RFC 7396 合并 → `PlanSchema` 校验 →
   写入 `plan_versions`（version 自增、parent、diff、message_id）→ 更新 `plans.plan_json` →
   工具返回 `preview` → 聊天流渲染预览卡片 → 流结束回写 assistant 消息。
2. **Undo**：读取目标版本 → 以它的内容**新建**版本（`source=rollback`，parent 指向目标）→
   插入系统消息 + 预览卡片；历史永不删除。
3. **百度请求**：`hashKey(api, params)` → Nitro storage → SQLite（panorama 存 `panoramas` 表 /
   静态图与 JSON 存 `cache` 表）→ 未命中才带 AK 请求百度 → 回写。前端再包一层 IndexedDB。

## 目录与关键文件

| 路径 | 职责 |
| --- | --- |
| `shared/schemas/plan.ts` | 行程 JSON 唯一 Zod schema 与类型；改动需同步 `docs/PRD.md` |
| `shared/utils/{merge-patch,diff,hash,json}.ts` | patch 合并、结构化 diff、缓存键、稳定序列化 |
| `server/database/schema.ts` | 全部 Drizzle 表；auth 四表由 CLI 生成（`auth-schema.ts`） |
| `server/agents/tools.ts` | Mastra 工具集（含 planId 越权校验） |
| `server/agents/travel-agent.ts` | 按请求构建 Agent（模型配置 + system prompt 注入） |
| `server/api/chat.post.ts` | 流式聊天：消息持久化 + 流观察器 + finish 回写 |
| `app/composables/useWorkspace.ts` | 前端唯一状态源（工作区树 / 会话 / 消息 / 版本，单例 composable） |
| `app/components/WorkspaceSidebar.vue` | 左栏：新会话、可折叠工作区文件夹、搜索/排序、设置 |
| `app/components/MainPanel.vue` | 主区模式路由：对话 ⇄ 规划预览与编辑 ⇄ 设置 |
| `app/components/ConversationView.vue` | 对话/轨迹页签 + 输入区（保存 / 停止 / 发送） |
| `app/components/PlanWorkspaceView.vue` | 行程 / 地图 / 街景 / JSON / AGENTS.md |
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
- **AI 只产 patch**：工具入参、输出、最终 JSON 全链路 Zod 校验；禁止用模型文本整体覆盖 `plan_json`。
- **密钥边界**：`BAIDU_MAP_AK` 只允许在 `server/services/baidu.ts` 读取；
  前端产物不得出现 AK / AUTH_SECRET / AI_API_KEY 的**值**。
- **页面缓存（KeepAlive）**：`/` 与 `/admin` 通过 `definePageMeta({ keepalive: true })` 保留页面本地状态
  （输入框、滚动位置、Tab 选择）；`useWorkspace` 是模块级单例，**退出登录必须调用
  `resetWorkspace()` + `clearUser()`**，否则换号后会复用上一位用户的数据。
  返回页面后需要新数据时用 `onActivated` + 一次性 guard 刷新（参考 `admin/index.vue`）。
- **Windows 跨平台**：npm scripts 不使用 `rm` / `cp` 等 POSIX 命令。

## 测试

- `tests/`：Vitest 单测 + 内联快照（merge patch、diff、缓存键）
- `bun run scripts/smoke.ts`：端到端冒烟（登录、CRUD、保存、回滚、权限、代理降级），
  需要先 `bun dev`，可用 `SMOKE_BASE` 指向其他环境
- 完成定义：`bun run lint` + `bun run typecheck` + `bun run test` 全绿，构建通过

## 常见改法

- **加一个 AI 工具**：在 `server/agents/tools.ts` 用 `createTool`（`inputSchema` 必须含 `planId` 并
  `ensureScope`），注册进返回对象；若产生新版本，返回值带上 `preview` 与 `versionId`。
- **加一个 API**：`server/api/**` 新建路由，用 Zod 校验入参、`requireUser/requireAdmin` 鉴权、
  业务逻辑放 `server/services/`。
- **调整行程字段**：改 `shared/schemas/plan.ts` → 跑测试 → 迁移（若涉及 DB 列）→ 更新 `docs/PRD.md` 与预览卡片展示。
- **新增缓存源**：在 `server/services/cache.ts` 提供 get/set，键用 `hashKey(api, params)`，
  并考虑前端 `idb.ts` 是否需要对应缓存。

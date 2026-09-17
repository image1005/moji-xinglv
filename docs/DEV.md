# 山海行笺开发文档

## 架构总览

```
浏览器（Nuxt 4 / Vue 3）
  ├─ app/composables/useWorkspace.ts   按 Nuxt app 隔离的工作区状态：规划 / 会话 / 消息 / 版本
  ├─ @ai-sdk/vue Chat ──► POST /api/chat（流式，AI SDK v5 协议）
  ├─ usePlanDraft / localStorage（用户 + 规划 + 对象草稿，记录原 revision）
  └─ IndexedDB 缓存（图片、规划快照，TTL + 字节容量 + 访问索引；POI 仅检索当前规划）

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
   工具执行侧维护读取时 revision，事务提交后推进；409 必须重读。预览与版本引用在规划提交事务内写入助手消息。AI 不提供全量覆盖工具。
2. **切换版本（Undo）**：校验当前 `expectedVersion`、`expectedRevision` 与会话归属 → 读取目标版本 → 设置当前规划快照与 `current_version_id`，递增 revision（**不新建版本**）→ 同事务插入系统消息与预览。
   历史永不删除；过期写入返回 409。切换后继续编辑会以 `max(version)+1` 追加版本、以当前版本为父，版本路线图据此分叉。
3. **百度请求**：相同参数单飞去重 → `hashKey(api, params)` → Nitro storage → SQLite `cache` 表 → 未命中才带 AK 请求百度 → 回写。二进制 L1 使用可序列化 base64 与绝对过期时间，L2 命中回填剩余 TTL；前端再包一层按用户隔离的 IndexedDB。历史 `panoramas` 表保留兼容，但新图片统一使用 `cache`。
   仅允许 `staticimage/v2` 与 `panorama/v2`，不使用在线 POI、路线导航或浏览器地图 SDK。
4. **生成与恢复**：先以 `(userId, requestId)` 在 `chat_runs` 去重、分配并发/队列名额，再追加用户/助手消息。工具结果和周期检查点落库，终态幂等收尾；重启将活动任务标记 interrupted。恢复只读取已有结果，明确新一轮才换 requestId。输入处理器每次模型调用都计算规则、工具、历史和工具结果的字节预算。

## 目录与关键文件

| 路径 | 职责 |
| --- | --- |
| `shared/schemas/plan.ts` | 行程 JSON 唯一 Zod schema 与类型；改动需同步 `docs/PRD.md` |
| `shared/utils/{merge-patch,diff,hash,json}.ts` | patch 合并、结构化 diff、缓存键、稳定序列化 |
| `server/database/schema.ts` | 全部 Drizzle 表；auth 四表由 CLI 生成（`auth-schema.ts`） |
| `server/agents/tools.ts` | Mastra 工具集：get_plan / apply_plan_edits / patch_plan_json（兜底）/ get_panorama / search_poi（含 planId 越权校验） |
| `server/agents/travel-agent.ts` | 按请求构建 Agent（模型配置 + system prompt 注入） |
| `server/api/chat.post.ts` | 流式聊天：消息持久化 + 流观察器 + finish 回写 |
| `server/services/{ai-context,ai-history,chat-runs,metrics}.ts` | 分段上下文、可信需求历史、持久任务/额度、聚合服务指标 |
| `server/agents/model-budget.ts` | 每次模型调用的完整输入字节预算与裁剪 |
| `server/database/operations.ts` | `chat_runs` / `usage_metrics` 表定义 |
| `app/composables/useWorkspace.ts` | 前端唯一状态源（工作区树 / 会话 / 消息 / 版本，按 Nuxt app 实例隔离，拒绝过期响应写回） |
| `app/components/WorkspaceSidebar.vue` | 左栏：新会话、可折叠工作区文件夹、搜索/排序、设置 |
| `app/components/MainPanel.vue` | 主区模式路由：对话 ⇄ 规划预览与编辑 ⇄ 设置 |
| `app/components/ConversationView.vue` | 对话/版本路线页签 + 输入区（保存 / 停止 / 发送） |
| `app/components/PlanWorkspaceView.vue` | 行程总览 / 路线舆图 / 风物食记 / 沿途街景 / 旅行偏好（无 JSON 源码编辑，全部可视化） |
| `app/composables/usePlanDraft.ts` | 本地草稿持久化与 KeepAlive 工作区绑定 |
| `app/utils/{draft-storage,draft-merge}.ts` | 草稿身份/过期隔离、只应用本地修改字段的显式合并 |
| `app/components/DraftRecovery.vue` | 未保存提示、最新内容对比与重新应用入口 |
| `app/utils/idb.ts` | 用户隔离的 TTL / 字节 / 条数缓存，元数据索引淘汰与订阅式请求去重 |
| `shared/utils/plan-review.ts` | 不依赖外部服务的确定性行程检查 |

## 数据库

- 鉴权：`user` / `session` / `account` / `verification`（Better Auth CLI 生成，勿手改；
  修改鉴权配置后运行 `bunx --bun @better-auth/cli generate --config <auth.ts> --output server/database/auth-schema.ts`）
- 业务：`plans`（含 revision）、`plan_versions`、`panoramas`（历史兼容）、`cache`、`conversations`、`messages`、`agents_md`、`chat_runs`、`usage_metrics`
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
- **乐观锁**：保存、资料修改和切换应携带读取时的 `expectedVersion` / `expectedRevision`；同一事务校验并写入。revision 随有效修改前进，包括同轮 AI 原地更新、Markdown 资料变更及版本切换，不能由版本号代替。无变化保存也先检查已传值。409 保留草稿，比较后明确重新应用；旅行偏好独立发送 expectedVersion，不存在时为 0。
- **版本指针**：当前版本 = `plans.current_version_id`（为兼容历史数据，指针为空时回退到最新版本）。切换版本只改指针与规划快照；新版本编号取 `max(version)+1`，因此切换后继续编辑可能跳号并在路线图中分叉。
- **地图边界**：只允许静态图与 panorama 服务端代理。POI 仅检索当前规划；未知坐标不生成地图请求、不由 AI 猜测。路线只是景点顺序连线，不是导航；无 key 提示降级，不阻断行程编辑。
- **密钥边界**：`BAIDU_MAP_AK` 只允许在 `server/services/baidu.ts` 读取；
  前端产物不得出现 AK / AUTH_SECRET / AI_API_KEY 的**值**。
- **页面缓存（KeepAlive）**：`/` 与 `/admin` 通过 `definePageMeta({ keepalive: true })` 保留页面本地状态
  （输入框、滚动位置、Tab 选择）；`useWorkspace` 按 Nuxt app 实例隔离，不能使用跨 SSR 请求的模块级单例。
  **退出登录必须调用 `resetWorkspace()` + `clearUser()`**，并使在途响应失效，避免旧请求复写换号后的数据。
  切换工作区 / 会话时同样验证请求归属；返回页面后需要新数据时用 `onActivated` + 一次性 guard 刷新（参考 `admin/index.vue`）。
- **规划面板绑定**：KeepAlive 组件用 `useBoundPlan()` 固定原用户和规划，不监听新工作区内容进行隐式编辑或取图。图片 onDeactivated 取消订阅并释放对象 URL；重激活时按视口重新加载。同规划切视图不停止 Chat，跨规划/会话明确停止。
- **草稿与冲突**：草稿存于 localStorage，按用户/规划/对象命名，250ms 防抖并在离开时 flush，30 天到期；写满时提示并继续保留内存内容。对比采用字段列表，不展示 JSON 源码；只将本地变更应用到最新快照，随后仍需保存及 CAS。地点尚无稳定 ID，目标身份变化时拒绝自动重新应用，保留表单供用户核对。
- **分页与快照**：列表使用默认 50 条的作用域游标。服务端工作区 q/sort 覆盖全库；搜索变更取消旧页归属并从首页开始。会话按工作区懒加载；消息加载更早记录时保持滚动位置，版本按需加载，不用未加载节点推断完整父链。保存后更新当前规划及对应条目，避免全账号列表刷新。规划快照先显示再网络校验；仅网络故障降级只读，401/403/404 清理旧快照。
- **缓存容量**：前端 48 MiB / 300 条，独立 metadata store 记录 size、expiresAt、lastAccess，淘汰只扫描元数据索引，不每次读取所有 Blob。同 URL 共享请求，最后订阅取消才中止。后端默认 512 MiB，定时按批删除过期及最早创建记录；容量通过后续批次收敛。调整上限在 `.env.example` 的 `CACHE_MAX_BYTES`。
- **Windows 跨平台**：package scripts 不使用 `rm` / `cp` 等 POSIX 命令；最低 Bun 版本为 1.4（`bun.lock` 为 lockfileVersion 2）。

## 测试

- `tests/`：Vitest 单测 + 内联快照（schema、merge patch、diff、缓存键与相关回归）。
- `bun run check`：依次执行 lint、typecheck、test；另执行 `bun run build`。CI 使用 Bun ≥ 1.4、`bun install --frozen-lockfile`、dummy 配置与独立测试数据库，不使用 npm，不运行真实服务 smoke。
- `bun run smoke`（`bun run scripts/smoke.ts` 的别名）：先启动使用独立测试数据库的 `bun dev`，显式提供已有测试账号 `SMOKE_EMAIL` / `SMOKE_PASSWORD`。默认 `SMOKE_BASE=http://localhost:3000`，只允许 localhost / 127.0.0.1；远端必须获授权并设置 `SMOKE_ALLOW_REMOTE=true`。`SMOKE_TIMEOUT_MS` 默认 15000，覆盖请求与响应体读取。
- smoke 创建随机标记的独立临时规划与会话，断言 schema 默认值、美食 / 清单持久化、真实内容、400 / 409、v1→v2→v3 与系统消息；finally 只删除本次创建的规划，并验证会话级联清理。不注册用户、不修改全局或规划偏好、不请求 AI / 百度。不针对真实业务 DB 执行。
- smoke 退出码：0 全部通过、1 检查或清理失败、2 配置错误。清理失败会报告本次规划 ID；进程被强制终止或创建响应丢失时仍须人工检查本次随机标记，禁止批量删除其他资源。
- `bun run test:integration`（`scripts/verify-isolated.ts`）：构建后生成临时 SQLite 与随机凭据，启动回环生产服务并执行 HTTP 验收；最后只停止自身服务及清理自身临时目录，不读写 `data/app.db`。脚本只调整自身代理环境，避免回环请求经过本机代理。
- `bun run test:browser`：构建后以 Playwright Chromium、临时数据库和回环模拟 AI 检查草稿恢复/409、同规划生成连续性、版本、移动端与身份隔离。报告与截图写入 `.verification/browser/<时间>/`，失败仍保留诊断。首次安装用 `bunx playwright install chromium`；CI 用 `--with-deps`。不得把模拟模型通过作为真实供应商验收。
- `bun run test:recovery`：构建后在私有临时数据库中让真实 AI 工具完成提交，再强制终止脚本自身启动的服务并同库重启，验证预览恢复、任务中断、重复请求不重放及新请求可继续。仅使用本地 SSE 模拟模型，报告在 `.verification/recovery/<时间>/`。
- `bun run check:release`：按顺序运行 check、build、test:integration、test:recovery、test:browser；需要预先安装 Chromium，不启用真实供应商评测。
- `bun run eval:ai`：固定样例验证结构化编辑契约，默认无外部调用。真实评测必须同时设置 `EVAL_LIVE=true` 并传 `--live`，受 `EVAL_MAX_CASES` 限制，使用临时数据库；未运行时不报告模型准确率或 token 节约幅度。
- 聊天回归覆盖不可信历史过滤、活动规划锁、失败/取消单次收尾及工具输出版本关联；影像代理回归覆盖响应脱敏、文件签名、体积上限及并发去重。它们是隔离测试，不替代真实模型/百度联调。
- 验收结论以本次实际命令的退出码与输出报告为准；未运行 smoke、浏览器、AI 或百度实测时须明确说明，不能由 lint / 单测推断已经验收。

## 备份与部署边界

当前运行协调按单实例服务设计，不支持启动多个实例共享数据库后各自执行重启恢复。`AI_*` 并发、队列和周期额度只约束本应用请求，不代表供应商余额。

`bun run db:backup --source <数据库> --output <新文件>` 用 SQLite `VACUUM INTO` 创建包含已提交 WAL 数据的一致性快照，拒绝源文件、日志文件及已有目标。`bun run db:restore:verify --backup <备份>` 只在新临时副本执行 integrity_check、foreign_key_check 与关键表计数，随后清理该临时副本。备份目录默认 `BACKUP_DIR=./backups`；正式恢复替换生产库仍属于部署维护操作，应单独安排停机与回滚。

本轮实现、限制和最终验证结果统一记录在 [OPTIMIZATION_IMPLEMENTATION.md](OPTIMIZATION_IMPLEMENTATION.md)。

## 常见改法

- **加一个 AI 工具**：在 `server/agents/tools.ts` 用 `createTool`（`inputSchema` 必须含 `planId` 并
  `ensureScope`），注册进返回对象并同步 `server/agents/tool-names.ts`；若产生新版本，返回值带上 `preview` 与 `versionId`。
- **加一个 API**：`server/api/**` 新建路由，用 Zod 校验入参、`requireUser/requireAdmin` 鉴权、
  业务逻辑放 `server/services/`。
- **调整行程字段**：改 `shared/schemas/plan.ts` → 跑测试 → 迁移（若涉及 DB 列）→ 更新 `docs/PRD.md` 与预览卡片展示。
- **新增缓存源**：在 `server/services/cache.ts` 提供 get/set，键用 `hashKey(api, params)`，
  并考虑前端 `idb.ts` 是否需要对应缓存。

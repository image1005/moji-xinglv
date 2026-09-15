<div align="center">

# 山海行笺

**国风旅游行程规划智能体 —— 与 AI 对话，落笔成行程**

<p>
  <img src="https://img.shields.io/badge/Nuxt-4.5-00DC82?logo=nuxtdotjs&logoColor=white" alt="Nuxt 4">
  <img src="https://img.shields.io/badge/Bun-%E2%89%A51.4-14151A?logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/Mastra-Agent-6D28D9" alt="Mastra">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License MIT">
</p>

以工作区对话与 AI 对话，生成、修改、保存行程 JSON；版本可切换
视觉语言为宣纸 / 墨 / 朱砂 / 竹青 / 鎏金的东方古典风格

[快速开始](#快速开始) · [功能特性](#功能特性) · [技术栈](#技术栈) · [API 文档](docs/API.md) · [开发文档](docs/DEV.md) · [贡献指南](#贡献指南) · [Issues](https://github.com/image1005/moji-xinglv/issues) · [Pull requests](https://github.com/image1005/moji-xinglv/pulls)

</div>

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [环境变量](#环境变量)
- [项目结构](#项目结构)
- [界面与工作流](#界面与工作流)
- [测试与验收](#测试与验收)
- [部署](#部署)
- [安全](#安全)
- [文档索引](#文档索引)
- [贡献指南](#贡献指南)
- [License](#license)

## 功能特性

**工作区工作台**

- 左栏为可折叠的工作区文件夹（工作区 = 规划），支持搜索、按更新时间 / 创建时间排序、新建与删除
- 每个工作区：顶部「规划预览与编辑」入口 + 该工作区的多个会话（持久化存储，可切换 / 新建 / 删除）
- 主区在「对话 / 版本路线」与「规划预览与编辑」之间切换；设置视图包含全局 AGENTS.md、账号与退出
- 移动端左侧栏折叠为抽屉

**AI 编辑与版本**

- AI 通过当前工作区作用域内的 Mastra 工具读取规划、提交原子编辑（`apply_plan_edits`）、兜底 patch、获取街景及检索本地景点；不提供全量覆盖工具
- 编辑不强制先读取：工具直接作用于最新内容，`expectedVersion` 为可选乐观锁，冲突返回 409 由模型重读重试
- 只接受结构化 patch（RFC 7396），服务端 Zod 校验后合并生成新版本，禁止用模型文本整体覆盖
- 字段契约为严格模式：未知字段返回 400 并给出改名提示（如 `stay → lodging`），不静默丢弃；全部字段在可视化表单中编辑，不提供 JSON 源码编辑
- 保存与切换版本携带 `expectedVersion` 乐观锁；过期版本返回 409，重新读取后处理冲突，避免多标签页或 AI 与手工编辑互相覆盖
- 行程新增 `foodJournal` 美食手账与 `checklist` 出行清单（默认空数组）；景点支持地址、类别、停留时长、花费，未知经纬度为 `null`，由用户人工补全
- 聊天流每次编辑插入可视化预览卡片（摘要 / 每日安排 / 街景缩略图，可复制、Diff、切换版本）
- 版本只增不减：历史永不删除；「切换到此版本」只移动当前版本指针，之后编辑会从该版本分叉（版本路线图可视化）
- 一轮对话只保留一个版本：同一轮内的多次原子编辑合并到同一版本，避免版本噪声
- 「版本路线」页签：以多叉树展示版本脉络，支持缩放、平移与点击节点直接切换当前版本

**账号与后台**

- Better Auth（邮箱密码）+ RBAC：user / admin
- 后台 `/admin`：用户管理（角色、封禁）、规划管理、缓存管理、百度调用统计
- admin 登录后自动跳转 `/admin`，由服务端中间件与 API 双重校验

**百度代理与双层缓存**

- 百度能力仅服务端代理静态图 `staticimage/v2`（含标记与每日顺序连线）+ 街景 `panorama/v2`，AK 不进前端
- 顺序连线不是道路导航，不提供导航路线或预计用时；POI 只在当前规划已有景点中本地检索，不调用在线搜索
- 未知坐标保持 `null` 并提示人工补全；未配置地图 key 时友好提示，行程 / 美食 / 清单仍可编辑
- 后端：Nitro storage（L1）+ SQLite `cache` / `panoramas` 表（L2），`key = hash(api + params)`，校验 `expires_at`
- 前端：IndexedDB 缓存街景 Blob 与 JSON（TTL + LRU），重复查看不再请求百度
- 响应头 `x-cache: HIT/MISS` 可直接验证缓存命中

**AGENTS.md 偏好注入**

- 优先级：工作区级 > 全局 > 系统默认；支持 `{{nickname}}`、`{{currency}}` 占位符
- 服务端拼装 system prompt，带长度上限与注入指令过滤

## 技术栈

| 层面 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Bun | 唯一指定运行时；Nuxt 脚本经 `bun --bun`，生产运行 `bun .output/server/index.mjs` |
| 框架 | Nuxt 4（Vue 3 + TypeScript strict） | SSR + 文件路由，国风 SCSS |
| Agent | Mastra | 受限工具集；按请求注入当前工作区上下文与偏好，AI 只提交 patch |

## 快速开始

前置要求：Bun ≥ 1.4（安装后请**重开终端**使 `bun` 进入 PATH）

```powershell
# 1. 安装 Bun（若未安装）
powershell -c "irm bun.sh/install.ps1 | iex"

# 2. 安装依赖（Windows 优先镜像源，见 bunfig.toml；必要时设置代理 $env:HTTP_PROXY）
bun install

# 3. 准备环境变量
Copy-Item .env.example .env

# 4. 先在 .env 中设置 AUTH_SECRET、SEED_ADMIN_EMAIL 与 SEED_ADMIN_PASSWORD
#    再初始化数据库与种子数据（含初始管理员，不使用公开默认密码）
bun run db:migrate
bun run db:seed

# 5. 启动
bun dev
```

打开 http://localhost:3000：

- 管理员使用自行配置的种子账号登录，登录后自动进入 `/admin`；登录页不公开默认密码
- 普通账号注册后进入工作台
- 未配置 `BAIDU_MAP_AK` 时地图 / 街景返回 501；未配置 `AI_API_KEY` 时聊天返回 501，其余功能不受影响

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `bun dev` | 启动开发服务器（内部以 `bun --bun nuxt dev` 强制 Bun 运行时，`bun:sqlite` 依赖它） |
| `bun run build` / `bun run preview` | 生产构建 / 预览 |
| `bun run db:generate` | drizzle-kit 生成迁移 |
| `bun run db:migrate` | 应用迁移（`server/database/migrate.ts`） |
| `bun run db:seed` | 种子数据：admin 账号、示例规划、默认全局 AGENTS.md |
| `bun run check` | 顺序执行 lint、typecheck、test |
| `bun run lint` / `bun run typecheck` / `bun run test` | ESLint / vue-tsc / Vitest |
| `bunx vitest run <file> -t "<name>"` | 运行单个测试 |
| `bun run smoke` | 隔离冒烟（别名 `bun run scripts/smoke.ts`；需先启动独立测试环境并显式配置凭据） |
| `bun run preview:readme` | 以 GitHub 样式本地预览 README（生成 `.preview/readme.html`） |

> **运行时必须是 Bun**：直接用 Node 跑 `nuxt dev` 会报 `Received protocol 'bun:'`
> 所有 Nuxt 脚本已内置 `bun --bun`；生产运行请使用 `bun .output/server/index.mjs`

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `BAIDU_MAP_AK` | 百度服务端 AK；全景需申请 “for server” 类型。仅 `server/services/baidu.ts` 读取 |
| `AUTH_SECRET` / `BETTER_AUTH_URL` | Better Auth 会话密钥与外部地址 |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | 显式配置种子管理员；不在页面或文档公开密码 |
| `SMOKE_EMAIL` / `SMOKE_PASSWORD` | 已有专用测试账号凭据，smoke 无默认值 |
| `SMOKE_BASE` / `SMOKE_ALLOW_REMOTE` | 默认 `http://localhost:3000`；非 localhost/127.0.0.1 须显式设置 `SMOKE_ALLOW_REMOTE=true` |
| `SMOKE_TIMEOUT_MS` | 每个请求（包括响应体）的超时，默认 15000ms，范围 1–120000 |
| `DATABASE_URL` | SQLite 文件路径，形如 `file:./data/app.db` |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | OpenAI 兼容 LLM（默认 DeepSeek：`https://api.deepseek.com/v1` + `deepseek-chat`） |

应用配置参考 `.env.example`；smoke 变量仅在专用测试环境中设置。密钥只写入本地 `.env`（已在 `.gitignore` 中忽略）或安全环境变量，不提交账号凭据。

## 项目结构

```
app/                       # Nuxt 4 前端
  pages/                   # / 工作台、/login、/admin/**
  components/              # WorkspaceSidebar / MainPanel / ConversationView / PlanWorkspaceView / SettingsView …
  composables/             # useWorkspace（工作区 / 会话 / 消息 / 版本）、useCurrentUser
  utils/idb.ts             # IndexedDB 缓存（TTL + LRU）
  assets/styles/           # 国风设计令牌 SCSS
server/
  api/                     # REST 与流式聊天入口（Zod 校验 + RBAC）
  services/                # plan / conversation / cache / baidu / agents-md
  agents/                  # Mastra Agent 与工具集
  database/                # Drizzle schema、迁移、migrate / seed 脚本
  middleware/              # /admin 路由守卫
shared/                    # 前后端共享：plan Zod schema、merge-patch / diff / hash
scripts/smoke.ts           # 端到端冒烟测试
tests/                     # Vitest 单测与快照
docs/                      # PRD / API / DEV 文档
LICENSE                    # MIT
```

## 界面与工作流

- 工作区 = 规划：每个工作区包含一份行程 JSON 与多个会话；会话必须归属某个工作区（无「未分组」）
- 左栏：可折叠工作区文件夹（搜索 / 排序 / 新建），文件夹内第一项为「规划预览与编辑」，其后为会话列表；底部为「设置」
- 主区「对话」：流式回复、工具调用卡片、预览卡片（复制 / Diff / 切换版本 / 保存）；底部输入区带保存按钮
- 主区「版本路线」：版本多叉树，可缩放平移、点击节点切换当前版本；切换不新建版本
- 主区「规划预览与编辑」：行程总览 / 路线舆图 / 风物食记 / 沿途街景 / 旅行偏好五个页签；出行清单纳入行程总览，全部字段可视化编辑（不提供 JSON 源码编辑）
- 设置：全局 AGENTS.md、账号信息、后台入口（admin）、退出登录

## 测试与验收

```bash
bun run check       # lint + typecheck + test
bun run build       # 生产构建
```

需要 API 冒烟时，先以**独立测试数据库**启动服务，并显式配置已有测试账号的 `SMOKE_EMAIL` / `SMOKE_PASSWORD`，再执行 `bun run smoke`。不得指向真实业务数据库；默认仅允许 localhost / 127.0.0.1，获授权的远端测试环境须额外设置 `SMOKE_ALLOW_REMOTE=true`。

smoke 只创建带随机标记的临时规划与会话，检查真实内容、默认字段、保存 / 切换版本、400 / 409 与分叉版本链，最后仅删除本次创建的规划并验证级联清理；不注册用户、不改任何偏好、不调用 AI / 百度。每个请求有超时，退出码为 0（通过）、1（检查或清理失败）、2（配置错误）。强制终止或创建响应丢失时需按随机标记人工检查残留。

CI 仅使用 dummy 配置与测试数据库，执行 `bun install --frozen-lockfile`、`bun run check` 和构建，不运行真实服务 smoke。

**以下为验收标准及检查方法，不代表本次已全部验证；结果以本次实际命令的输出报告为准。未运行的浏览器、AI、地图与端到端检查必须单独注明。**

| 验收标准 | 实现 / 验证方式 |
| --- | --- |
| `bun install && bun dev` 可运行，`bun run build` 可构建 | 执行检查与构建；独立测试环境另行运行 `bun run smoke`，据实际输出报告 |
| 百度 AK 不出现在前端 | 仅服务端代理；构建后扫描前端产物，不将设计约束视为已验收 |
| 重复请求命中缓存，不重复调用百度 | `cache` 表 + `panoramas` 表 + 前端 IndexedDB；响应头 `x-cache: HIT/MISS` |
| AI 连续编辑 JSON，每次出现预览 | 工具返回 `preview`，聊天流渲染 `PreviewCard`，落库 `messages.preview_json` |
| 规划可保存 / 排序 / 编辑 / 删除 / 版本切换 | 左栏工作区 CRUD + 版本历史 + 版本路线图（只增不减） |
| 后台账号登录自动跳转 `/admin` | 登录页按角色跳转；`server/middleware/admin-guard.ts` + API `requireAdmin` 双重校验 |
| 国风工作区布局（dsh 式两栏） | 可折叠工作区文件夹 + 对话 / 版本路线 + 规划预览编辑，印章按钮，移动端抽屉 |

## 部署

1. `bun install && bun run build`，产物位于 `.output/`
2. 设置生产环境变量（务必更换 `AUTH_SECRET` 与种子管理员密码），执行 `bun run db:migrate`
3. 启动：`bun .output/server/index.mjs`（默认 3000 端口，可用 `PORT` / `HOST` 覆盖）
4. 反向代理建议：Nginx / Caddy 转发至该端口；`/api/chat` 需允许流式响应（关闭代理缓冲）
5. SQLite 数据文件与 Nitro cache 目录需可写并纳入持久化

## 安全

- `BAIDU_MAP_AK` 只允许在 `server/services/baidu.ts` 读取；前端 bundle 不含 AK / `AUTH_SECRET` / `AI_API_KEY` 的值
- 密钥仅存 `.env`（已忽略提交），并保持 `.env.example` 同步
- `/admin/**` 由服务端 middleware 与 API 双重校验，角色以服务端 Session 为准

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/PRD.md](docs/PRD.md) | 产品规格、数据模型、验收标准与决策记录 |
| [docs/API.md](docs/API.md) | 接口清单、参数说明与缓存约定 |
| [docs/DEV.md](docs/DEV.md) | 架构、数据流、编码约定与扩展指南 |
| [AGENTS.md](AGENTS.md) | 面向 AI / 自动化协作者的项目约束与命令接口 |

## 贡献指南

欢迎提交 [Issue](https://github.com/image1005/moji-xinglv/issues) 与 [Pull Request](https://github.com/image1005/moji-xinglv/pulls)。仓库地址：https://github.com/image1005/moji-xinglv

1. Fork [本仓库](https://github.com/image1005/moji-xinglv)，基于 `main` 新建分支：`feat/xxx`、`fix/xxx`、`docs/xxx`
2. 遵循 [docs/DEV.md](docs/DEV.md) 的约定：Bun 是唯一运行时、所有 API 入参用 Zod 校验、所有数据库写入走 Drizzle、Nuxt 脚本保持 `bun --bun`
3. 提交前确保通过：

```bash
bun run check
```

4. 涉及接口或版本逻辑的改动，按「测试与验收」配置独立测试数据库与显式测试凭据后执行 `bun run smoke`；缓存 / 对话流仍需各自实测，smoke 不代替 AI / 百度验收
5. 提交 PR 时请说明：变更动机、影响范围、验证方式；提交信息建议使用 Conventional Commits（如 `feat: 支持会话重命名`）


## License

[MIT](LICENSE) © 2026 山海行笺

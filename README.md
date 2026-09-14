<div align="center">

# 墨迹行旅

**国风旅游行程规划智能体 —— 与 AI 对话，落笔成行程**

<p>
  <img src="https://img.shields.io/badge/Nuxt-4.5-00DC82?logo=nuxtdotjs&logoColor=white" alt="Nuxt 4">
  <img src="https://img.shields.io/badge/Bun-%E2%89%A51.4-14151A?logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/Mastra-Agent-6D28D9" alt="Mastra">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License MIT">
</p>

以工作区对话与 AI 对话，生成、修改、保存行程 JSON；版本可回滚
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
- 主区在「对话 / 轨迹」与「规划预览与编辑」之间切换；设置视图包含全局 AGENTS.md、账号与退出
- 移动端左侧栏折叠为抽屉

**AI 编辑与版本**

- AI 通过 Mastra 工具读写行程 JSON：`get_plan`、`create_plan`、`patch_plan_json`、`update_plan_json`、`get_panorama`、`search_poi`、`save_plan`
- 只接受结构化 patch（RFC 7396），服务端 Zod 校验后合并生成新版本，禁止用模型文本整体覆盖
- 聊天流每次编辑插入可视化预览卡片（摘要 / 每日安排 / 街景缩略图，可复制、Diff、Undo）
- 版本只增不减：`source = ai | user | rollback`；Undo 基于历史版本新建版本并插入系统消息
- 「轨迹」页签记录工具调用与系统事件时间线

**账号与后台**

- Better Auth（邮箱密码）+ RBAC：user / admin
- 后台 `/admin`：用户管理（角色、封禁）、规划管理、缓存管理、百度调用统计
- admin 登录后自动跳转 `/admin`，由服务端中间件与 API 双重校验

**百度代理与双层缓存**

- 百度能力全部服务端代理：静态路线图 `staticimage/v2`（含标记与每日连线）+ 街景 `panorama/v2`，AK 不进前端
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
| Agent | Mastra | Agent + 7 个工具；按请求注入当前工作区上下文与偏好 |

## 快速开始

前置要求：Bun ≥ 1.4（安装后请**重开终端**使 `bun` 进入 PATH）

```powershell
# 1. 安装 Bun（若未安装）
powershell -c "irm bun.sh/install.ps1 | iex"

# 2. 安装依赖（Windows 优先镜像源，见 bunfig.toml；必要时设置代理 $env:HTTP_PROXY）
bun install

# 3. 准备环境变量
Copy-Item .env.example .env

# 4. 初始化数据库与种子数据（含初始管理员）
bun run db:migrate
bun run db:seed

# 5. 启动
bun dev
```

打开 http://localhost:3000：

- 种子管理员 `admin@example.com` / `admin123456`，登录后自动进入 `/admin`
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
| `bun run lint` / `bun run typecheck` / `bun run test` | ESLint / vue-tsc / Vitest |
| `bunx vitest run <file> -t "<name>"` | 运行单个测试 |
| `bun run scripts/smoke.ts` | 端到端冒烟测试（需先启动 `bun dev`） |
| `bun run preview:readme` | 以 GitHub 样式本地预览 README（生成 `.preview/readme.html`） |

> **运行时必须是 Bun**：直接用 Node 跑 `nuxt dev` 会报 `Received protocol 'bun:'`
> 所有 Nuxt 脚本已内置 `bun --bun`；生产运行请使用 `bun .output/server/index.mjs`

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `BAIDU_MAP_AK` | 百度服务端 AK；全景需申请 “for server” 类型。仅 `server/services/baidu.ts` 读取 |
| `AUTH_SECRET` / `BETTER_AUTH_URL` | Better Auth 会话密钥与外部地址 |
| `DATABASE_URL` | SQLite 文件路径，形如 `file:./data/app.db` |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | OpenAI 兼容 LLM（默认 DeepSeek：`https://api.deepseek.com/v1` + `deepseek-chat`） |

以上变量与 `.env.example` 保持同步；密钥只写入 `.env`（已在 `.gitignore` 中忽略）。

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
- 主区「对话」：流式回复、工具调用卡片、预览卡片（复制 / Diff / Undo / 保存）；底部输入区带保存按钮
- 主区「轨迹」：工具调用与系统事件时间线
- 主区「规划预览与编辑」：行程 / 地图 / 街景 / JSON / AGENTS.md 五个页签
- 设置：全局 AGENTS.md、账号信息、后台入口（admin）、退出登录

## 测试与验收

```bash
bun run lint && bun run typecheck && bun run test   # 代码质量三件套
bun dev                                             # 另开终端
bun run scripts/smoke.ts                            # 端到端冒烟（登录 / CRUD / 版本 / 权限 / 降级）
```

| 验收标准 | 实现 / 验证方式 |
| --- | --- |
| `bun install && bun dev` 可运行，`bun run build` 可构建 | 已验证；`bun run scripts/smoke.ts` 全绿 |
| 百度 AK 不出现在前端 | 仅服务端代理；构建产物已扫描确认无 AK / 密钥值 |
| 重复请求命中缓存，不重复调用百度 | `cache` 表 + `panoramas` 表 + 前端 IndexedDB；响应头 `x-cache: HIT/MISS` |
| AI 连续编辑 JSON，每次出现预览 | 工具返回 `preview`，聊天流渲染 `PreviewCard`，落库 `messages.preview_json` |
| 规划可保存 / 排序 / 编辑 / 删除 / 回滚 | 左栏工作区 CRUD + 版本历史 + Undo（只增不减） |
| 后台账号登录自动跳转 `/admin` | 登录页按角色跳转；`server/middleware/admin-guard.ts` + API `requireAdmin` 双重校验 |
| 国风工作区布局（dsh 式两栏） | 可折叠工作区文件夹 + 对话 / 轨迹 + 规划预览编辑，印章按钮，移动端抽屉 |

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
bun run lint && bun run typecheck && bun run test
```

4. 涉及接口、缓存或对话流的改动，请先启动 `bun dev`，再执行 `bun run scripts/smoke.ts`
5. 提交 PR 时请说明：变更动机、影响范围、验证方式；提交信息建议使用 Conventional Commits（如 `feat: 支持会话重命名`）


## License

[MIT](LICENSE) © 2026 墨迹行旅

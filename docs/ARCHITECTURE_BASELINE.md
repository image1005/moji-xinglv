# 工程基线与渐进迁移记录

## 基线范围

2026-09-18 在 `E:\hbws\moji-xinglv-new\moji-xinglv-main` 重新读取 AGENTS.md、完整 PRD、package.json、bun.lock、入口与实际代码。起始分支 `main`，HEAD `a4047885f432f0b3bb856d88893532d80fb66457`。后续实施使用 `codex/travel-delivery`。

起始用户改动为 `app/components/WorkspaceSidebar.vue`、`app/middleware/admin.ts`、`app/middleware/auth.ts`、`scripts/test-browser.ts`，另有未跟踪 `tests/auth-middleware.test.ts`。未撤销、覆盖或归入清理修改。历史 AGENTS 的“从零搭建”、PRD 的旧三栏描述不能代表实际实现；实际是已有两栏工作台及事务、分页、恢复能力。

## 未修改源码时的实测

| 命令 | 2026-09-18 基线结果 |
| --- | --- |
| `bun --version` | 1.4.2 |
| `bun run lint` | 通过，退出码 0 |
| `bun run typecheck` | Nuxt 与 scripts 两部分通过，退出码 0 |
| `bun run test` | 25 文件、213 测试：182 通过，31 失败 |
| `bun run build` | 通过，Nuxt 4.5.2 / Nitro 2.13.4 / Vite 8.3.0 / Vue 3.5.42；Nitro 总体 22.1 MB，gzip 5.56 MB |

31 个基线失败全部是 Windows 的 `spawnSync bun ENOENT`：本机命令由 npm 安装的 bun.ps1/bun.cmd 启动，Node Vitest worker 的子进程找不到原生 bun.exe。不存在已执行后失败的数据库业务断言。`scripts/test-unit.ts` 将当前 Bun 原生可执行文件目录加入规范化 PATH，然后启动 Vitest 受支持的 Node worker；无需修改业务断言或迁就失败。

构建既有警告：Vue package exports 的 DEP0155、Zod PURE 注释位置、Vite plugin timings。它们没有导致基线构建失败。未用此次构建覆盖或迁移真实数据库。

## 已有业务流程与必须保持的不变量

| 流程 | 代码依据与不变量 |
| --- | --- |
| 登录与工作区 | Better Auth catch-all、`requireUser`/`requireAdmin`、Nuxt middleware；会话必须有所属规划，服务端再次验证用户 |
| 编辑、保存与版本切换 | `server/services/plan.ts` 的 `commitMutation`、`savePlanVersion`、`patchPlan`、`applyPlanEdits`；快照/revision/版本/预览在一个 Drizzle 事务内提交 |
| 同轮 AI 多次编辑 | 仍是当前版本且 assistantMessageId 相同时更新本轮版本；切换指针或换轮才追加，不删除历史 |
| 并发编辑 | expectedVersion 与独立 expectedRevision；旧草稿返回 409，无变化保存也先检查锁 |
| 生成、取消、恢复 | `chat-runs.ts` 用户+requestId、配额/队列；`chat-recovery` Nitro 插件恢复已提交内容和中断状态，不恢复未提交 token |
| 草稿及客户端缓存 | Nuxt 实例承载 workspace 状态；草稿按用户+工作区+对象，缓存按用户、48 MiB/300 条，身份变化终止图片请求 |
| 地图与历史数据 | `baidu.ts` 服务端静态地图/街景代理；`cache.ts` 两级缓存；旧 panoramas 表保留，未知坐标不当作 0,0 |
| 集成和发布 | 隔离 SQLite、独立 Bun 子进程、模拟 AI、浏览器与重启恢复脚本；真实数据库不参与测试 |

## 入口核实与扫描边界

- Nuxt 4：`app/app.vue`、pages、middleware、plugins、layouts，以及模板中的组件标签。组件/组合函数目录整体不是入口。
- 自动导入：`nuxt prepare` 生成的 `.nuxt/imports.d.ts`、components.d.ts 与 Nitro 声明只提供名称映射；只有真实使用才产生扫描引用。
- Nitro：server/api、routes、middleware、plugins、tasks 是框架入口。服务文件由上述入口追踪，不将整个 server 声明为入口。
- 工具：package scripts、CI、Vitest 配置、fixture 的动态 import / 子进程 URL、eval、备份、恢复、模拟 AI、README 预览均检查。迁移和 seed 是部署运维 CLI，单独声明生产入口。
- Drizzle：schema 配置与 migrations/meta journal 是迁移历史；SQL/快照不是 TypeScript 未引用文件，不能据 Knip 删除。
- 静态资源：Nuxt head 链接、模板 src 与 public 文件由浏览器使用，品牌 SVG/PNG/favicon 需人工核对引用与视觉，不能以没有 import 删除。

`check:deadcode` 顺序运行 prepare、Knip 全量及 `--production`。全量能发现无任何消费者的代码；生产扫描去掉测试引用，暴露“只被测试使用”的接口。项目文件包含 app/server/shared，配置、测试和脚本各自纳入全量。未关闭任何 issue 类型，未把全部源码声明入口，未大范围忽略目录。

Knip 6.37.0 的 Nuxt 插件已支持 app 目录和 Vue 模板，但其实测 TS 编译器将声明标识符也当自动导入引用，导致函数从自身文件被合成导入。`scripts/knip-auto-imports.ts` 只替换这一扫描适配：使用 Nuxt 同源 unimport 的 OXC 作用域分析，分开 app 和 server 的生成声明映射。测试确认真实自由变量会导入、声明/局部同名变量不会误算、普通测试文件不继承 Nuxt 全局。Nuxt/模板入口仍由 Knip 自身处理。

精确依赖例外仅 `nuxt`（`bun --bun nuxt` CLI）、`vue-tsc`（Nuxt typecheck 动态执行）、`github-markdown-css`（README 工具按文件路径读取 CSS）；清单说明了实际消费者，未将它们当作未使用依赖删掉。

## 依赖决策

| 依赖 | 用途、兼容与成本 |
| --- | --- |
| Knip 6.37.0（dev） | 成熟入口图扫描、Nuxt/Vue/Drizzle/Vitest 集成；只在本地/CI 执行，浏览器体积 0。锁版本防扫描语义漂移 |
| unimport 6.5.0、oxc-parser 0.150.0（dev） | 修正上述真实扫描盲点，复用 Nuxt/Knip 已安装版本；直接声明避免传递依赖。浏览器体积 0，无业务数据迁移 |
| h3 1.15.11、vue 3.5.42、@ai-sdk/provider 2.0.4 | 实际源码已有显式 import，补直接声明，复用原锁版本，未升级框架/SDK major |
| @ai-sdk/deepseek 1.0.57 | 与 AI SDK v5/provider v2 对齐的官方 provider，处理供应商 reasoning_content 差异，避免另写模型协议实现。仅服务端，AI/Mastra major 保持原值 |
| sharp 0.34.5 | 服务端真实图片解码、尺寸/格式校验与重编码；仅看 MIME/文件名无法完成此要求。Bun 支持、Windows/Linux 预构建原生组件，增加服务器原生包体积，浏览器体积 0 |
| IndexedDB 的 idb/Dexie | 当前 `idb.ts` 的 TTL、容量、请求合并和身份隔离是业务策略；版本 2 的 kv/metadata stores 在用。此轮先删除无消费者 JSON 请求包装，保留已验证的底层缓存，未为缩短少量事务代码增加依赖或更改现有缓存结构 |
| VueUse | 暂不新增；上传/拖拽/粘贴由浏览器标准接口与现有 Vue 生命周期完成，尚无足以覆盖新增依赖成本的重复消费者 |

本机执行 `bun install --frozen-lockfile` 成功，1189 installs / 1332 packages（依赖添加阶段计数）。不代表后续功能验收全部通过，最终验证以交付报告为准。

官方依据：[Knip Nuxt](https://knip.dev/reference/plugins/nuxt)、[Knip production mode](https://knip.dev/features/production-mode)、[Knip project files](https://knip.dev/guides/configuring-project-files)、[sharp 安装与 Bun 支持](https://sharp.pixelplumbing.com/install/)。具体接口同时核对本地安装源码。

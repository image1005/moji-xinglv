# 山海行笺：实际验证记录

## 2026-09-18 架构与图文产品交付

目录 `E:\hbws\moji-xinglv-new\moji-xinglv-main`，实施分支 `codex/travel-delivery`。逐项产品核对和环境边界见 [DELIVERY](DELIVERY.md)，原始清理前结果见 [ARCHITECTURE_BASELINE](ARCHITECTURE_BASELINE.md)。所有 SQLite 验收均使用独立临时数据库，未迁移真实业务库。用户原有鉴权、侧栏和浏览器测试修改完整保留。

| 验证 | 实际结果 |
| --- | --- |
| `bun run check` | 最终复核通过：lint、Nuxt与脚本typecheck、31文件250测试、Knip全量及生产扫描；日志 .verification/delivery/check.log |
| `bun run build` | 生产构建通过，约42.6 MB / 14.1 MB gzip；相比基线新增服务端 sharp/libvips |
| `bun run test:integration` | 11项HTTP断言通过：登录权限、真实行程内容、校验/冲突、版本分支/切换、系统消息和级联清理 |
| `bun run test:recovery` | 5阶段通过：真实工具提交→强制终止自建服务→同库重启→已提交预览/任务中断恢复→重复ID拒绝和新轮可继续 |
| `bun run test:browser` | 10阶段通过：双工作区/表单草稿、刷新、409比较应用、同工作区继续生成、版本切换、移动端焦点/视口、退出换号隔离；无未捕获UI异常 |
| `bun run verify:media` | 旧0002→0003存量附件→0004/0005升级；20类断言通过，含历史保留、真实图片解码、附件多引用/清理/越权、稳定ID/修订写回/不建版本、缓存身份和部分失败保留、真实Mastra纯图两轮 |
| DeepSeek真实探针 | 9请求，8成功合计1435 tokens；文字/视觉/工具/low-high-max/带reasoning的工具回传通过；思考+强制tool_choice为400，生产使用auto |
| Wikimedia真实探针 | 西湖与东坡肉实图成功取得、完整解码，保留作者与许可；详见 [MEDIA_ATTACHMENTS](MEDIA_ATTACHMENTS.md) |
| `bun run test:product` | 最终构建6阶段全通过：纯图上传失败重试→JSONL/搜索/思考max→景点食记图及每日地图/图片503重试→编辑保存/刷新恢复/历史图片追问/关闭搜索+low→浏览器取消与刷新→跨用户和工作区权限/伪图拒绝；无UI异常 |

最终图文浏览器报告：`.verification/product/2026-09-18T14-02-39-225Z/report.json`。6次本地模型请求，5次带真实上传后的图片parts，1次模拟搜索、2次真实结构化行程提交；3次应用聊天均为JSONL且正文不含base64。截图 `illustrated-itinerary.png` 与 `restored-image-history.png` 已人工检查；截图中纯色图及来源文案明确属于隔离夹具。品牌16/32/64/128像素渲染已检查。

最后的188份浏览器JS/HTML/CSS/JSON产物检查未包含已配置的服务端密钥，原auth测试与开始时副本逐字相同。`git diff --check` 通过；现有上游 Vue exports/Zod PURE 构建警告和 H3 statusMessage 长文案提示仍存在，未掩盖为新错误或删除测试规避。

本机报告与日志在 `.verification/delivery`、`.verification/browser`、`.verification/recovery`、`.verification/product`；脚本可复现，CI保留浏览器截图和报告。CI使用显式本地模型/供应商夹具、fixture-only key与临时数据库，夹具图片/来源明确标为测试，不证明真实供应商可达性或识别准确率。尚无 Tavily/百度凭据，需配置相应key后真实联调；没有以假成功补齐报告。

本轮发现并修复的实际故障包括：Windows Bun子进程PATH；Nuxt共享JSONL相对导入SSR打包；Bun structuredClone不能克隆Mastra图片URL；图片误计入文字预算；取消等待revision后仍提交；旧附件引用迁移；稳定实体改名的浏览器缓存错图；第13个派生资源未自动加载。对应测试验证可观察业务结果，不以mock调用次数替代持久化检查。

## 以下为历史记录（截至2026-09-16，不代表当前实现）

下文保留当时证据和修复过程，其中旧架构、测试数量、权限及功能限制已被上方本次记录和现行使用／技术文档替代。

日期：2026-09-16。检查目录：`E:\hbws\moji-xinglv-new\moji-xinglv-main`。目标：理解当前项目并编写 [使用手册](USER_MANUAL.md) 与 [技术实现说明](TECHNICAL_GUIDE.md)。

第 1～5 节保留首次文档编写时的检查记录。随后用户反馈 AI 工具失败，已进行代码修复；最新情况见第 6 节，首次记录中的类型错误已修正。

## 1. 检查范围与证据

阅读了根目录 `AGENTS.md`、README、PRD、已有 API／开发文档，以及前端页面、主要业务组件、工作区状态、共享 Schema、AI Agent／工具、服务端路由、数据库表与迁移、配置及测试代码。

该目录未包含可用的 `.git` 元数据，无法标明 commit 或验证与远端的同步状态。README 标注的项目地址为 `image1005/moji-xinglv`；本次结论仅针对磁盘上的副本。界面与包名使用“山海行笺”，许可证文本仍有“墨迹行旅”名称，交接时应注意命名差异。

本次没有读取 `.env` 中的真实密钥值，没有查询现有业务数据库中的用户内容，没有运行现有库的迁移或种子脚本，也没有调用真实 AI／百度服务。新增文档和 README 文档索引是此次内容改动；构建命令另生成了 `.output` 及框架构建缓存。业务源码保持原样。

## 2. 实际命令结果

| 检查 | 本次结果 | 解释 |
| --- | --- | --- |
| `bun --version` | 通过，1.4.2 | 满足 package.json 声明的 Bun ≥ 1.4.0 |
| `bun run check` 中的 lint | 通过 | 已执行 `eslint .`，进入下一步 |
| `bun run check` 中的 typecheck | 失败 | `PreviewCard.vue(43,40): TS2304 Cannot find name 'preview'`，组合命令在此停止 |
| 单独 `bun run test`，首次 | 96 通过、15 失败，共 111 项 | 15 个持久化用例在 `spawnSync('bun', …)` 阶段报 `ENOENT`，未进入用例主体 |
| 原 `bun run test`，修正临时 PATH 后复核 | **111 项通过，15 个文件全部通过，退出码 0** | Vitest 4.1.11，用时 1.56 秒；未修改测试代码和脚本定义 |
| `bun run build` | 通过，退出码 0 | 生成 `.output`；输出确认 Nuxt 4.5.2、Nitro 2.13.4、Vite 8.3.0、Vue 3.5.42 |
| 浏览器操作／移动端视觉 | 未执行 | 使用手册的界面说明来自组件源码 |
| 真实 AI 工具流／百度影像 | 未执行 | 需要有效外部服务配置与实际请求验收 |
| HTTP smoke／隔离生产服务 | 未执行 | 本次未启动端到端环境 |
| 从零安装／Linux CI／生产部署 | 未执行 | 使用本地已有 node_modules，不等价于全新环境验收 |

构建时通过当前命令进程设置 dummy `AUTH_SECRET`、本机 `BETTER_AUTH_URL`、单独的 `DATABASE_URL=file:./.verification/documentation-build.db`，并将 `AI_API_KEY`、`BAIDU_MAP_AK` 置空。没有改写真实 `.env`。构建配置的 `typescript.typeCheck` 为 `false`，所以构建成功并不代表类型检查通过。

### Windows 测试启动问题

`Get-Command bun -All` 显示常用命令来自 `C:\Users\ASUS\AppData\Roaming\npm\bun.ps1`／`bun.cmd` 包装脚本；文件夹中另有 `E:\hbws\package\bin\bun.exe`。PowerShell 可以执行 `bun --version`，不能证明 Node 测试 worker 的 `spawnSync('bun')` 同样能找到它。

本次尝试过在 PowerShell 的 PATH 前加入该 exe 所在目录，以及用该 exe 的绝对路径运行 test，仍得到相同 `ENOENT`。进一步诊断发现当前 Windows 会话有 `PATH`／`Path` 大小写重复和继承异常：直接 Node 能找到已加入路径的 Bun，经 Bun 启动的 Node 却仍取得旧路径。

把临时子进程环境中的路径键统一为单一 `PATH` 后，先复核持久化文件 15 项通过，再运行原 `bun run test`，得到 15 个文件、111 项全部通过。没有改动项目测试，也没有绕过 Vitest。以下是本次已验证的 PowerShell 启动方式，只影响该测试子进程，不修改系统 PATH：

```powershell
Set-Location 'E:\hbws\moji-xinglv-new\moji-xinglv-main'
$testLauncher = @'
const { spawnSync } = require('node:child_process');
const env = { ...process.env };
const inheritedPath = env.PATH ?? env.Path ?? '';
for (const key of Object.keys(env).filter(key => key.toLowerCase() === 'path')) delete env[key];
env.PATH = 'E:\\hbws\\package\\bin;' + inheritedPath;
const result = spawnSync('E:\\hbws\\package\\bin\\bun.exe', ['run', 'test'], {
  env,
  stdio: 'inherit',
  timeout: 120000
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
'@
node -e $testLauncher
```

Node 仅作为整理临时环境的诊断启动器；应用依旧使用 Bun，Vitest 执行项目原有测试。持久化用例使用原有的内存 SQLite fixture。测试通过不消除上面的独立类型错误，也不代表真实外部服务或浏览器已经验收。

## 3. 已确认的代码问题

### 预览卡片的版本切换引用未定义变量

位置：[app/components/PreviewCard.vue](../app/components/PreviewCard.vue)，第 43 行的 `undo()`：

```ts
if (busy.value || !samePlan.value || preview.version === ws.currentPlan.value?.version) return
```

此处 props 由 `const props = defineProps<...>()` 接收，脚本中不存在独立的 `preview` 变量。点击该卡片的切换按钮可能在发送请求前抛出错误；这是静态检查已证实的问题，浏览器触发本次未实测。

最小修正是改为 `props.preview.version`，其余逻辑保持一致。修正后重新运行 typecheck，并在浏览器验证预览卡片切换到旧版本、当前版本不可重复切换以及取消确认的行为。本次任务是检查与文档编写，尚未修改该业务代码。

用户暂可使用「行程总览 → 行笺留痕」或「版本路线」的独立切换入口；这些组件没有调用该 `undo()` 函数，但本次也未做浏览器验收。

## 4. 交接时必须准确描述的实现边界

| 文档中容易产生的理解 | 当前实现 | 源码依据 |
| --- | --- | --- |
| 所有 AI 对话每轮只产生一个版本 | `apply_plan_edits` 在满足条件时复用本轮当前版本；`patch_plan_json` 调用的 `patchPlan()` 仍每次追加版本 | [plan.ts](../server/services/plan.ts) |
| 每个历史版本都不可变 | 同轮原子编辑会更新该轮仍为当前版本的记录；切换历史本身不删记录 | [plan.ts](../server/services/plan.ts) |
| 传 expectedVersion 就能识别所有并发变更 | 检查的是当前版本号，同号原地更新、切回同号等情况不能全部识别；省略参数不提供客户端旧快照冲突判断 | [plan.ts](../server/services/plan.ts) |
| 版本切换恢复所有内容 | 仅恢复结构化行程；`contentMd`、偏好和聊天不随之回退 | [plan.ts](../server/services/plan.ts)、[schema.ts](../server/database/schema.ts) |
| 规划保存与聊天通知严格原子提交 | 行程版本和当前快照在同一事务；操作说明消息在其后另行写入 | [保存路由](../server/api/plans/[id]/save.post.ts)、[切换路由](../server/api/plans/[id]/switch.post.ts) |
| 工作区偏好叠加全局偏好，且可恢复历史 | 选第一份非空内容，不合并；保存时覆盖内容并递增计数，没有历史正文表和恢复界面 | [agents-md.ts](../server/services/agents-md.ts) |
| 地图支持真实道路导航／自动搜索坐标 | 仅静态图和图片视角调整；直线估算；POI 仅检索当前规划已有已定位地点 | [routes.ts](../shared/utils/routes.ts)、[poi.ts](../server/services/poi.ts) |
| 街景新图写入 panoramas | 新地图和街景都写通用 `cache`，旧 `panoramas` 表保留 | [baidu.ts](../server/services/baidu.ts) |
| 后台可统计真实百度调用量 | 统计旧街景存档和通用 image 缓存条数，`poiQueries` 固定为 0 | [stats.get.ts](../server/api/admin/stats.get.ts) |
| 规划 JSON 已接入浏览器离线缓存 | 有 `fetchJsonCached` 通用函数，但工作区读取直接请求 REST；不能承诺离线恢复规划 | [idb.ts](../app/utils/idb.ts)、[useWorkspace.ts](../app/composables/useWorkspace.ts) |
| 历史聊天和版本在界面无限加载 | 最近 200 条消息、最近 50 个版本；总览只显示其中 10 个；模型历史取最多 60 条有效文本记录 | [conversation.ts](../server/services/conversation.ts)、[chat.ts](../shared/schemas/chat.ts)、[plan.ts](../server/services/plan.ts) |
| 复制对话、另存规划、偏好历史已可操作 | 旧 PRD 提到部分目标，但当前没有对应完整界面／接口流程 | [PRD](PRD.md)、[前端 API 封装](../app/utils/api.ts) |
| `test:integration` 是现有命令 | `.env.example` 有此注释，但 package.json 未注册；目录有独立 `scripts/verify-isolated.ts` | [.env.example](../.env.example)、[package.json](../package.json) |
| 种子必须显式配置密码，没有开发默认回退 | 生产要求显式配置，开发环境缺失变量时仍有代码回退；手册统一要求自行设置，不传播默认口令 | [env.ts](../server/utils/env.ts) |

这些边界有的是产品选择，有的是尚未完成的能力，不能一概视为缺陷。新文档按当前代码描述；旧 README／PRD／API／DEV 的历史表述没有在本次逐段改写，应结合本记录阅读。

## 5. 下一次验收建议

先修复已定位的变量引用，再使用能正确找到 Bun 的进程环境运行项目规定的 lint、typecheck、test。本次测试启动问题已通过临时环境规范化解决；后续如需直接执行命令，可整理开发机的 Bun 安装和 PATH 配置。随后在独立测试数据库中启动生产构建，验证注册登录、保存、版本切换与冲突，并用有效服务配置验证真实对话流、停止生成、预览恢复及地图缓存命中。

另外单独验证长历史加载、同轮 AI 修改与手工编辑交错、后台权限及移动端交互。已有自动化测试可覆盖部分行为，但不能替代这些尚未运行的检查。本记录只陈述本次实际获得的证据，不继承历史“全绿”结论。

## 6. 后续修复：AI 读取／编辑工具显示通用失败

### 确认的原因

用户反馈工具显示“工具执行失败，请重新读取当前规划后重试”。只读检查最近已持久化的工具记录，再对初始版本离线重放参数，发现一轮调用依次出现：

1. 两次空参数 `{}`，缺少 `planId` 和 `edits`。
2. 每日用餐 `meals` 被传成字符串，契约要求字符串数组。
3. 食记 `meal` 使用了不在枚举内的餐次值。
4. 新增清单缺少操作顶层 `text`。
5. 最后一次参数修正后，成功写入 v2。

这说明已检查的一轮中模型服务能够回复并调用工具，最后一次数据库提交也成功。用户反馈的读取失败没有在这份已保存记录中出现对应 `get_plan` 调用，不能据此猜测另一轮的具体入参；但读取工具同样受下面的错误显示缺陷影响。

真正掩盖原因的代码是 `handleChatStream` 的 `onError: () => FAILURE`：真实 SDK 在处理 `tool-error` 时会调用它，原有带 `[actionable]` 的业务报错先被抹掉，后续界面只能显示通用提示。旧测试模拟了整个 `handleChatStream`，没有覆盖这一转换。另一个分支是 Mastra 把入参验证错误包装成普通工具结果；原路由会把它误认为无效编辑预览，读取工具还可能把它当成普通输出。

### 修改范围

- [tool-inputs.ts](../server/agents/tool-inputs.ts)：集中工具入参契约，补充必填参数、数组、餐次枚举和清单 text 层级说明。
- [tools.ts](../server/agents/tools.ts)、[travel-agent.ts](../server/agents/travel-agent.ts)：复用契约并补充正确调用示例，提示模型按字段错误修正参数，而非反复读取。
- [errors.ts](../server/utils/errors.ts)、[chat.post.ts](../server/api/chat.post.ts)：仅保留应用标记的业务异常，沿 Mastra 的 cause 链识别；未知上游报错即使伪造相同文本前缀也不放行。对框架校验结果重新校验本地输入，输出准确错误，避免回显框架附带的原始参数。
- [plan.ts](../shared/schemas/plan.ts)、[plan-edits.ts](../shared/utils/plan-edits.ts)：为实际遇到的三个参数错误提供更明确的修正提示，保持严格校验，不自动丢弃非法字段。
- [PreviewCard.vue](../app/components/PreviewCard.vue)：修复首次发现的变量引用，使版本切换脚本可通过类型检查。
- 新增真实 SDK 集成测试并扩展聊天流、原子编辑回归，共增加 14 项测试。

### 自动化复核

在规范化 Windows PATH 的临时环境中执行原 `bun run check`：**Lint、类型检查全部通过；16 个测试文件、125 项测试全部通过**。新集成测试实际运行 Mastra Agent、工具和 AI SDK v5 转换器，用本地模拟模型及服务隔离外部 I/O，验证成功读写、错误类包装、空参数和敏感错误隐藏。业务事务测试仍使用内存 SQLite。

`bun run build` 也已通过，退出码 0，新产物已生成到 `.output`。

### 当前模型的真实调用复核

使用现有 `.env` 配置的 `deepseek-chat`，在独立临时 SQLite 数据库内创建虚构测试行程，通过真实 Mastra Agent 和 AI SDK 发起 2 次模型请求。结果：`get_plan` 成功读取，`apply_plan_edits` 成功新增一天（用餐数组）、一条食记（`meal=snack`）和一条清单，保存到 v2，工具错误数为 0。测试数据没有写入用户的 `data/app.db`，没有调用地图服务或改写 `.env`。

该验证覆盖当前模型、工具执行及版本保存链路；不代表已经通过浏览器界面、HTTP Cookie 鉴权或完整用户会话的端到端验收。

历史消息不被改写，所以旧卡片仍可能显示此前的通用错误。开发环境重启 `bun dev` 后发送新请求查看修复效果；生产环境需运行新的构建产物。AI 配置和用户已有规划保持原样。

# 四套优化实施记录

日期：2026-09-17。对应 [原优化方案](OPTIMIZATION_PROPOSALS.md)，覆盖体验、AI 编辑可靠性、性能与上线稳定性。继续使用 Nuxt 4、Vue 3、Bun、SQLite、Drizzle、Mastra 和 AI SDK v5 协议，保留国风两栏布局及可视化编辑。本文记录实际实现与边界；历史方案中的预计工期、收益目标不视为本轮测量结果。

## A：编辑连续性与移动端

| 实现 | 用户可见行为 | 主要文件 |
| --- | --- | --- |
| 按用户、工作区、对象持久化草稿 | 地点、食记、规划资料与旅行偏好切换后和刷新后可恢复；显示未保存/本机已暂存状态 | `app/composables/usePlanDraft.ts`、`app/utils/draft-storage.ts`、各编辑面板 |
| 显式冲突处理 | 保存携带基线 revision；409 保留表单，读取最新字段供比较，明确重新应用后再次保存 | `app/utils/draft-merge.ts`、`app/components/DraftRecovery.vue` |
| 生成与视图切换分离 | 同一规划查看总览、路线、食记或设置时继续生成；全局状态与停止入口可见；跨规划或会话停止 | `app/composables/useWorkspace.ts`、`app/components/MainPanel.vue` |
| 创建引导 | 目的地、天数、预算、人数及节奏生成可编辑的首条需求，不自动发起付费调用 | `app/components/ConversationView.vue` |
| 移动端和键盘 | 抽屉 inert、焦点约束、Escape 关闭与返回焦点；页签方向键/Home/End；动态视口和软键盘高度 | `app/components/WorkspaceSidebar.vue`、`app/components/PlanWorkspaceView.vue`、`app/pages/index.vue` |
| 版本树交互 | 节点鼠标/键盘选择，背景拖拽与节点点击分开，避免 SVG pointer capture 吞掉点击 | `app/components/VersionRoadmap.vue` |

草稿在本机 localStorage 保存，30 天过期，不是跨设备同步。容量不足会提示并保留当前内存表单，无法保证浏览器清理数据后仍可恢复。重新应用只带入本地改过的字段；地点没有稳定 ID，日期、城市或地点身份变化时保守拒绝自动重新应用，保留内容供用户核对。食记目标已被删除时也不会静默创建或覆盖其他对象。

## B：AI 质量与编辑一致性

| 实现 | 行为 | 主要文件 |
| --- | --- | --- |
| 独立修订号 | `plans.revision` 随有效修改递增，覆盖同轮 AI 更新、资料更新及版本切换；版本号仍表示版本树节点 | `server/services/plan.ts`、数据库迁移 |
| 统一事务提交 | 原子编辑与兜底 patch 复用提交路径；规划、版本、修订号及消息预览/系统消息同事务更新 | `server/services/plan.ts`、`server/agents/tools.ts` |
| 可信、有界上下文 | 数据库历史代替客户端历史；保留初始需求和近期对话，旧需求按来源摘录；大规划仅提供概要，按模块分页读取 | `shared/schemas/chat.ts`、`server/services/ai-context.ts`、`server/services/ai-history.ts` |
| 每次模型调用预算 | 统计规则、历史、工具契约及工具结果；压缩重复预览，超预算给出可操作错误；输出 token 单独设上限 | `server/agents/model-budget.ts`、`server/agents/travel-agent.ts` |
| 行程检查 | 提示无效/乱序日期、重复地点、时间重叠、过密日程、缺坐标、预算分类合计差异，可跳转路线编辑 | `shared/utils/plan-review.ts`、`app/components/ItineraryView.vue` |
| 固定评测入口 | 离线验证结构化操作契约；显式开启 live 才用临时数据库调用真实模型 | `evals/plan-cases.ts`、`scripts/eval-ai.ts` |

输入预算以 UTF-8 字节为单位，不是供应商精确 tokenizer；历史整理是带消息来源的确定性摘录，不是额外付费的模型总结。行程检查不计真实交通时间，不校验实时票价、营业时间、预约和道路路线。预算仅比较预算分类明细，避免与食记花费重复计入。没有真实模型评测前，不宣称准确率或 token 成本下降幅度。

## C：分页、取图与缓存

| 实现 | 行为 | 主要文件 |
| --- | --- | --- |
| 局部刷新 | 保存后刷新当前规划/关联会话并更新相应列表条目；版本仅在需要或 revision 改变时加载 | `app/composables/useWorkspace.ts`、`app/utils/api.ts` |
| 游标分页 | 工作区、会话、消息和版本默认 50 条；会话按规划懒加载，旧消息保持滚动位置；版本树说明未加载父节点 | `server/services/pagination.ts`、规划/会话服务、Sidebar/Conversation/VersionRoadmap |
| 全范围搜索 | 规划 q/sort 和会话 q 在服务端授权范围搜索；筛选变化同步使旧请求/游标失效，防抖读取首页 | `server/api/plans/index.get.ts`、`server/api/conversations/index.get.ts`、`useWorkspace.ts` |
| 规划快照缓存 | 用户隔离的本机快照先展示、再向服务端核验；网络故障显示只读离线状态，401/403/404 不回退旧快照 | `app/composables/useWorkspace.ts`、`app/utils/idb.ts` |
| 受控图片请求 | 视口内图片加载、失活面板取消；同规划绑定避免旧面板监听新规划；街景滑块 250ms 防抖和最终提交 | `app/components/CachedImage.vue`、`app/components/PanoramaView.vue` |
| 请求合并与缓存容量 | 同 URL 共享请求，最后一个订阅者取消才中止；前端 48 MiB / 300 条、元数据访问索引淘汰，后端默认 512 MiB 分批回收 | `app/utils/idb.ts`、`server/services/cache.ts`、`server/plugins/cache-maintenance.ts` |
| 渲染与按需加载 | Markdown 编辑器条件式 Lazy 加载；流式 Markdown 约 160ms 合并刷新；滚动更新按动画帧合并；历史预览默认摘要 | 各编辑面板、`StreamingMarkdown.vue`、`ConversationView.vue`、`PreviewCard.vue` |

后端缓存单批回收有上限，过期或超额条目通过后续批次逐步回落；不是每次写入立即满足硬容量上限。前端 IndexedDB 为可丢弃缓存，结构升级可清理旧缓存，草稿单独保留。当前采用分页减少 DOM，未实现长列表虚拟化。没有固定硬件/网络的前后对照测量，不把代码变化换算为首屏速度或请求费用收益。

## D：运行恢复、治理和发布

| 实现 | 行为 | 主要文件 |
| --- | --- | --- |
| 持久任务与检查点 | queued/running/completed/cancelled/failed/interrupted 状态；工具提交保存预览，文本周期落库；重启恢复已提交结果 | `server/database/operations.ts`、`server/services/chat-runs.ts`、`server/api/chat.post.ts`、`server/plugins/chat-recovery.ts` |
| 幂等请求 | `(userId, requestId)` 唯一；重复提交返回已有状态，不执行第二次工具；明确新一轮重试创建新 ID 并提示保留既有改动 | `server/services/chat-runs.ts`、`app/composables/useWorkspace.ts`、`ConversationView.vue` |
| 用量保护 | 用户/全局并发、有限队列、等待超时和周期请求额度，拒绝时返回 429 / Retry-After | `server/utils/ai-config.ts`、`server/services/chat-runs.ts` |
| 实际服务指标 | 记录请求、错误、缓存命中、耗时、步骤及供应商返回的 token；无 usage 明确未知，后台缓存字节独立统计 | `server/services/metrics.ts`、`server/api/admin/stats.get.ts`、`app/pages/admin/index.vue` |
| 隔离发布验证 | HTTP、强制进程中断恢复与 Chromium 浏览器使用临时数据库；AI 走本地模拟模型，CI 保存报告/截图 | `scripts/verify-isolated.ts`、`scripts/test-recovery.ts`、`scripts/test-browser.ts`、`.github/workflows/ci.yml` |
| 备份与恢复演练 | `VACUUM INTO` 创建一致性新副本；临时恢复副本做完整性、外键和关键表检查，不覆盖源库 | `scripts/db-backup.ts`、`scripts/db-restore-verify.ts` |

当前按单实例部署；不要让多个实例共享同库后各自执行启动恢复。恢复对象是已保存的行程、预览和文本检查点，不是中断后的无缝 token 续传。周期额度计数不等于供应商余额或精确费用；历史业务没有回填为虚构指标。备份恢复演练验证副本，正式替换生产库仍需单独的部署操作。

## 配置与迁移

- 应用前先备份，再运行 `bun run db:migrate`，保留现有 Better Auth 表及业务数据。
- `AI_INPUT_MAX_BYTES=96000`，`AI_OUTPUT_MAX_TOKENS=4096`；用户/全局并发默认 1/4，队列 8，等待 10000ms。
- `AI_REQUESTS_PER_PERIOD=60`，`AI_GLOBAL_REQUESTS_PER_PERIOD=1000`，`AI_PERIOD_SECONDS=3600`。
- `CACHE_MAX_BYTES=536870912`，`BACKUP_DIR=./backups`；完整配置参考 `.env.example`。
- 离线评测用 `bun run eval:ai`；真实评测需显式 `EVAL_LIVE=true` 和 `bun run eval:ai --live`，默认最多 5 例。

## 本轮验证记录

以下为 2026-09-17 本轮最终实际结果；历史方案中的 125 项测试不代表当前代码结果。

| 检查 | 结果 / 证据 |
| --- | --- |
| `bun run check` | 通过：ESLint、Nuxt 与 scripts 类型检查、24 个测试文件 / 206 项测试；日志 `.verification/check.log` |
| `bun run build` | 退出码 0，日志 `.verification/build.log` |
| `bun run test:integration` | 通过，11 / 11 项 HTTP 验收 |
| `bun run test:browser` | 连续两次通过 10 / 10 项；最新报告 `.verification/browser/2026-09-17T05-33-53-132Z/report.json`，页面未捕获异常 0；包含真实 409、草稿恢复、同规划生成连续性、版本鼠标点击、移动布局与换号隔离 |
| `bun run test:recovery` | 通过 5 / 5 项；报告 `.verification/recovery/2026-09-17T05-35-53-545Z/report.json`。真实工具提交后强制终止服务，再同库重启；行程/预览保留、任务标记中断、重复请求 409 且不增加消息/版本，新请求可完成 |
| `bun run eval:ai` | 离线契约样例 30 / 30 通过；覆盖结构化编辑及未请求字段保持不变，不等同真实模型评测 |
| 分页与局部刷新回归 | 覆盖 101 个规划、1,000 条消息、500 个版本，分页无遗漏/重复；搜索与排序变化不复用旧游标；普通局部保存只执行规划详情与当前消息两次对账 GET |
| 本地业务库一致性备份 | 已创建 `backups/pre-optimization-20260917.sqlite`，229376 字节，未覆盖源库或已有文件 |
| `db:restore:verify` | 上述备份的临时恢复副本通过 integrity_check / foreign_key_check |
| 本地数据库迁移 | 成功；只读复查 integrity_check 为 ok，六张关键业务表行数与迁移前一致，revision 均至少 1，chat_runs / usage_metrics 已存在 |
| 真实 AI / 百度调用 | 本轮未进行，无外部付费服务验收结论 |
| 性能对照与多用户压测 | 未进行；未宣称固定百分比提速或容量结论 |

备份记录仅保留文件与完整性结论，不包含真实账号、消息或规划正文。生产服务发布、真实供应商联调以及大规模性能测量不由本地 check/build 代替。

浏览器使用 headless Chromium，移动端缩小 viewport 验证输入/发送可达，不等价于原生手机软键盘。测试阻断了 Markdown 编辑器从 unpkg 请求的可选扩展，报告记录资源列表；本轮没有验证这些远程扩展功能。版本图点击故障、搜索分页竞争、离线 Diff 无进展循环及消息跨页刷新缺口均已修复。

重复完整门禁可执行 `bun run check:release`，顺序为代码检查、生产构建、隔离 HTTP、进程恢复、浏览器验收；浏览器需已安装 Chromium。真实模型评测保持独立显式入口。

# 版本管理前端交付记录

验证日期：2026-09-30。工作副本：`E:\hbws\worktrees\version-frontend`；分支：`codex/version-frontend`；基线：`41a6068`。

## 修改范围

- `VersionRoadmap.vue`、`version-camera.ts`：镜头不再随树尺寸隐式变化；使用实际 SVG screen CTM 逆矩阵处理 `preserveAspectRatio="xMidYMid meet"` 的留白、拖动和鼠标锚点缩放。指针捕获覆盖画布外释放、取消、失焦，支持双指平移/缩放，拖动不触发节点预览。补充键盘导航、适应全部、定位当前、稳定的分页状态栏与长名称布局。
- `shared/utils/version-tree.ts`：迭代布局避免长历史递归溢出；保留分叉、缺失父节点与异常独立节点。节点始终显示展示版本号 `vN`，名称可分行省略并保留完整提示。
- `VersionPreviewDialog.vue`、`PlanSnapshotView.vue`、`version-preview.ts`：用真实历史 GET 读取只读快照，展示名称/来源/时间/变化摘要、行程总览、每日地点、交通住宿、预算、食记、清单、提示及快照已有图片。请求隔离、加载/空态/错误重试、原生模态、Escape、焦点约束与返回均已覆盖。
- `api.ts`、`version-metadata.ts`、工作区 document/composable：接入真实改名 PATCH；缺失名称字段兼容 `null/null/0`。名称 trim 后按 Unicode 字符计数校验 1–40 字，使用独立 `expectedNameRevision`。成功直接合并返回元数据，不改变当前规划；旧列表不能覆盖新名称。强制刷新覆盖已加载分页，不依赖规划 revision。409 保留输入，明确比较最新名称后再提交。
- `ConversationView.vue`、`PreviewCard.vue`：仅移除重复的“保存当前行程”入口及对应代码。行程表单保存、草稿恢复、保存状态与 AI 生成流程保留。
- 新增专项单测、`scripts/test-version-browser.ts` 与 `bun run test:versions`，同步既有浏览器测试中的弹窗交互和重复保存入口断言。

未修改 ChatConfiguration、模型配置、聊天后端、数据库、迁移或共享版本 Schema；未增加 UI 组件库。

## 本次验证

| 检查 | 结果 |
| --- | --- |
| `bun run check` | 通过；ESLint、Nuxt/脚本类型检查、40 个测试文件共 316 项单测、Knip 全量与生产扫描 |
| `bun run build` | 通过；仅既有依赖的打包注释/弃用提示 |
| `bun run verify:media` | 隔离提供方与缓存检查通过，未调用真实外部服务 |
| `bun run test:integration` | 11 项真实 HTTP 验收通过，临时 SQLite |
| `bun run test:recovery` | 5 个进程中断恢复场景通过 |
| `bun run test:browser` | 10 个既有浏览器场景通过，包含表单草稿、409、AI 生成中查看、历史切换、移动端与账号隔离 |
| `bun run test:product` | 6 个既有图文产品场景通过，包含编辑保存、图片恢复与后续 AI 追问 |
| `bun run test:versions` | 11 个专项场景全部通过，未捕获界面异常为 0 |

单测覆盖 6000 层历史、100 个兄弟分叉、坐标变换、同版本元数据刷新不重新加载快照、乱序请求、跨工作区、名称修订号并发及规划更新期间补刷新。

专项浏览器使用 Chromium、真实生产构建、独立临时数据库与测试账号，通过真实 HTTP 创建 56 层历史和 10 个分叉。覆盖背景/连线拖动、缩放后拖动、画布外释放、节点拖动防误触、键盘、真实浏览器触摸与双指取消、390px 窄屏与长名称。预览前后当前版本、revision、节点数量和写请求均不变；显式切换仍验证真实 409，继续表单保存的父版本正确指向所选历史版；刷新后的草稿恢复与 AI 结构化编辑有效。

原版实际拖动 100px 时仅横移 5.8736px；修复后横移 100.00006px。缩放后平移 80/40px、连线平移 -70/40px 与预期一致；触摸 55/35px 实测 54.99994/35px。追加历史时画布 y 坐标前后均为 374.75px，节点位置只有约 0.00003px 浮点误差。

验证过程中发现并修复两处问题：分页提示消失导致整块画布上移；元数据对象替换误触发选择监听导致反复加载快照。最终报告均来自修复后的通过运行。

## 后端联调边界

生产代码已经接到 `PATCH /api/plans/:planId/versions/:version/name`，请求为 `{ name, expectedNameRevision }`，响应解析 `{ version }`。展示与调用使用 `version`，不使用版本记录数据库 ID。

当前前端分支基线没有新命名后端：真实请求返回 404，已验证显示失败并保留输入。改名成功、503、409、刷新后名称显示及历史版改名不切换当前版本，由 **仅在专项测试脚本中的 Playwright 契约夹具** 验证；不代表已验证后端数据库持久化。生产路径没有模拟响应或回退写入。

历史快照读取、当前规划读取、切换、修订号冲突、表单保存与分叉均使用真实服务。AI 使用本机隔离模型响应，行程编辑仍通过真实工具与事务。后端任务合并后，需要补验改名真实存储、并发锁与刷新后的持久化；共享 Schema 可与当前前端扩展直接兼容。

## 本地证据

以下文件保留在当前工作副本的 `.verification/`（按仓库惯例忽略，不纳入源码提交）：

- 完整检查日志：`.verification/version-check.log`
- 生产构建日志：`.verification/version-build.log`
- 原版复现：`.verification/version-baseline/report.json`、`before-canvas.png`
- 专项报告与 8 张截图：`.verification/versions/2026-09-30T01-33-19-781Z/`
- 既有浏览器报告：`.verification/browser/2026-09-30T01-32-33-498Z/report.json`
- 图文产品报告：`.verification/product/2026-09-30T01-28-20-144Z/report.json`
- 恢复报告：`.verification/recovery/2026-09-30T01-28-18-440Z/report.json`

推荐查看专项截图 `historical-preview.png`、`narrow-long-name-preview.png`、`current-version.png`、`wide-long-tree.png`、`branch-edit-saved.png`。所有验收服务均由脚本停止，临时数据库按脚本的路径边界检查清理；没有操作业务数据库。

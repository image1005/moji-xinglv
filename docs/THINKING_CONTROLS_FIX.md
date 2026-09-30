# 思考链路与配置按钮验收（2026-09-30）

工作副本：`E:\hbws\worktrees\thinking-controls`，分支 `codex/thinking-controls`，基线 `41a6068b1c4ecc4e576833e5a5472000ddc6e549`。全部修改与验证在独立副本中进行；数据库使用随机临时路径，未操作原项目业务数据。

## 复现与依据

实际配置为 `https://api.deepseek.com/v1`、`deepseek-chat`，项目将已核实别名规范为 `deepseek-flash`。已安装 `@ai-sdk/deepseek 1.0.57`、AI SDK 5、Mastra 现有协议不变。官方 [模型能力](https://api-docs.deepseek.com/api/list-models/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/) 和 [请求参数](https://api-docs.deepseek.com/api/create-chat-completion/) 支持 `low/high/max`，所以保留 light/standard/deep 映射，没有降档或关闭思考。

1. **真实复现输出预算耗尽**：七天北京行程，deep/max，原 4096 总输出额度；19.923 秒 HTTP 200，`finish_reason=length`，4096 个输出 token 全部是 reasoning；没有正文，没有工具调用。脱敏证据：`.verification/thinking-real/2026-09-30T01-17-30-610Z/results.json`。
2. **流活动被隐藏**：安装版本 `handleChatStream` 默认 `sendReasoning=false`，原聊天入口未显式设置。客户端 JSONL 读取有 45 秒空闲期限，持续思考的真实事件未转发时会误触发空闲中断。实际 SDK 回归复现了默认行为；真实短请求也观察到上游有思考、客户端无思考事件。
3. **工具续传输入额度冲突**：仅调大输出后，真实长任务产生 33331 字符思考并执行三次编辑，随后失败。回归以该量级复现原 `boundModelPrompt` 的 96KB 上限错误；协议要求保留的思考内容与用户内容、工具结果共用额度，后续步骤被阻止。新增独立额度完整保留思考，原普通输入上限仍生效。
4. **相同思考的跨步去重**：浏览器隔离流在“读取工具 → 搜索工具 → 正文”第三次请求被拒绝，第二个工具消息缺少 `reasoning_content`。安装的 Mastra `MessageMerger.pushNewPart` 使用内容键去重，使两步相同思考只剩第一次。实际 SDK 测试分别使用相同和不同思考，确认该边界。供应商适配中按真实 `toolCallId` 保存本轮 SDK 输出并原样回填，同时再次检查思考预算；缓存只属于本轮模型实例，不生成占位思考，不跨用户复用，不修改依赖源码。

## 修复

- 思考模式每步总输出默认 32768 token（思考、正文、工具参数合计），非思考仍为 4096；思考续传默认另限 256KiB，二者均有配置上界。
- 明确启用真实 reasoning 事件；没有合成保活信号，也未放宽前端 45 秒空闲限制。
- 整轮默认仍为 180 秒；超时先落失败终态再返回明确错误。停止、失败、输出耗尽均释放运行状态，保留既有 `finishRun` 调用语义。
- 官方能力与选择 DeepSeek SDK 分开判断；兼容接口需逐档声明已验证能力；禁用项说明原因。恢复旧配置发生调整时明确提示，发送快照仍严格校验。
- 菜单和搜索按钮继续调用 `modelSettings.update()`，发送仍取 `snapshot()`；保存失败反馈与重试不丢失当前选择。

## 界面参考与范围

实际阅读 [Harness ModelSelect.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-model-selection/src/client/ModelSelect.tsx)、[同目录 CSS](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-model-selection/src/client/ModelSelect.module.css)，并检查客户端目录及 `ui-conversation` 的 `InputBar`。参考紧凑触发按钮、档位图标、当前选择、弹出菜单及勾选反馈，用 Vue 和项目宣纸、墨色、竹青令牌实现；未引入 UI 库。

没有找到可照搬的独立输入栏“智能搜索”按钮。仓库有搜索设置页面，本次搜索按钮沿用同套视觉自行实现，不声称复刻不存在的输入组件。

新增子组件包含菜单键盘操作、Escape、Tab、外部点击、焦点返回、Teleport、visualViewport 位置与高度限制。版本树、版本表、命名接口、版本保存按钮未修改。

## 验证与证据

真实供应商与隔离模拟分别记录，不用模拟成功代替真实可用：

- 真实四档 × 搜索关闭，且每档经数据库恢复再追问：8/8 完成，均有工具与正文，开启思考时上下游均有 reasoning，实际参数与选择一致。证据 `.verification/thinking-real/2026-09-30T01-23-53-204Z/results.json`。
- 真实四档 × 搜索开启：4/4 完成，均执行 `search_web` 与 `get_plan`，每轮有 5 条真实来源，随后正文与完成终态。证据 `.verification/thinking-real/2026-09-30T01-25-16-739Z/results.json`。
- 同一七天长行程复验：deep/max，32768 单步总输出、原 180 秒期限，86.969 秒完成。最终数据库为 7 天、28 个景点、7 道美食、9 项清单；连续 5 次 `apply_plan_edits` 后输出 604 字符正文，完整传递 35345 字符思考，6 次模型请求均 HTTP 200，最后 `stop`，数据库与 JSONL 终态均 `completed`，零错误。证据 `.verification/thinking-real/2026-09-30T01-29-34-610Z/results.json`。
- 最终重复思考兼容补丁的真实复验：应用入口 deep + 搜索 + 历史追问 2/2 成功；另以依赖上一步随机返回值的两个测试工具强制 SDK/Mastra 三步顺序调用，3.222 秒完成，三次模型请求均 `max` 和 HTTP 200，最终 `stop`。这项三步测试不涉及数据库，不能替代前述应用全链路验收。证据分别为 `.verification/thinking-real/2026-09-30T01-32-45-943Z/results.json`、`.verification/thinking-real/2026-09-30T01-35-06-638Z/sdk-three-step.json`。
- 隔离长等待浏览器验收：`.verification/thinking/2026-09-30T01-34-44-228Z/report.json`，10 项全部通过。真实 Nuxt 生产页面、临时 SQLite、安装的 SDK/Mastra 加本地供应商夹具：四档 × 搜索开关、重复思考三步续传、50 秒持续思考后正文（超过原 45 秒窗口）、65 秒测试期限超时后再次发送、停止、HTTP 失败、长度耗尽、刷新持久化、保存失败重试、键盘/焦点及窄屏。供应商可用性依据上面的真实验证，不依据此模拟。
- 完整验收命令：`bun run check`、`bun run check:release`；专项长等待浏览器验收：`THINKING_BROWSER_LONG=1 bun run test:thinking:browser`（PowerShell 用环境变量赋值）。真实验收：`bun run verify:thinking --real [--search] [--followup] [--thinking=deep --planning]`。

最终结果：`bun run check` 退出 0，41 个测试文件、321 项测试通过，lint、类型检查和两种 Knip 扫描通过；最终 `bun run check:release` 退出 0，生产构建、媒体隔离验证、HTTP、进程恢复、一般浏览器、思考浏览器和产品验收全部通过。完整日志保留为 `.verification/check-final.log` 与 `.verification/release-verified.log`。

小屏截图复核补上“仅滚动菜单内部使当前选中项可见”，随后最新生产构建完整思考浏览器验收 10/10 通过，另做界面专项 6/6 通过（明确跳过模型与长等待部分）。覆盖 320×460、390×460、390×844、844×390。对应报告归档为 [完整最终浏览器报告](verification/thinking/isolated-browser-final.json) 和 [界面专项报告](verification/thinking/isolated-browser-ui.json)。

截图：[桌面菜单](verification/thinking/desktop-menu.png)、[手机菜单](verification/thinking/mobile-tall-menu.png)、[320×460 小视口当前选中项](verification/thinking/mobile-menu.png)。

真实供应商 JSON 只记录脱敏参数、计数与终态，不记录密钥或真实提示词/思考正文。浏览器截图展示隔离夹具内容。完整 `.verification` 目录保留在工作副本；精选证据与截图同步在 `docs/verification/thinking/`，随提交保留。

## 修改文件

- 控件与状态：`app/components/ChatConfiguration.vue`、`ChatThinkingMenu.vue`、`ChatSearchToggle.vue`，`app/assets/styles/_configuration-control.scss`、`app/features/workspace/model-settings.ts`。
- 能力与配置：`server/providers/models.ts`、`server/services/model-settings.ts`、`server/utils/ai-config.ts`、`shared/schemas/model-config.ts`、`.env.example`。
- 思考流与预算：`server/services/chat-application.ts`（局部调整）、`server/providers/reasoning-replay.ts`、`server/utils/reasoning-budget.ts`、`server/agents/model-budget.ts`、`server/agents/travel-agent.ts`（仅预算参数）。
- 回归：`tests/chat-stream.test.ts`、`tests/provider-configuration.test.ts`、`tests/provider-thinking-stream.test.ts`、`tests/model-reasoning-budget.test.ts`、`tests/ai-config.test.ts`、`tests/model-settings.test.ts`、`tests/model-settings-state.test.ts`。
- 验收入口：`scripts/verify-thinking.ts`、`scripts/test-thinking-browser.ts`、`scripts/mock-thinking-ai.ts`、`scripts/test-product.ts`（原控件定位替换）、`package.json`。
- 文档：`README.md`、`docs/API.md`、`docs/DEV.md`、本报告及 `docs/verification/thinking/` 的脱敏验收证据与截图。

## 合并事项

本修改增加配置能力响应的可选说明字段，不需要数据库迁移或依赖升级。与版本任务合并时，保留对方 `finishRun` 终态入口的业务处理，仅合入本次思考事件、预算选择和超时反馈改动。新环境变量与兼容网关逐档声明见 `.env.example`；开启思考的单步预算更高，实际用量按供应商返回统计。

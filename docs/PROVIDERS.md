# 模型、搜索与真实能力记录

更新：2026-09-18。供应商功能会变化；此文区分本次实测、官方文档与隔离模拟。

## 接入与契约

- `server/providers/models.ts` 负责模型能力、旧别名规范化及实际参数；`server/services/model-settings.ts` 负责用户默认设置。`GET/PUT /api/model-settings` 使用 `shared/schemas/model-config.ts`，默认设置进入 SQLite `model_settings`。
- 每轮在服务端校验 `{model, webSearch, thinking}`，保存到 `chat_runs.configuration_json`；参与幂等哈希。更换图片、思考档位或联网设置不能命中旧轮次。服务端配置变化后，不再允许的旧默认模型回退到当前配置，并重新计算支持的选项。
- 当前官方 `deepseek-chat` 经过本次实际接口验证返回 `deepseek-flash`，在请求开始前规范为 `deepseek-flash`；界面和持久快照显示实际模型，不改本地 `.env`。其它兼容地址不凭模型名称推断能力。
- `createConfiguredModel` 使用 `@ai-sdk/deepseek@1.0.57`（官方 `ai-v5` 分支），复用其图片序列化、`reasoning_content` 回传、流解析；Mastra 继续拥有工具循环，没有自建 Agent 循环。
- 思考映射：关闭→`thinking.type=disabled`；轻量→`enabled`+`reasoning_effort=low`；标准→`enabled`+`high`；深度→`enabled`+`max`。SDK 的 `defaultSettingsMiddleware` 将参数传到真实请求。自定义兼容服务默认仅支持关闭；不能通过提示词模拟不支持的档位。

## 官方能力核对

- [DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)：支持开关、low/high/max；携带 tools 时后续请求需保留 reasoning_content。
- [DeepSeek 视觉](https://api-docs.deepseek.com/guides/vision/)：当前 Flash 接受真实图片，支持 Chat Completions 的 image_url；应用仅向 user 消息加入附件。
- [DeepSeek Responses 兼容表](https://api-docs.deepseek.com/guides/responses_api/)：内置 web_search 仍标为忽略。本项目没有把第三方搜索标成 DeepSeek 原生搜索。
- [DeepSeek 2026-09-10 公告](https://api-docs.deepseek.com/news/news260910/)：旧 V4 模型迁移到 Flash。兼容别名范围以当前实现和本次测试为准，不假定任意未来模型有相同能力。

## 搜索

模型通过 Mastra `search_web` 调用独立 [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)。需 `TAVILY_API_KEY`。没有凭据时界面禁用联网，服务端也拒绝开启。关闭时不注册该工具；执行层再次校验本轮开关、用户和规划作用域。

每轮最多 3 次，每次 basic 搜索最多 5 条，12 秒总超时、1 MB 响应上限。返回标题、URL、摘要、取得时间和 `provider=Tavily`，不请求模型生成的 answer。搜索结果作为不可信外部资料，不改变工具权限；工具失败不能显示假成功或假来源。现有聊天并发与周期额度继续限制生成。

## 真实探针结果

`bun run verify:providers --real` 使用已有 `.env`，每个响应最多 256 tokens。默认不带 `--real` 只报告配置，不调用付费服务。

| 探针 | 实际响应 | 证据 |
| --- | --- | --- |
| 当前 deepseek-chat，关闭思考 | 200，model=deepseek-flash | 有正文、无 reasoning |
| 关闭思考工具调用 | 200 | 返回真实 tool_calls |
| 真实 PNG 图片 | 200 | 正确识别红色，非文字替代图片 |
| 标准 high | 200 | 返回 reasoning_content |
| 轻量 low | 200 | 返回 reasoning_content |
| 深度 max | 200 | 返回 reasoning_content |
| low + auto 工具第一轮 | 200 | reasoning_content 与 tool_calls |
| 上轮完整 reasoning + 工具结果回传 | 200 | 返回最终正文 |

共 9 个 HTTP 请求，其中 8 个成功合计 1435 tokens；一个探针使用“思考 + 强制 tool_choice”收到 400，未伪报成功。应用保留 Mastra 默认 auto 调用。没有据此声称不同档位回答质量或内部推理长度已评估。

环境的受限沙箱首次阻断网络，批准网络后上述请求成功。没有输出密钥、用户内容或模型思考正文。`--extended` 仅补测 low/max；`--roundtrip` 仅补测两轮 auto 工具。每次真实重跑会产生新的费用。

本机没有 Tavily/百度凭据，二者仅完成真实协议结构的隔离模拟，尚未真实联调。所需配置：`TAVILY_API_KEY`、具有地点检索/地理编码/静态图/全景权限的 `BAIDU_MAP_AK`。百度 AK 仍仅由 `server/services/baidu.ts` 在生产代码读取。

供应商直连探针不替代框架链路验证。额外的隔离测试已通过真实 `createTravelMastra → handleChatStream → AI SDK → 本地模型 → 真实编辑工具 → 后续模型请求` 的纯图两轮流程；确认每轮有 inline 图像和 max 参数。该测试发现 Bun 1.4.2 对 URL 的 structuredClone 抛异常，现只复制可变 JSON 工具结果，图片 URL 与二进制保留原生类型并独立计量。

## 依赖选择与成本

- `@ai-sdk/deepseek@1.0.57`：AI SDK v5 对齐分支，本次检查为近期维护；直接声明，避免依赖 Mastra 偶然传递安装。纯 TypeScript 服务端 provider，客户端不打包。替代自制供应商协议转换，沿用 ai 5 / Mastra 现有大版本，无消息数据库重写。
- `sharp@0.34.5`：实际解码验证格式/尺寸、去 EXIF、生成安全 WebP；Node/Bun 支持且本机 Bun 1.4.2 实测。现有库没有安全的图像解码器，仅检查扩展名或魔数不足。它带平台原生 libvips 包，是本次主要服务端体积增加；客户端无新增负担。上传数据是新增表，无已有附件迁移成本。
- 搜索和 Wikimedia 复用平台 fetch、Zod、已有缓存；未引入整套第三方 SDK。版本及锁文件均直接声明/冻结安装。

## 模拟验证边界

`scripts/mock-providers-preload.ts` 只可用于显式 `PRODUCT_MOCK_PROVIDERS=1`、`test-/verify-` 临时数据库和全套 `fixture-only` key。拦截固定供应商域，拒绝其它非 loopback 外网，来源和图像署名带本地测试标记。生产代码不引用该脚本。模拟证明配置传递/权限/协议，不证明供应商可达、地图精度或模型识别质量。

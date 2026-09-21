# 模型、搜索与真实能力记录

更新：2026-09-21。供应商功能会变化；此文区分本次实测、官方文档与隔离模拟。

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

模型通过 Mastra `search_web` 调用服务端选择的提供方。`AI_SEARCH_PROVIDER=auto` 默认优先使用已配置的 [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)，否则使用官方 DeepSeek 密钥。可指定 `deepseek`、`tavily` 或 `off`。只有均不可用或显式关闭时才禁用开关。第三方兼容网关的密钥不会发送到 DeepSeek 官方地址。关闭联网时不注册该工具；执行层再次校验本轮开关、用户和规划作用域。

DeepSeek 的 [Anthropic 兼容接口官方说明](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/) 明确支持联网搜索。本项目调用 `/anthropic/v1/messages`，模型 `deepseek-flash`，工具类型 `web_search_20250305`，`max_uses=1`，关闭思考，最多384输出tokens。2026-09-21 实际调用返回 HTTP200 和 `web_search_tool_result`，验证可用。Responses 的 web_search 仍被忽略，不能混淆这两条接口。

每轮最多3次应用搜索，每次最多5来源、12秒总超时、1 MB响应上限。Tavily 使用 basic 搜索；DeepSeek 只接收实际工具结果的标题和 URL，摘要从 snippet 或同 URL 引用取得；未提供明文摘要时明确显示缺失，不解密 encrypted_content，也不把模型正文中的链接当作搜索证据。没有真实结果时返回错误。来源包含获取时间和实际提供方。规范化后的 searchProvider 进入本轮配置快照和幂等哈希，关闭联网则移除此字段。搜索不改变工具权限；官方搜索会产生额外模型用量。

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

9月18日的 Tavily/百度联调仍未完成；9月21日已使用现有官方 DeepSeek 密钥完成真实搜索，无需额外 Tavily 配置。百度仍需具有地点检索/地理编码/静态图/全景权限的 `BAIDU_MAP_AK`。百度 AK 仍仅由 `server/services/baidu.ts` 在生产代码读取。

供应商直连探针不替代框架链路验证。额外的隔离测试已通过真实 `createTravelMastra → handleChatStream → AI SDK → 本地模型 → 真实编辑工具 → 后续模型请求` 的纯图两轮流程；确认每轮有 inline 图像和 max 参数。该测试发现 Bun 1.4.2 对 URL 的 structuredClone 抛异常，现只复制可变 JSON 工具结果，图片 URL 与二进制保留原生类型并独立计量。

## 依赖选择与成本

- `@ai-sdk/deepseek@1.0.57`：AI SDK v5 对齐分支，本次检查为近期维护；直接声明，避免依赖 Mastra 偶然传递安装。纯 TypeScript 服务端 provider，客户端不打包。替代自制供应商协议转换，沿用 ai 5 / Mastra 现有大版本，无消息数据库重写。
- `sharp@0.34.5`：实际解码验证格式/尺寸、去 EXIF、生成安全 WebP；Node/Bun 支持且本机 Bun 1.4.2 实测。现有库没有安全的图像解码器，仅检查扩展名或魔数不足。它带平台原生 libvips 包，是本次主要服务端体积增加；客户端无新增负担。上传数据是新增表，无已有附件迁移成本。
- 文字搜索和 Wikimedia 复用平台 fetch、Zod、已有缓存。腾讯云图片搜索使用官方单产品 `tencentcloud-sdk-nodejs-wimgs@4.1.225`，直接声明并更新 bun.lock；复用 TC3 签名、临时凭据、错误解析与取消支持，避免自写一套云鉴权。该包官方发布、与腾讯云公共 SDK 同步维护，本次包体解压约25.8 KB（不含公共 SDK 与传递依赖）；仅服务端使用，不增加浏览器依赖，不升级 AI SDK/Mastra。Node 隔离 HTTP 测试及实际 Bun 运行时探针验证兼容，最终 Nuxt 构建体积见本次验证记录。既有图片缓存/资源表无需迁移。

## 腾讯云联网文搜图

按 [官方 SearchByText 文档](https://cloud.tencent.com/document/api/1815/127087) 使用 `wimgs.tencentcloudapi.com`、版本 `2025-11-06`，入参 Query，逐条校验 Images 中的 JSON 字符串。[开通与密钥说明](https://cloud.tencent.com/document/product/1815/127079)；环境变量、配额和真实探针见 [图片覆盖修复](MEDIA_COVERAGE_FIX.md)。服务端不开放可自定义请求地址，密钥不进入客户端。官方 SDK 拥有 HTTP、签名及 JSON 解析，应用在解析后限制最多20条、每条20 KB；不修改 SDK 私有方法，也不宣称这是响应读取前的流量上限。请求12秒超时，图片下载另有5 MiB硬限制。

当前本机没有腾讯云密钥，已完成 SDK/适配/下载链路的隔离验证，未宣称腾讯云真实图片搜索已联调。配置后执行一次 `bun run verify:media --real --tencent` 可验证真实搜索、匹配及图片解码；该命令调用付费服务。

## 模拟验证边界

`scripts/mock-providers-preload.ts` 只可用于显式 `PRODUCT_MOCK_PROVIDERS=1`、`test-/verify-` 临时数据库和全套 `fixture-only` key。拦截固定供应商域，拒绝其它非 loopback 外网，来源和图像署名带本地测试标记。生产代码不引用该脚本。模拟证明配置传递/权限/协议，不证明供应商可达、地图精度或模型识别质量。

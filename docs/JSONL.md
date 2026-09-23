# 应用聊天协议 v1

唯一 HTTP 路径为 `POST /api/chat`，鉴权继续使用 Better Auth 会话 cookie。必须使用 `Content-Type: application/x-ndjson`，单次提交恰好一条用户消息记录，以 LF 结束（解析器也允许最后一行没有 LF）。文件先上传，消息只引用当前用户当前规划的附件 ID。

```json
{"protocolVersion":1,"type":"message","requestId":"request-uuid","messageId":"message-uuid","planId":1,"conversationId":2,"configuration":{"model":"deepseek-chat","webSearch":false,"thinking":"off"},"message":{"id":"message-uuid","role":"user","parts":[{"type":"text","text":"安排杭州两天"},{"type":"file","attachmentId":"attachment-uuid"}]}}
```

纯图片消息合法。不接受客户端系统消息、工具结果、历史数组、任意图片 URL 或 data URI。所有模型历史由服务器授权会话读取，二进制只在附件接口及模型供应商边界传递。当前上下文最多 12 张图（可配置更低），默认独立图片字节预算20 MiB，另有32 MiB编码图片内存上限；超过时明确要求新建会话选择所需图片，不静默丢弃。

成功响应是 `application/x-ndjson; charset=utf-8`，关闭代理缓冲和缓存。每条事件都有 `protocolVersion:1`、`requestId`、助手 `messageId` 和从 0 连续递增的 `seq`：

| type | 载荷 | 所有者 |
|---|---|---|
| `status` | `status: queued/running/saving` | 真实应用处理状态，不生成虚构思考文本 |
| `chunk` | `chunk` 为 AI SDK v5 UIMessageChunk | 文本、工具、来源、预览与消息组装归 SDK |
| `error` | 脱敏 `code` / `message` | 协议/连接异常 |
| `terminal` | `status: completed/cancelled/failed` | 运行结束，且必须出现 |

工具输出中的预览只在核验所属规划和已提交版本后发送。搜索来源随工具结果持久化，可含 SDK `source-url` 部分；这是业务来源，不是传输状态。上游 DeepSeek/Mastra 的 SSE 或其他协议不发生变化。

客户端 `JsonlChatTransport` 只处理记录封装、身份、序号和终态，并转给已安装 AI SDK 的流解码器验证与组装。它不保有第二套消息数组。UTF-8 使用流式严格解码；解析器处理跨块、多行、CRLF、非法 JSON、超限及取消。最大单条 128 KiB，输入总量 128 KiB，响应总量 8 MiB、50000 条；读取空闲超时 45 秒，上传聊天记录超时 15 秒。保留最近 64 条事件摘要用于完全相同的重复事件去重；冲突重复、缺号、跨请求/跨消息身份及缺少终态均报错。

请求幂等身份包含用户、规划、会话、规范化文字、按消息顺序排列的附件标识和实际模型/联网/思考配置。相同 requestId 不再执行模型或工具，返回 409 和已保存的运行状态；不同内容复用 ID 也返回 409。主动发起新一轮应使用新 ID。

SQLite `chat_runs` 保存配置快照与状态，`messages` 保存文字、工具与附件 parts，行程工具在版本事务内保存预览。每两秒文本检查点及生成结束落库。取消、断开、超时、上游缺失完成标记均释放运行名额。重启把未完成任务记为 interrupted；恢复已提交的行程、预览、消息检查点和附件，不提供尚未保存 token 的续传接口。

旧 JSON 请求/SSE 应用入口已经移除，升级部署应同时发布客户端与服务端并刷新浏览器。历史数据库记录保持兼容：旧消息没有 parts 时仍从 content/tool_calls/preview_json 恢复。

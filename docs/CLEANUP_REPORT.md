# 死代码复核与处理清单

2026-09-18；先建立未修改源码的 lint/typecheck/test/build 基线，见 ARCHITECTURE_BASELINE.md。此清单结合 `rg`、Knip 全量/生产扫描、Nuxt 生成声明和入口代码，不能只根据没有显式 import 删除。

## 首批清理

| 位置 | 原用途 | 引用证据与判定 | 处理 |
| --- | --- | --- | --- |
| shared/utils/json.ts `safeJsonParse` | 宽松 JSON fallback | 全仓库仅定义；框架登记名不等于真实消费 | 已确认未使用，删除 |
| shared/utils/json.ts `Json` | 通用递归类型 | 仅类型自引用；无业务消费者 | 已确认未使用，删除，保留实际缓存/hash 使用的 stableStringify |
| app/utils/format.ts `relativeTime` | 相对时间格式 | 模板、脚本、测试均无调用 | 已确认未使用，删除，保留三项实际格式化函数 |
| shared/utils/routes.ts `planMetrics` | 行程统计聚合 | 全量/生产均无调用 | 已确认未使用，删除，保留地图和路线函数 |
| app/utils/idb.ts `fetchJsonCached` | 通用 JSON 请求缓存 | 仅 tests/idb-cache.test.ts 验证 /api/example；工作区实际用 idbGet/idbSet | 仅测试使用，删除函数与该一项失效测试；Blob、容量、用户隔离测试保留 |
| server/services/cache.ts `getCachedJson` / `setCachedJson` | 两级 JSON 缓存 | 基线零消费者；当前 baidu.ts 地点检索与 wikimedia.ts 图片取得实际调用，包含未找到的短期负缓存 | 保留现有实现，已核实生产消费；不按历史线索机械删除 |
| server/services/plan.ts `getLatestVersion` / `commitPlanVersion` | 旧的薄服务包装 | 仅 backend-persistence.fixture.ts 四处；实际 HTTP/AI 使用 savePlanVersion 等事务入口 | 删除包装；测试改为真实公开业务入口，回滚/非法字段/跨规划父版本断言保留 |
| server/services/agents-md.ts sanitize/render/default | 偏好处理内部逻辑 | resolve/save 在同文件调用，没有外部消费 | 保留逻辑，去掉不必要 export |
| server/utils/errors.ts `sanitizeToolError` | 内部错误脱敏 | 同文件其他函数调用 | 保留逻辑，去掉不必要 export |
| app/utils/idb.ts CACHE_MAX_BYTES | 缓存容量常量 | 仅同文件策略使用 | 改为局部常量 |
| VersionRow、PlanEditTarget/Action、VersionTreeNode | 模块内部类型 | 仅所属模块类型组合使用 | 保留类型，缩小为非导出 |
| map.CoordinateSchema、routes.distanceKm | 地图入参与直线距离内部逻辑 | 外部仅 journey 测试导入，生产在所属模块内部使用 | 改为内部；测试改走实际 StaticMapQuerySchema / routeDistance，保持越界和距离断言 |
| server/utils/db.ts sqlite/schema | 单连接及 schema 转导出 | 外部仅 eval-ai CLI 消费 | 连接保留为局部变量；评测用 Drizzle db.$client 关闭同一连接，schema 从真实定义导入 |
| idb.selectCacheEvictions | TTL/容量策略 | 生产 idbSet 内部调用；测试需要确定性时间/容量输入 | 保留实际策略，精准 @internal 标明仅供策略测试的导出；生产扫描不将此测试接缝当生产公开 API |
| app/utils/auth-client.ts `useSession` | Better Auth composable 别名 | 只有生成的自动导入声明；实际会话使用 useCurrentUser 和 authClient | 删除无消费的别名，保留 Better Auth 客户端 |
| app/utils/api.ts me、plans.list/versions、conversations.list/detail | 旧客户端请求包装 | app/tests/scripts 无实际调用；工作区使用分页或聚合入口 | 删除五个包装；旧 HTTP 路由按兼容接口保留 |
| app/utils/api.ts 重复 DTO、shared/types.ts Conversation/VersionRecord | 旧客户端类型副本 | 当前分页、消息和工作区契约由 shared Zod Schema 推导；旧记录类型无消费 | 删除重复定义与无消费类型，不引入第二份消息状态 |
| chat-runs.claimRun 的 string 参数兼容分支 | 测试夹具旧调用形式 | 仅 chat-runs.fixture.ts 使用；真实应用需要文字、附件 ID 与实际配置联合身份 | 删除纯测试分支，夹具改用真实输入对象；旧数据库 nullable 配置列仍兼容读取 |
| models.deepseekOptions、travel-agent.buildModelConfig、媒体内部 Schema/helper、plan.Day 等导出 | 新模块内部实现细节 | 全量与生产扫描及直接调用检查，真实生产只在本模块使用或没有使用 | 有内部用途者去掉 export；无消费者类型删除；配置测试经 createConfiguredModel 的真实 provider 边界验证 |

## 明确保留及退出条件

| 分类 | 位置 | 保留证据/理由 | 退出条件 |
| --- | --- | --- | --- |
| 框架/动态入口 | app pages/middleware；Nitro API/plugins/middleware；模板引用组件 | Nuxt/Nitro 路由生成与 `.nuxt` 声明；构建有对应输出 | 删除对应业务入口并重新运行构建/浏览器验收后再判定 |
| 历史兼容 | database/migrations SQL、meta journal/snapshots | 现存数据库升级路径，migrate.ts 读取目录 | 仅在单独批准的迁移归档策略且历史升级验证后调整 |
| 历史兼容 | schema 中 panoramas 表 | 旧数据库可能有数据；新请求用 cache | 证明历史数据已转移、兼容读路径退出后另立迁移，不直接删表 |
| 历史兼容 | plan.ts readCurrentVersion 的历史空指针 fallback | 旧规划 currentVersionId 可能为空 | 完成受控回填且数据库约束保证非空后移除 |
| 历史兼容 | 可选 expectedVersion/Revision HTTP 字段 | 旧客户端调用还可能存在；当前客户端必须发送 | 客户端版本/调用证据证明旧协议退出后可收紧 |
| 历史兼容 | 旧列表/detail HTTP 路由 | 当前前端已迁移分页/聚合接口；不能仅凭前端封装删除推断无外部调用 | 明确旧客户端支持期结束并验证调用方迁移后再移除路由及服务 |
| 仅开发工具 | scripts/preview-readme.ts 和 marked/github-markdown-css | package.json preview:readme 命令；动态读取 CSS 路径 | 移除 README 预览功能时成组删除 |
| 仅测试/开发工具 | mocks、evals、fixtures、backup/恢复验收 | package scripts 与测试动态子进程实际执行 | 不能用测试引用证明生产接口在用；随对应已移除功能再清理 |
| 框架/动态入口 | scripts/mock-providers-preload.ts | test-product.ts 以 Bun --preload 参数加载，不是 JS import | 精确补充到全量扫描入口；生产扫描不列入 |

## 扫描与验证记录

- 正式入口 `bun run check:deadcode`：Nuxt prepare → Knip 全量 → Knip 生产。`bun run check` 与 CI 均包含它。
- 扫描配置未关闭 issue 类型、未把全部源码列为入口。精确依赖例外及自动导入误判修复见基线文档。
- 删除后的定向验证：缓存、真实数据库持久化、稳定 hash、版本树合计 29 测试通过；新增扫描适配两项通过。再次组合缓存/持久化/扫描适配为 23 测试通过。
- 原 test 入口 31 个 ENOENT 已解决，子进程开始实际执行业务断言。并行功能施工中出现的未完成 provider import 不混入基线失败统计。
- 接入完成后的 `bun --bun knip` 与 `bun --bun knip --production` 均通过，退出码 0，无未使用项或配置提示。没有扩大 ignore、关闭规则或将全部源码声明为入口；全项目仅一个有真实生产内部用途的 `@internal` 测试接缝（selectCacheEvictions）。
- 清理后再次运行地图契约、Mastra 工具、真实运行持久化与 Knip 自动导入适配：4 文件、30 测试通过。另补协议/传输增量、断开、重复、错误与终态测试；工具测试覆盖等待 revision 期间取消后不再写入。
- 效果按用途区分：删除无用途生产函数和旧客户端包装；删除仅测试存在的通用 fetch 包装及其失效测试；业务逻辑仍使用的内部函数只收敛导出；迁移、旧表和实际兼容路由保留并给出退出条件。生产与全量扫描均无待确认项。完整产品验收结果见最终交付记录，不将死代码扫描通过等同于产品功能通过。

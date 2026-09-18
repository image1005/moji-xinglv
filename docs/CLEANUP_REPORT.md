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
| server/services/cache.ts `getCachedJson` / `setCachedJson` | 两级 JSON 缓存 | 基线零消费者；本轮地点/媒体 provider 接入复用的实际缓存能力 | 保留并在最终扫描核实新增消费者；不按历史线索机械删除 |
| server/services/plan.ts `getLatestVersion` / `commitPlanVersion` | 旧的薄服务包装 | 仅 backend-persistence.fixture.ts 四处；实际 HTTP/AI 使用 savePlanVersion 等事务入口 | 删除包装；测试改为真实公开业务入口，回滚/非法字段/跨规划父版本断言保留 |
| server/services/agents-md.ts sanitize/render/default | 偏好处理内部逻辑 | resolve/save 在同文件调用，没有外部消费 | 保留逻辑，去掉不必要 export |
| server/utils/errors.ts `sanitizeToolError` | 内部错误脱敏 | 同文件其他函数调用 | 保留逻辑，去掉不必要 export |
| app/utils/idb.ts CACHE_MAX_BYTES | 缓存容量常量 | 仅同文件策略使用 | 改为局部常量 |
| VersionRow、PlanEditTarget/Action、VersionTreeNode | 模块内部类型 | 仅所属模块类型组合使用 | 保留类型，缩小为非导出 |

## 明确保留及退出条件

| 分类 | 位置 | 保留证据/理由 | 退出条件 |
| --- | --- | --- | --- |
| 框架/动态入口 | app pages/middleware；Nitro API/plugins/middleware；模板引用组件 | Nuxt/Nitro 路由生成与 `.nuxt` 声明；构建有对应输出 | 删除对应业务入口并重新运行构建/浏览器验收后再判定 |
| 历史兼容 | database/migrations SQL、meta journal/snapshots | 现存数据库升级路径，migrate.ts 读取目录 | 仅在单独批准的迁移归档策略且历史升级验证后调整 |
| 历史兼容 | schema 中 panoramas 表 | 旧数据库可能有数据；新请求用 cache | 证明历史数据已转移、兼容读路径退出后另立迁移，不直接删表 |
| 历史兼容 | plan.ts readCurrentVersion 的历史空指针 fallback | 旧规划 currentVersionId 可能为空 | 完成受控回填且数据库约束保证非空后移除 |
| 历史兼容 | 可选 expectedVersion/Revision HTTP 字段 | 旧客户端调用还可能存在；当前客户端必须发送 | 客户端版本/调用证据证明旧协议退出后可收紧 |
| 仅开发工具 | scripts/preview-readme.ts 和 marked/github-markdown-css | package.json preview:readme 命令；动态读取 CSS 路径 | 移除 README 预览功能时成组删除 |
| 仅测试/开发工具 | mocks、evals、fixtures、backup/恢复验收 | package scripts 与测试动态子进程实际执行 | 不能用测试引用证明生产接口在用；随对应已移除功能再清理 |
| 暂无法确认 | 新功能施工中的导出/schema | 接入未完成时 Knip 会报告，不能把计划消费者当最终证据 | 接入完成后重跑两种扫描；剩余项逐条处理，不用大范围 ignore |

## 扫描与验证记录

- 正式入口 `bun run check:deadcode`：Nuxt prepare → Knip 全量 → Knip 生产。`bun run check` 与 CI 均包含它。
- 扫描配置未关闭 issue 类型、未把全部源码列为入口。精确依赖例外及自动导入误判修复见基线文档。
- 删除后的定向验证：缓存、真实数据库持久化、稳定 hash、版本树合计 29 测试通过；新增扫描适配两项通过。再次组合缓存/持久化/扫描适配为 23 测试通过。
- 原 test 入口 31 个 ENOENT 已解决，子进程开始实际执行业务断言。并行功能施工中出现的未完成 provider import 不混入基线失败统计。
- 当前报告区分生产接口删除、测试删除、内部 export 收敛、历史兼容保留。最终全量/生产扫描及整体验收结果将于功能接入后补齐；不以删除行数或此阶段退出码冒充产品交付。

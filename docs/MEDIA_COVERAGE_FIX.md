# 2026-09-21 图片覆盖修复与腾讯云文搜图

起点为 `codex/travel-delivery/0f52c4c`，目录 `E:\hbws\moji-xinglv-new\moji-xinglv-main`，初始工作区干净。已重新检查 AGENTS、PRD、package、Bun锁和实际实现。真实库只读排查；全部验证写入临时库，不修改 .env 或既有行程/版本，无新迁移。

## 缺图原因与处理

| 证据 | 修复 |
| --- | --- |
| 只读抽样42条资源，5条有图片，9条not_found，28条failed；后两类不能都解释为图库没图 | 独立保存 imageIssue，区分无匹配、网络、超时、限流、格式和配置错误；重试失败保留已确认图片 |
| 太原（晋源区）作为完整城市字符串无法匹配百科简介 | 仅检索时去括号说明、规范化 Unicode，原城市名及实体ID不变 |
| 永祚寺（双塔寺）、纯阳宫、钟楼街·柳巷不能靠一次精确标题查询解决 | 精确名称/别名/组合拆分、城市限定消歧，展示图片实际对应名称，拒绝其它城市同名景点 |
| 过油肉没有匹配百科配图，但 Commons 有实际菜品照；头脑需要城市限定查找 | 独立检索 Commons，检查食品语义、名称边界及许可；拒绝过油肉拌面、菜单票据和灌肠医疗图片 |
| 旧失败记录可一直留在数据库，重试看起来无效 | 缓存v3；旧缺图且无imageIssue记录自动再检查一次，显式重试绕过免费来源负缓存，网络错误不写负缓存 |
| 图鉴原先排除city条目 | 城市照片与景点、美食一同渐进展示 |

## 腾讯云配置与使用

用户已选择腾讯云**联网图像搜索 WIMGS**。[官方接口](https://cloud.tencent.com/document/api/1815/127087) 是 `SearchByText`，不是要求自行导入图库的图像检索服务。采用免费图库→腾讯云补充的顺序，免费图已取得时不产生付费搜索调用。聊天“联网搜索”控制模型查资料，图片是独立资源能力。

先在腾讯云开通联网图像搜索、为凭据授权，再将以下配置填入项目 `.env`（不要发到聊天里），重启应用：

```dotenv
MEDIA_IMAGE_SEARCH=tencent
TENCENTCLOUD_SECRET_ID=填写你的SecretId
TENCENTCLOUD_SECRET_KEY=填写你的SecretKey
TENCENTCLOUD_TOKEN=
MEDIA_IMAGE_SEARCH_HOURLY_LIMIT=60
```

`auto` 仅在凭据齐全时启用腾讯补充；`tencent` 会对缺凭据明确提示配置错误；`off` 仅使用免费来源。临时凭据必须同时填 Token。缺图卡片点击“重新查找图片与定位”；已有正确照片不会强制替换。

每个实体最多一次付费查询；相同查询并发合并。按9月22日用户确认的策略，搜索命中及最终选图缓存1天，空结果10分钟，图片字节缓存7天，避免反复点击产生费用。默认单进程每小时最多60次，可配置；重启清零、多实例各自计数，不能将此视为账户总账单上限。查询12秒超时，最多20候选，最多尝试3张受控CDN缩略图；不下载任意来源站点的原图，不跟随重定向。免费查找与腾讯补充总时长最多约50秒，文字行程不等待图片完成。前后端缓存及重试规则见 [IMAGE_CACHE.md](IMAGE_CACHE.md)。

腾讯资源保留来源网页、站点名、实际命中名称；作者/许可没有提供时写明查看来源页，不编造署名或开放许可。存在结果并不保证标题匹配或图片可下载，仍可能显示暂无匹配。未接入百度图片抓取或 SerpApi。

## 模块与依赖

`media` 保留用户/规划/稳定实体/指纹/revision校验和独立资源写入；`travel-images` 处理提供方顺序；`wikimedia` 和 `providers/tencent-images` 处理接口差异；`media-image` 统一受限下载、sharp解码和缓存；`providers/media-identity` 统一检索名称规则。shared 只扩展资源契约，不接触凭据。

新增官方单产品 SDK `tencentcloud-sdk-nodejs-wimgs@4.1.225`，直接声明并更新Bun锁，取代手写云签名的需要。SDK包解压约25.8 KB，另带公共SDK及传递依赖，仅在服务端打包；无AI SDK/Mastra major升级。现有Drizzle缓存及资源JSON继续使用，无缓存数据库结构迁移。SDK负责HTTP和JSON解析，应用解析后做Zod数量/单条长度校验；图片下载则在读取时执行5 MiB硬限制。

## 可复现验证与边界

- `bun run check:release`：本轮最终结果见 [VERIFICATION](VERIFICATION.md)。涵盖lint/typecheck/单测/Knip、隔离迁移和资源校验、生产构建、HTTP/恢复/浏览器/图文流程。
- `bun run verify:media --real --coverage`：免费来源8项真实下载并解码通过：太原（晋源区）、晋祠、天龙山石窟、纯阳宫、永祚寺（双塔寺）、钟楼街·柳巷、过油肉、头脑（配帽盒、黄酒）。本机日志 `.verification/media-coverage-live.log`；其中组合景点图片对应钟楼街、配餐图片对应头脑，不宣称一张图包含整个组合。
- 示例实图来源：[太原](https://commons.wikimedia.org/wiki/File:Taiyuan20190430.jpg)、[天龙山](https://commons.wikimedia.org/wiki/File:Taiyuan_tianlongshanshiku.JPG)、[头脑](https://commons.wikimedia.org/wiki/File:FuShanTouNao.jpg)。来源、作者和许可随实际资源保存。
- 腾讯适配单测使用本地HTTP，运行真实官方SDK的签名/序列化/响应/错误解析；测试免费优先、缓存合并、额度、缺凭据、越界URL、真实图片解码及伪图片拒绝。`verify:media` 另在Bun运行时实际请求loopback验证SDK；产品隔离夹具强制关闭腾讯云，不能意外用.env密钥计费。
- `bun run verify:media --real --tencent`：配置后仅做一次真实搜索并尝试解码匹配的晋祠图片，使用临时数据库缓存。缺配置/未开通/无可确认图片都会非零退出，不报告假成功。

本机尚无腾讯云密钥，因此**腾讯云真实联调未完成**。百度地图等先前未完成的真实服务验证也没有被这次图片测试替代。此次没有覆盖所有城市和美食；无确认结果时保留真实失败原因及重试，不使用占位图冒充成果。

# 免费图片来源

2026-09-30，按用户要求增加 Wikidata 与 Openverse，不需要申请 API 密钥。实际提供方顺序为 Wikidata → Wikimedia Commons / Wikipedia → Openverse；只有显式选择腾讯云时，才在免费来源均未取得图片后尝试腾讯。

## 使用

在项目 `.env` 中设置下列一项并完整重启服务：

```dotenv
MEDIA_IMAGE_SEARCH=off
```

`off` 表示关闭付费补充，三个免费来源照常启用；也是未配置时的默认值。`auto` 表示凭据完整时允许腾讯补充；`tencent` 表示明确要求腾讯补充，缺少凭据时提示配置错误。图片与聊天的联网搜索开关独立。

本轮已将本机这一项设为 `off`，其余 `.env` 内容保留。现有正确照片保留；旧的缺图状态自动重新检查一次，也可点击“重试图片与定位”。不用迁移数据库或重建行程。

## 匹配与下载

- Wikidata 使用公开 API 查询实体，确认名称、类型与城市证据后读取 P18，再通过 Commons 查询真实图片地址、作者和许可。不会把同名搜索第一条直接当成正确地点。
- Wikimedia 保留中文百科、重定向和 Commons 独立检索能力。
- Openverse 使用匿名搜索，核对名称、城市及菜品语义，保留来源网页、作者和许可。优先使用固定 UUID 的 Openverse 缩略图代理；代理失效时，仅允许已核实的 Wikimedia 图片地址或与来源照片 ID 对应的 Flickr 固定图片 CDN。
- 所有照片均经过实际下载、大小限制与 sharp 解码，再存为 WebP。拒绝任意域名、私网 URL 和重定向；查询结果不等于可显示图片。
- 景点与城市保存为实景照片；通用菜品照片标为菜品示意。组合地点记录图片实际对应的具体名称，保留原行程名称与身份。

免费查询全程不使用模型推理或收费搜索。单轮补图设总期限，各来源有独立超时，一个来源失败可由后续来源补充。成功搜索/选图缓存1天、图片缓存7天；新增来源空结果缓存10分钟，网络错误不写无匹配缓存。

Openverse 匿名服务有配额。本项目保守限制每小时5次、每天100次新搜索，持久化用量并遵守上游 429 退避；多个工作区共用，重复请求优先读缓存。官方线上配额可能变化，不能把无密钥理解为不限量。

## 验证

```powershell
bun run check
bun run verify:media
bun run verify:media --real --free
```

前两项使用隔离夹具，不能证明真实网络或图库覆盖。第三项仅请求两个免费来源，各选一个实体并验证真实下载解码，使用临时数据库，不触碰用户行程；可加 `--wikidata` 或 `--openverse` 只验证单个来源。重复真实探针会消耗匿名额度。

本轮最终 `bun run check:release` 返回0：lint、类型检查、50个测试文件的430项测试、全量与生产Knip、媒体隔离验证、生产构建、HTTP集成、恢复及全部浏览器回归通过。完整输出位于本机 `.verification/free-images-release-final.log`。本地开发服务已用免费模式重启，`http://localhost:3000/login` 返回200，页面标题为“山海行笺 · AI 旅行规划”。

测试覆盖同名异地、菜品误匹配、恶意图片地址、损坏图片、缓存、限流及旧缺图升级。真实样例通过只能证明这些样例；冷门景点、地方菜和临时网络故障仍可能没有可确认的照片，不以无关图片填空。

## 本轮真实样例（2026-09-30）

| 来源 | 查询 | 实际结果 |
| --- | --- | --- |
| Wikidata | 太原晋祠 | P18 关联[圣母殿照片](https://commons.wikimedia.org/wiki/File:Goddess_Temple_Jinsi.JPG)，Gisling / CC BY 3.0，下载解码为960×720 |
| Openverse | 太原晋祠 | [Flickr 晋祠照片](https://www.flickr.com/photos/200217583@N05/54199297843)，patrick20042018 / BY-SA 2.0，缩略图代理424后通过核验过的Flickr地址下载解码为750×1000 |
| Openverse | 过油肉 | [榆次全盛园过油肉](https://commons.wikimedia.org/w/index.php?curid=177933137)，Liuxingy / BY-SA 4.0，经受控Commons地址下载解码为1000×750，人工查看确认为菜品照片，未混用面食 |
| Wikidata | 过油肉 | 无可确认图片，保留真实空结果，可继续后续来源 |

菜品使用菜名查询，不要求通用菜品示意照片拍摄于行程城市；地点仍绑定城市证据。实测发现Commons原图地址携带 `utm_*` 统计参数，因此仅移除已知统计参数后检查固定图片域名，其余查询参数仍拒绝。未调用收费搜索，以上是有限样例，不是准确率或全城市覆盖统计。

## 第一方资料

- [Wikidata 公开数据访问](https://www.wikidata.org/wiki/Wikidata:Data_access)
- [Wikidata P18 图片属性](https://www.wikidata.org/wiki/Property:P18)
- [Commons 图片 API](https://commons.wikimedia.org/wiki/Commons:API/MediaWiki)
- [Openverse 匿名访问与限流处理](https://docs.openverse.org/packages/js/api_client/index.html)
- [Flickr 官方照片 URL 格式](https://www.flickr.com/services/api/misc.urls.html)

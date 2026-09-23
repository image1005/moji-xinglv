# 山海行笺品牌图标

本轮原创矢量图标以折角行笺承载山水：墨色纸边与山脊、竹青山体、朱砂日轮和旅行路径，底色取宣纸。透明画布之外没有矩形底板。16 px 仍保留纸页轮廓、山形与朱砂识别点；功能按钮继续使用既有 `AppIcon`，品牌由 `BrandMark` 单独管理。

| 文件 | 用途 |
| --- | --- |
| `public/brand/shanhai-xingjian.svg` | 可编辑原稿，128 × 128 viewBox，无字体、外链或嵌入位图 |
| `public/brand/shanhai-xingjian.png` | 512 × 512 透明 PNG，可导出使用 |
| `public/brand/apple-touch-icon.png` | 180 × 180 透明 PNG |
| `public/brand/favicon-16.png`、`favicon-32.png` | 16 / 32 px 浏览器图标 |
| `public/favicon.ico` | 包含 16 / 32 px PNG 图像的 ICO |
| `public/brand/size-review.png` | 16 / 32 / 64 / 128 px 真实渲染对比 |

`BrandMark.vue` 已接入登录页和工作区侧栏；`nuxt.config.ts` 注册 SVG、PNG、ICO 和 Apple 图标。侧栏原有拖拽、折叠、抽屉、焦点与权限逻辑保留。

PNG 使用项目已有 Playwright 的 Chromium 渲染 SVG，`deviceScaleFactor: 1`、透明背景截图；ICO 使用标准目录结构封装两个 PNG。没有新增图像运行依赖，也没有把生成图标用作景点或美食图片。

验证：实际渲染并检查 `size-review.png` 的四档尺寸；512、180、32、16 px 的 PNG 均由同一 SVG 导出。完整应用流程的浏览器验收见工程交付记录。

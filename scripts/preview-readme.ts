/**
 * 本地以 GitHub 样式预览 README.md：
 * - marked 按 GFM 渲染 Markdown（支持内嵌 HTML、表格、任务列表）
 * - github-markdown-css 提供与 GitHub 一致的正文排版
 * 产物：.preview/readme.html（可用浏览器直接打开）
 *
 * 用法：bun run preview:readme
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { marked } from 'marked'
import { gfmHeadingId } from 'marked-gfm-heading-id'

marked.use(gfmHeadingId())

const root = process.cwd()
const source = resolve(root, 'README.md')
const outDir = resolve(root, '.preview')
const outFile = resolve(outDir, 'readme.html')

const markdown = readFileSync(source, 'utf8')
const body = marked.parse(markdown, { gfm: true }) as string

const css = readFileSync(resolve(root, 'node_modules/github-markdown-css/github-markdown.css'), 'utf8')
const darkCssPath = resolve(root, 'node_modules/github-markdown-css/github-markdown-dark.css')
let darkCss: string
try {
  darkCss = readFileSync(darkCssPath, 'utf8')
} catch {
  darkCss = css
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>README 预览 · 墨迹行旅</title>
<style>
${css}
.markdown-body {
  box-sizing: border-box;
  min-width: 200px;
  max-width: 980px;
  margin: 0 auto;
  padding: 45px;
}
@media (max-width: 767px) {
  .markdown-body { padding: 24px; }
}
@media (prefers-color-scheme: dark) {
  body { background: #0d1117; }
${darkCss}
}
</style>
</head>
<body>
<article class="markdown-body">
${body}
</article>
</body>
</html>
`

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, html, 'utf8')
copyFileSync(resolve(root, 'README.md'), resolve(outDir, 'README.md'))
console.log(`[preview:readme] 已生成：${outFile}`)
console.log('[preview:readme] 用浏览器打开即可（含 GitHub 样式与徽章）')

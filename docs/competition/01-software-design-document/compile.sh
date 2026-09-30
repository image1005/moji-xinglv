#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== 正在使用 xelatex 编译《软件设计文档》(document.tex) ==="
xelatex -interaction=nonstopmode document.tex
# 运行第二次以生成完整的目录引用与页码编号
xelatex -interaction=nonstopmode document.tex

# 清理中间临时文件
rm -f *.aux *.log *.out *.toc

echo "=== 编译完成：已生成 document.pdf ==="
ls -lh document.pdf

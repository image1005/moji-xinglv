#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== 正在使用 xelatex 编译《作品简介》(brief.tex) ==="
xelatex -interaction=nonstopmode brief.tex
xelatex -interaction=nonstopmode brief.tex

# 清理中间临时文件
rm -f *.aux *.log *.out *.toc

echo "=== 编译完成：已生成 brief.pdf ==="
ls -lh brief.pdf

#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== 正在使用 xelatex 编译《视频脚本与答辩预案》(video_script.tex) ==="
xelatex -interaction=nonstopmode video_script.tex
xelatex -interaction=nonstopmode video_script.tex

# 清理中间临时文件
rm -f *.aux *.log *.out *.toc

echo "=== 编译完成：已生成 video_script.pdf ==="
ls -lh video_script.pdf

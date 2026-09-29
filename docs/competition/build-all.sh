#!/usr/bin/env bash
set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================================"
echo "  华北五省计算机应用大赛材料 · 一键编译全套 PDF 文档"
echo "========================================================"

echo "[1/3] 编译《软件设计文档》(01-software-design-document)..."
"$BASE_DIR/01-software-design-document/compile.sh"

echo "[2/3] 编译《作品简介》(02-project-summary)..."
"$BASE_DIR/02-project-summary/compile.sh"

echo "[3/3] 编译《视频脚本与答辩预案》(03-video-demonstration-script)..."
"$BASE_DIR/03-video-demonstration-script/compile.sh"

echo "========================================================"
echo "  全套大赛材料 PDF 编译成功！成品清单："
echo "========================================================"
ls -lh "$BASE_DIR/01-software-design-document/document.pdf"
ls -lh "$BASE_DIR/02-project-summary/brief.pdf"
ls -lh "$BASE_DIR/02-project-summary/brief-plain.txt"
ls -lh "$BASE_DIR/03-video-demonstration-script/video_script.pdf"

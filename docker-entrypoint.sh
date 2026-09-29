#!/bin/sh
set -e

mkdir -p /app/data

# 尝试自动应用数据库迁移
if [ -f "scripts/migrate-prod.ts" ]; then
  bun run scripts/migrate-prod.ts || true
fi

# 启动 Nuxt/Nitro 生产服务器
exec bun .output/server/index.mjs

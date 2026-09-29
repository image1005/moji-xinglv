FROM oven/bun:1.4 AS builder
WORKDIR /app

# 安装构建依赖
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# 拷贝源码并构建生产全栈产物
COPY . .
RUN bun run build

# 生产精简运行镜像
FROM oven/bun:1.4-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL=file:/app/data/app.db

# 拷贝构建后的服务端与静态客户端资源
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/server/database/migrations ./server/database/migrations
COPY --from=builder /app/scripts/migrate-prod.ts ./scripts/migrate-prod.ts
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/app/data"]

ENTRYPOINT ["/app/docker-entrypoint.sh"]

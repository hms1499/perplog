# Build context is the repository root (fly.toml, render.yaml and railway.toml point here).
FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @perplog/worker...
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@perplog/worker", "start"]

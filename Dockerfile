FROM node:22-slim AS build
# Toolchain for node-gyp: better-sqlite3 compiles from source when no
# prebuilt binary matches the platform (e.g. linux/arm64).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm -r build

FROM node:22-slim
# curl + wget for container health checks — platforms exec one of them
# in-container (Coolify's built-in check uses wget; ours uses curl).
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl wget \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The CLI bundle inlines the workspace packages (tsup noExternal) but still
# resolves real npm deps (better-sqlite3, fastify, ...) from node_modules.
COPY --from=build /app /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8790 \
    PROOFHOUSE_SCAN_DB_PATH=/data/proofhouse-scan.db
VOLUME /data
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:8790/api/health || exit 1
CMD ["node", "packages/cli/dist/index.js", "serve"]

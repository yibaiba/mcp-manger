# The multi-architecture index fixes Python 3.13.9 and uv 0.9.5 for amd64/arm64.
FROM ghcr.io/astral-sh/uv:0.9.5-python3.13-bookworm-slim@sha256:60d8ee2c1f7ffce050822adcb44907514e39f29d2d7b37732e8fca9f4f6113af AS python
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN --mount=type=cache,id=mcp-platform-pnpm,target=/pnpm/store \
    pnpm fetch --frozen-lockfile --store-dir=/pnpm/store
COPY . .
RUN --mount=type=cache,id=mcp-platform-pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm check-types \
    && node scripts/check.mjs 60 pnpm exec vitest run tests/web.test.ts \
    && pnpm build

FROM base AS app
COPY --from=python /usr/local/ /usr/local/
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates libexpat1 libsqlite3-0 libbz2-1.0 libffi8 liblzma5 libncursesw6 libreadline8 libuuid1 zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && python -c 'import sys; assert sys.version_info[:3] == (3, 13, 9)' \
    && uv --version && uvx --version \
    && mkdir -p /app/.data/python/cache /app/.data/python/tools /app/.data/python/bin \
    && chown -R node:node /app/.data
COPY --from=build /app /app
ENV NODE_ENV=production
ENV UV_CACHE_DIR=/app/.data/python/cache \
    UV_TOOL_DIR=/app/.data/python/tools \
    UV_TOOL_BIN_DIR=/app/.data/python/bin \
    UV_PYTHON=/usr/local/bin/python3.13 \
    UV_PYTHON_DOWNLOADS=never \
    PATH=/app/.data/python/bin:$PATH
USER node
EXPOSE 4300
CMD ["pnpm", "start"]

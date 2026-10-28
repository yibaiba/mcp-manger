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
RUN pnpm check-types && pnpm build

FROM caddy:2.10-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile

FROM base AS server
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/.data && chown node:node /app/.data
COPY --from=build /app /app
ENV NODE_ENV=production
USER node
EXPOSE 4300 4302
CMD ["pnpm", "start"]

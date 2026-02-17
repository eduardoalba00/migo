FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
WORKDIR /app

# Copy all package manifests + lockfile first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# Install dependencies (needs all workspace package.jsons for frozen lockfile)
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
RUN pnpm build:server

# Runtime
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
WORKDIR /app

COPY --from=base /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=base /app/packages/shared/package.json packages/shared/
COPY --from=base /app/packages/server/package.json packages/server/
COPY --from=base /app/packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/packages/shared/dist packages/shared/dist
COPY --from=base /app/packages/server/dist packages/server/dist
COPY --from=base /app/packages/server/drizzle packages/server/drizzle

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]

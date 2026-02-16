FROM node:22-slim AS base
RUN apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
WORKDIR /app

# Copy all package manifests + lockfile first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/screen-capture/package.json packages/screen-capture/

# Install dependencies (needs all workspace package.jsons for frozen lockfile)
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
RUN pnpm build:server

# Runtime
FROM node:22-slim
RUN apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
WORKDIR /app

COPY --from=base /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=base /app/packages/shared/package.json packages/shared/
COPY --from=base /app/packages/server/package.json packages/server/
COPY --from=base /app/packages/client/package.json packages/client/
COPY --from=base /app/packages/screen-capture/package.json packages/screen-capture/
RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/packages/shared/dist packages/shared/dist
COPY --from=base /app/packages/server/dist packages/server/dist
COPY --from=base /app/packages/server/drizzle packages/server/drizzle

ENV NODE_ENV=production
EXPOSE 8080
EXPOSE 40000
CMD ["node", "packages/server/dist/index.js"]

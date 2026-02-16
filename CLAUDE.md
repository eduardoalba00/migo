# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
# Install dependencies
pnpm install

# Dev servers (run in separate terminals)
pnpm dev:server          # Starts Postgres + LiveKit via docker compose, then Fastify with tsx watch (port 3000)
pnpm dev:client          # Electron + Vite React app
pnpm dev:client2         # Second client instance (MIGO_INSTANCE=2)

# Production builds
pnpm build:server        # tsc → packages/server/dist/
pnpm build:client        # electron-vite build

# Database (Drizzle ORM + PostgreSQL)
pnpm db:generate         # Generate migration files from schema changes
pnpm db:migrate          # Apply migrations (tsx src/db/migrate.ts)
```

No test framework is configured yet.

## Versioning & Release Pipeline

Everything is in a single workflow: `.github/workflows/version.yml`. Every push to `main` (except `chore(version):` commits) runs three jobs in sequence:

1. **bump** — Determines bump type from the commit message (`feat!:` → major, `feat:` → minor, else → patch). Bumps version in all package.json files + `PROTOCOL_VERSION`, commits as `chore(version): vX.Y.Z`, tags, and pushes.
2. **docker** — Builds the Dockerfile and pushes to GHCR as `ghcr.io/eduardoalba00/migo-server:<version>` and `:latest`.
3. **release** — Checks out the version tag, builds the Electron client on Windows, and publishes to GitHub Releases via electron-builder.

To deploy: `pnpm ship` (merges `dev` → `main`, pushes, switches back to `dev`).

**Important:** All three jobs use `GITHUB_TOKEN` and live in a single workflow because `GITHUB_TOKEN` cannot trigger other workflows.

### Minimum client version

`MIN_CLIENT_VERSION` in `@migo/shared/src/constants.ts` controls the minimum client version the server accepts. Bump this when deploying breaking changes that require a client update. The server rejects WebSocket connections from clients below this version.

### Dockerfile

Multi-stage build: installs deps → builds shared + server → copies only production deps, compiled JS, and Drizzle migration files into a slim runtime image. `NODE_ENV=production` is set so pino-pretty (devDependency) is skipped.

## Self-Hosted Deployment

Production runs via `docker-compose.prod.yml` with all services in one compose stack:

- **postgres** — `postgres:17-alpine` with a persistent volume. Server connects via internal DNS (`postgres:5432`).
- **livekit** — Self-hosted `livekit/livekit-server`. Ports 7880 (API/WS), 7881 (TCP), 50000-50100/udp (WebRTC). Server connects internally (`ws://livekit:7880`); clients connect via `LIVEKIT_PUBLIC_URL`.
- **server** — `ghcr.io/eduardoalba00/migo-server:latest`. Port 8080 (HTTP/WS), 40000-40100 (mediasoup UDP+TCP). Persistent volume at `/data/uploads`.
- **watchtower** — Monitors the server container for new GHCR images, auto-restarts on update (polls every 5 minutes).

Environment variables are in `.env.prod` (see `.env.prod.example`): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_PUBLIC_URL` (public WS URL for clients), `MEDIASOUP_ANNOUNCED_IP` (server's public IP for NAT traversal).

CI/CD: GitHub Actions builds the GHCR image on push to `main`. Watchtower pulls the latest image automatically — no manual deploy step.

Start: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d`

## Architecture

**pnpm monorepo** with four packages:

- **`@migo/server`** — Fastify 5 REST API + WebSocket server. PostgreSQL via Drizzle ORM + postgres.js. Voice via LiveKit (token service). Screen sharing via mediasoup SFU. Auth via argon2 + JWT (jose).
- **`@migo/client`** — Electron 40 desktop app. React 19 renderer built with electron-vite. State management with Zustand. Styling with Tailwind CSS 4 (OKLCH color tokens). UI primitives from Radix UI.
- **`@migo/shared`** — Zod schemas, TypeScript types, WebSocket protocol definitions, and API route constants shared between client and server.
- **`@migo/screen-capture`** — Rust native addon (NAPI-RS) for cross-platform screen/window capture using the `scap` crate.

### Shared package resolution

The shared package uses a custom export condition `@migo/source` so dev tools (tsx, electron-vite) resolve TypeScript sources directly instead of compiled JS. This is set in `tsconfig.base.json` via `customConditions` and in the server dev script via `--conditions @migo/source`.

### Server structure (`packages/server/src/`)

| Directory | Purpose |
|-----------|---------|
| `db/schema/` | Drizzle table definitions (users, servers, server_members, categories, channels, messages, invites) |
| `routes/` | Fastify route handlers (auth, servers, channels, messages, invites) |
| `services/` | Business logic (auth token management, server membership checks) |
| `middleware/` | Bearer token auth extraction |
| `ws/` | WebSocket protocol: connection registry, opcode handler, EventEmitter-based pubsub |
| `voice/` | LiveKit token service, voice state tracking |
| `screenshare/` | mediasoup SFU manager for screen sharing (WebRtcServer on single TCP port) |

Config is env-based (`config.ts`): `PORT` (default 3000), `HOST`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `MEDIASOUP_PORT` (default 40000). Defaults work for local dev (auto-generated JWT secrets, `postgres://localhost:5432/migo`). LiveKit dev server: `docker run --rm -p 7890:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0`.

### Client structure (`packages/client/src/renderer/src/`)

| Directory | Purpose |
|-----------|---------|
| `stores/` | Zustand stores (auth, workspace, servers, channels, messages, voice, ws) |
| `lib/` | HTTP client (`api.ts`), WebSocket manager (`ws.ts`), LiveKit client (`livekit.ts`), screen share manager (`screen-share.ts`) |
| `components/` | React components organized by domain (auth, servers, channels, messages, voice, layout, ui) |
| `pages/` | Top-level views: auth, workspace picker, app shell |

Path alias: `@/*` maps to `src/renderer/src/*` in the client.

### WebSocket protocol

Custom binary-style JSON protocol with opcodes: DISPATCH (0), IDENTIFY (1), HEARTBEAT (2), HEARTBEAT_ACK (3), READY (4), VOICE_STATE_UPDATE (5), VOICE_SIGNAL (6), TYPING_START (7). Dispatch events include MESSAGE_CREATE/UPDATE/DELETE, CHANNEL_CREATE/UPDATE/DELETE, MEMBER_JOIN/LEAVE, VOICE_STATE_UPDATE, TYPING_START, REACTION_ADD/REMOVE, PRESENCE_UPDATE, SCREEN_SHARE_START/STOP. Types defined in `@migo/shared`.

### Auth flow

JWT access (15m) + refresh (7d) tokens. Client stores tokens per workspace in localStorage (`migo-auth-{workspaceId}`). Multi-workspace support allows connecting to different server instances.

## Pre-Commit Checklist

Before every commit, check for breaking changes:

- **Shared schemas changed?** If a Zod schema in `@migo/shared` was modified (fields added, removed, or validators changed), verify that both the server route handlers and client code still conform. A stricter validator can reject previously valid requests (like adding `.url()` to a field that receives relative paths).
- **API contract changed?** If request/response shapes changed, ensure client and server agree. New required fields break older clients.
- **WebSocket protocol changed?** Changes to opcodes or dispatch event payloads require bumping `PROTOCOL_VERSION` and `MIN_CLIENT_VERSION`.
- **Database schema changed?** Run `pnpm db:generate` to create migration files before committing.

## Key Conventions

- All database IDs are UUIDs; timestamps are PostgreSQL `timestamp` type
- Zod validates on both client (forms) and server (route handlers)
- Server routes use `:paramName` path templates with a `fastifyRoute()` helper from `lib/route-utils.ts`
- API route paths are defined as constants in `@migo/shared` and shared across packages
- Theme uses OKLCH color space with CSS custom properties, light/dark via next-themes
- Electron uses frameless window with custom titlebar; IPC bridge exposes window controls (minimize/maximize/close)

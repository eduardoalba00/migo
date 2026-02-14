# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
# Install dependencies
pnpm install

# Dev servers (run in separate terminals)
pnpm dev:server          # Fastify backend with tsx watch (port 8080)
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

## Architecture

**pnpm monorepo** with three packages:

- **`@migo/server`** — Fastify 5 REST API + WebSocket server. PostgreSQL via Drizzle ORM + postgres.js. Voice via LiveKit (token service). Auth via argon2 + JWT (jose).
- **`@migo/client`** — Electron 40 desktop app. React 19 renderer built with electron-vite. State management with Zustand. Styling with Tailwind CSS 4 (OKLCH color tokens). UI primitives from Radix UI.
- **`@migo/shared`** — Zod schemas, TypeScript types, and API route constants shared between client and server.

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

Config is env-based (`config.ts`): `PORT`, `HOST`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Defaults work for local dev (auto-generated JWT secrets, `postgres://localhost:5432/migo`). LiveKit dev server: `docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0`.

### Client structure (`packages/client/src/renderer/src/`)

| Directory | Purpose |
|-----------|---------|
| `stores/` | Zustand stores (auth, workspace, servers, channels, messages, voice, ws) |
| `lib/` | HTTP client (`api.ts`), WebSocket manager (`ws.ts`), LiveKit client (`livekit.ts`) |
| `components/` | React components organized by domain (auth, servers, channels, messages, voice, layout, ui) |
| `pages/` | Top-level views: auth, workspace picker, app shell |

Path alias: `@/*` maps to `src/renderer/src/*` in the client.

### WebSocket protocol

Custom binary-style JSON protocol with opcodes: DISPATCH (0), IDENTIFY (1), HEARTBEAT (2), HEARTBEAT_ACK (3), READY (4), VOICE_STATE_UPDATE (5), VOICE_SIGNAL (6). Dispatch events include MESSAGE_CREATE/UPDATE/DELETE, CHANNEL_CREATE/UPDATE/DELETE, MEMBER_JOIN/LEAVE, VOICE_STATE_UPDATE. Types defined in `@migo/shared`.

### Auth flow

JWT access (15m) + refresh (7d) tokens. Client stores tokens per workspace in localStorage (`migo-auth-{workspaceId}`). Multi-workspace support allows connecting to different server instances.

## Key Conventions

- All database IDs are UUIDs; timestamps are PostgreSQL `timestamp` type
- Zod validates on both client (forms) and server (route handlers)
- Server routes use `:paramName` path templates with a `fastifyRoute()` helper from `lib/route-utils.ts`
- API route paths are defined as constants in `@migo/shared` and shared across packages
- Theme uses OKLCH color space with CSS custom properties, light/dark via next-themes
- Electron uses frameless window with custom titlebar; IPC bridge exposes window controls (minimize/maximize/close)

# Migo

An open-source Discord-like chat platform you can self-host. Text channels, voice chat, screen sharing, DMs, file uploads, custom themes, and more.

**[Download the desktop client](https://github.com/eduardoalba00/migo/releases)**

## Packages

| Package | Description |
|---------|-------------|
| `@migo/server` | Fastify 5 REST API + WebSocket server. PostgreSQL via Drizzle ORM. Voice via LiveKit, screen sharing via mediasoup SFU. |
| `@migo/client` | Electron 40 desktop app. React 19 renderer with Zustand, Tailwind CSS 4, and Radix UI. |
| `@migo/shared` | Zod schemas, TypeScript types, WebSocket protocol definitions, and API route constants shared between client and server. |
| `@migo/screen-capture` | Rust native addon (NAPI-RS) for cross-platform screen/window capture using the `scap` crate. |

## Host Your Own Server

You need a [LiveKit Cloud](https://cloud.livekit.io) account (free tier) for voice chat. The steps below use [Railway](https://railway.app), but any Docker host works.

### 1. Get LiveKit credentials

1. Sign up at [cloud.livekit.io](https://cloud.livekit.io)
2. Create a project
3. Copy your **URL**, **API Key**, and **API Secret**

### 2. Deploy on Railway

1. Create a new Railway project
2. Add a **PostgreSQL** service
3. Click **New** → **Docker Image** and enter:
   ```
   ghcr.io/eduardoalba00/migo-server:latest
   ```
4. Add a **Volume** mounted at `/data/uploads`
5. Under **Networking**, add a **TCP Proxy** on port `40000` (used by the mediasoup screen sharing SFU)
6. Set the following environment variables on the Docker image service:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Railway PostgreSQL reference variable (e.g. `${{Postgres.DATABASE_URL}}`) |
| `JWT_ACCESS_SECRET` | Random string (`openssl rand -hex 32`) |
| `JWT_REFRESH_SECRET` | Different random string |
| `LIVEKIT_URL` | Your LiveKit Cloud WebSocket URL (`wss://your-project.livekit.cloud`) |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `UPLOAD_DIR` | `/data/uploads` |

### 3. Connect

Open Migo → **Add Workspace** → enter your Railway service URL (the public domain from **Networking**). Optionally add a custom domain.

The `:latest` Docker tag always matches the central server, so your instance stays up to date on every redeploy.

## License

[MIT](LICENSE)

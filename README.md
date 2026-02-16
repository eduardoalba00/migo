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

## Self-Host on Railway

Everything runs on [Railway](https://railway.app) with automatic updates — no maintenance required after setup.

### Prerequisites

- A [Railway](https://railway.app) account
- A free [LiveKit Cloud](https://cloud.livekit.io) account (for voice chat)
  - Sign up, create a project, and copy your **URL**, **API Key**, and **API Secret**

### Setup

1. Create a new Railway project
2. Add a **PostgreSQL** service
3. Click **New** → **Docker Image** and enter:
   ```
   ghcr.io/eduardoalba00/migo-server:latest
   ```
4. Add a **Volume** mounted at `/data/uploads`
5. Set the following environment variables on the Docker image service:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Railway PostgreSQL reference variable (e.g. `${{Postgres.DATABASE_URL}}`) |
| `JWT_ACCESS_SECRET` | Random string (`openssl rand -hex 32`) |
| `JWT_REFRESH_SECRET` | Different random string |
| `LIVEKIT_URL` | Your LiveKit Cloud WebSocket URL (`wss://your-project.livekit.cloud`) |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `UPLOAD_DIR` | `/data/uploads` |

6. Under **Networking**, add a **TCP Proxy** on port `40000` (screen sharing)
7. Under **Settings** → **Auto Updates**, enable **Automatically update to the latest tag**

### Connect

Open Migo → **Add Workspace** → enter your Railway public domain (from **Networking**). Optionally add a custom domain.

Your server will automatically redeploy whenever a new version is published.

## License

[MIT](LICENSE)

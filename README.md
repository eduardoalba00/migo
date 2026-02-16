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

## Self-Host with Docker Compose

A single command runs everything: Migo server, PostgreSQL, LiveKit (voice), and Watchtower (auto-updates).

### Prerequisites

- [Docker](https://docs.docker.com/engine/install/) and [Docker Compose](https://docs.docker.com/compose/install/) installed
- Ports open on your firewall: **8080**, **7880-7881**, **40000-40100**, **50000-50100/udp**

### Setup

```bash
git clone https://github.com/eduardoalba00/migo.git && cd migo
```

**Linux / macOS:**
```bash
chmod +x setup.sh && ./setup.sh
```

**Windows (PowerShell):**
```powershell
.\setup.ps1
```

The setup script auto-detects your public IP, generates all secrets, and starts the server.

### Connect

Open Migo → **Add Workspace** → enter `http://<your-server-ip>:8080`.

Watchtower checks for new server images every 5 minutes and automatically restarts the container when an update is available.

## License

[MIT](LICENSE)

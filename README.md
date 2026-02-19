<p align="center">
  <img src="packages/client/resources/icon.png" width="128" alt="Migo" />
</p>

# Migo

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![GitHub Release](https://img.shields.io/github/v/release/eduardoalba00/migo)](https://github.com/eduardoalba00/migo/releases)

An open-source, self-hosted chat platform with text channels, voice chat, screen sharing, direct messages, file uploads, and custom themes.

**[Download the Desktop Client](https://github.com/eduardoalba00/migo/releases)**

<!-- TODO: Add screenshots -->

## Features

- **Text channels** — organized by categories, with message editing, reactions, and file attachments
- **Voice chat** — real-time voice channels with per-user volume control and noise suppression (Krisp)
- **Screen sharing** — VP9 video at 60fps with process-specific audio capture (Windows)
- **Direct messages** — private conversations outside of servers
- **File uploads** — drag-and-drop images and files into any channel
- **Roles & permissions** — manage members with customizable roles
- **Custom themes** — light and dark mode with OKLCH color tokens
- **Auto-updates** — the desktop client updates itself via GitHub Releases
- **Self-hosted** — run the server on your own hardware with Docker Compose

## Tech Stack

| Package | Stack |
|---------|-------|
| **`@migo/server`** | Fastify 5, PostgreSQL (Drizzle ORM), LiveKit, JWT auth (jose) |
| **`@migo/client`** | Electron 40, React 19, Zustand, Tailwind CSS 4, Radix UI, LiveKit SDK |
| **`@migo/shared`** | Zod schemas, TypeScript types, WebSocket protocol definitions |

## Self-Host with Docker Compose

Docker Compose runs the Migo server, PostgreSQL, and Watchtower (auto-updates). Voice and screen sharing are handled by [LiveKit Cloud](https://cloud.livekit.io).

### Prerequisites

- [Docker](https://docs.docker.com/engine/install/) and [Docker Compose](https://docs.docker.com/compose/install/) installed
- A free [LiveKit Cloud](https://cloud.livekit.io) project (for voice + screen sharing)
- Port **8080** open on your firewall

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

The setup script auto-detects your public IP, generates secrets, and prompts you for your LiveKit Cloud credentials.

### Connect

Open Migo → **Add Workspace** → enter `http://<your-server-ip>:8080`.

Watchtower checks for new server images every 5 minutes and automatically restarts the container when an update is available.

## Self-Hosting LiveKit (Advanced)

LiveKit Cloud is recommended for most users. If you prefer to self-host LiveKit for full control or lower latency, install it **natively on the host** — not in Docker. Docker's UDP port forwarding (especially on Windows/WSL2) causes severe performance issues with WebRTC media.

### Install LiveKit Server

**Linux (amd64):**
```bash
curl -sSL https://get.livekit.io/linux | bash
```

**macOS:**
```bash
brew install livekit
```

**Windows:** Download the binary from [LiveKit releases](https://github.com/livekit/livekit/releases).

### Configure and Run

Create a `livekit.yaml`:

```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: true
keys:
  your-api-key: your-api-secret
```

```bash
livekit-server --config livekit.yaml
```

Open these additional firewall ports:
- **7880** TCP — LiveKit signaling
- **7881** TCP — LiveKit TCP media fallback
- **50000-50100** UDP — WebRTC media

Then set `LIVEKIT_URL=ws://<your-server-ip>:7880` in your `.env.prod`.

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+
- [Docker](https://docs.docker.com/engine/install/) (for PostgreSQL + LiveKit in dev)
- Windows: Visual Studio Build Tools (for the native audio capture addon)

### Setup

```bash
git clone https://github.com/eduardoalba00/migo.git && cd migo
pnpm install
```

### Dev Servers

Run in separate terminals:

```bash
pnpm dev:server    # Starts Postgres + LiveKit via docker compose, then Fastify (port 3000)
pnpm dev:client    # Electron + Vite React app
```

### Other Commands

```bash
pnpm build:server        # tsc → packages/server/dist/
pnpm build:client        # electron-vite build
pnpm db:generate         # Generate Drizzle migration files from schema changes
pnpm db:migrate          # Apply migrations
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor workflow.

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before opening a pull request.

## License

[AGPL-3.0](LICENSE)

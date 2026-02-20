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

## Self-Host

Docker Compose runs the Migo server, PostgreSQL, and Watchtower (auto-updates). LiveKit runs natively (auto-downloaded) for best voice/video performance.

### Quick Start (Linux VPS)

```bash
curl -fsSL https://raw.githubusercontent.com/eduardoalba00/migo/main/scripts/install-linux.sh | sudo bash
```

This installs git, Docker, and Node.js, clones the repo to `/opt/migo`, opens firewall ports, generates secrets, and starts everything.

```bash
cd /opt/migo
node scripts/start-prod.mjs   # Start services
node scripts/stop-prod.mjs    # Stop all services
```

### Manual Setup

If you already have Docker and Node.js 20+ installed:

```bash
git clone https://github.com/eduardoalba00/migo.git && cd migo
node scripts/setup.mjs
```

Required firewall ports: **8080** TCP, **7880** TCP, **7881** TCP, **50000-60000** UDP

### Connect

Open Migo → **Add Workspace** → enter `http://<your-server-ip>:8080`.

Watchtower checks for new server images every 5 minutes and automatically restarts the container when an update is available.

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+
- [Docker](https://docs.docker.com/engine/install/) (for PostgreSQL in dev)
- Windows: Visual Studio Build Tools (for the native audio capture addon)

### Setup

```bash
git clone https://github.com/eduardoalba00/migo.git && cd migo
pnpm install

# Windows only — build the native audio capture addon
cd packages/client && npx node-gyp rebuild && cd ../..
```

### Dev Servers

```bash
pnpm dev           # Starts Postgres (Docker) + LiveKit (native) + Fastify — all in one command
pnpm dev:client    # Electron + Vite React app (separate terminal)
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

# Migo

An open-source Discord-like chat platform you can self-host. Text channels, voice chat, screen sharing, DMs, file uploads, custom themes, and more.

**[Download the desktop client](https://github.com/eduardoalba00/migo/releases)**

## Packages

| Package | Description |
|---------|-------------|
| `@migo/server` | Fastify 5 REST API + WebSocket server. PostgreSQL via Drizzle ORM. Voice + screen sharing via LiveKit. |
| `@migo/client` | Electron 40 desktop app. React 19 renderer with Zustand, Tailwind CSS 4, and Radix UI. |
| `@migo/shared` | Zod schemas, TypeScript types, WebSocket protocol definitions, and API route constants shared between client and server. |

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

## License

[MIT](LICENSE)

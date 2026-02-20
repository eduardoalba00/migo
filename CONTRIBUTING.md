# Contributing to Migo

Thanks for your interest in contributing! This guide covers the development workflow and conventions used in this project.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+
- [Docker](https://docs.docker.com/engine/install/) (for PostgreSQL in dev)
- Windows: Visual Studio Build Tools (for the native audio capture addon)

### Install

```bash
git clone https://github.com/eduardoalba00/migo.git
cd migo
pnpm install
```

### Run Dev Servers

```bash
# Terminal 1 — starts Postgres (Docker) + LiveKit (native) + Fastify server on port 3000
pnpm dev

# Terminal 2 — Electron + Vite React app
pnpm dev:client
```

### Other Useful Commands

```bash
pnpm build:server        # TypeScript compile → packages/server/dist/
pnpm build:client        # electron-vite build
pnpm db:generate         # Generate Drizzle migration files from schema changes
pnpm db:migrate          # Apply migrations
```

## Workflow

1. **Fork** the repository and clone your fork
2. **Create a branch** from `dev` (not `main`):
   ```bash
   git checkout dev
   git checkout -b feat/my-feature
   ```
3. **Make your changes** and commit using [conventional commits](#commit-messages)
4. **Push** to your fork and open a **Pull Request against `dev`**

> PRs should target the `dev` branch. The `main` branch is reserved for releases.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/) to automate versioning:

| Prefix | Bump | Example |
|--------|------|---------|
| `feat:` | minor | `feat: add emoji reactions to messages` |
| `fix:` | patch | `fix: prevent crash when uploading large files` |
| `feat!:` or `fix!:` | major | `feat!: redesign WebSocket protocol` |
| `chore:`, `docs:`, `refactor:`, `test:` | patch | `docs: update self-hosting guide` |

Keep commits focused — one logical change per commit.

## Code Style

- **TypeScript strict mode** — no `any` unless absolutely necessary
- **Zod validation** on both client (forms) and server (route handlers)
- **Tailwind CSS 4** for styling — use OKLCH color tokens via CSS custom properties
- **Radix UI** for accessible UI primitives
- API route paths are defined as constants in `@migo/shared` and shared across packages
- Server routes use Fastify with a `fastifyRoute()` helper from `lib/route-utils.ts`

## Pre-Submit Checklist

Before opening your PR, verify:

- [ ] **Shared schemas** — if you changed a Zod schema in `@migo/shared`, both server and client still conform
- [ ] **API contracts** — if request/response shapes changed, server and client agree
- [ ] **WebSocket protocol** — changes to opcodes or dispatch events require bumping `PROTOCOL_VERSION` and `MIN_CLIENT_VERSION`
- [ ] **Database schema** — run `pnpm db:generate` to create migration files
- [ ] **Native addon** — if changed, run `npx node-gyp rebuild` and `node src/native/test-capture.cjs` in `packages/client`

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Fill out the PR template (summary, related issue, test plan)
- Add or update tests where applicable (`pnpm --filter @migo/client test`)
- PRs require at least one approving review before merge

## Reporting Issues

Use the [GitHub issue templates](https://github.com/eduardoalba00/migo/issues/new/choose) to report bugs or request features.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license.

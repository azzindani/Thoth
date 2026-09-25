# Thoth

**An open, self-hosted global intelligence terminal.**

Thoth collects live open-source intelligence (earthquakes, flights, fires,
severe weather, disasters, conflicts, cyber advisories, sanctions, markets,
news and more) from 300+ public sources, stores it in one PostgreSQL
database with full provenance, and shows it on an interactive globe.

[![ci](https://github.com/azzindani/Thoth/actions/workflows/ci.yml/badge.svg)](https://github.com/azzindani/Thoth/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Features

- **Keyless by default.** Every core feed works without an API key or a paid
  plan. Optional keys add depth and are never required.
- **One database with provenance.** Each map point keeps the raw upstream
  payload, a normalized record, and its source. Every point can be cited.
- **Live and historical.** Server-Sent Events push layer changes as they
  land. SQL-backed history drives timelines, replay and trend charts.
- **Honest freshness.** Stale, frozen and warming feeds are labelled in the
  UI. A failing feed never shows up as an empty map.
- **Built-in monitoring.** Per-source run history, upstream call logs,
  alerts, a Prometheus `/metrics` endpoint, and a monitor tab in the UI.
- **Analyst workflow.** Incidents and anomaly detection (no LLM), area
  watches, country pages, time replay, map notes, sitrep export, saved
  workspaces and a command palette.
- **Responsive.** One terminal layout that adapts to desktop, tablet and
  phone.

## Architecture at a glance

```
browser ──► app (Next.js, :3000) ──► api (Express, :4000) ──► PostgreSQL 16
            access gate, /api proxy   REST + SSE                + TimescaleDB + PostGIS
                                                                  ▲
                                      worker (collectors) ────────┘
```

| Component | Path | Stack |
|---|---|---|
| Web terminal | [`app/`](app/) | Next.js 16, React 19, MapLibre GL 6 |
| API + collector worker | [`backend/`](backend/) | Node.js 22, Express 5, TypeScript, `pg`, zod |
| Database | [`backend/db/migrations/`](backend/db/migrations/) | PostgreSQL 16, TimescaleDB, PostGIS |

For the full picture, see [Architecture](docs/architecture/overview.md).

## Quick start

### Docker Compose (recommended)

Requires Docker with Compose v2.

```bash
git clone https://github.com/azzindani/Thoth.git && cd Thoth/backend
export POSTGRES_PASSWORD=$(openssl rand -hex 32)
export API_WRITE_KEY=$(openssl rand -hex 32)
export APP_ACCESS_KEY=$(openssl rand -hex 32)
docker compose up -d --build
```

Open `http://localhost:3000/?token=$APP_ACCESS_KEY`. Static layers appear
right away. Live layers fill in over the next few minutes, and slower feeds
catch up over a few hours.

### Local development

Requires Node.js 22 and PostgreSQL 16 with PostGIS (TimescaleDB is
recommended).

```bash
cd backend && npm ci   # defaults expect postgres://thoth:thoth@localhost:5432/thoth
npm run db:migrate && npm run db:seed && npm run db:seed:fixtures
npm run dev:api      # terminal 1, http://localhost:4000
npm run dev:worker   # terminal 2
cd ../app && npm ci && npm run dev   # terminal 3, http://localhost:3000
```

For the details, see [Getting started](docs/getting-started.md).

## Documentation

| | |
|---|---|
| **Use** | [Getting started](docs/getting-started.md) · [API reference](docs/reference/api.md) · [Data sources](docs/reference/data-sources.md) |
| **Operate** | [Deployment](docs/operations/deployment.md) · [Configuration](docs/operations/configuration.md) · [Monitoring](docs/operations/monitoring.md) · [Backup & restore](docs/operations/backup-and-restore.md) · [Upgrading](docs/operations/upgrading.md) · [Troubleshooting](docs/operations/troubleshooting.md) |
| **Understand** | [Architecture](docs/architecture/overview.md) · [Database](docs/architecture/database.md) · [Security model](SECURITY.md) |
| **Contribute** | [Contributing](CONTRIBUTING.md) · [Conventions](docs/development/conventions.md) · [Testing](docs/development/testing.md) · [Adding data sources](docs/development/adding-data-sources.md) · [UI design system](docs/development/ui-design-system.md) |
| **Plan** | [Roadmap](docs/roadmap.md) · [Changelog](CHANGELOG.md) |

The full index is in [`docs/`](docs/README.md).

## Acknowledgements

Thoth adapts patterns from several open-source monitoring projects:
worldmonitor, osiris, shadowbroker, ironsight, globenewslive,
global-monitor, world-dashboard, FinceptTerminal and flowsint. Upstream
data belongs to its publishers. Attribution and licence notes for each
source are listed in [Data sources](docs/reference/data-sources.md).

## License

[MIT](LICENSE)

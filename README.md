# Thoth

**Verbose global intelligence terminal — Palantir Maven meets Bloomberg, open and agent-ready.**

Thoth fuses live OSINT streams (flights, ships, sats, quakes, fires, weather, news, Telegram, markets, cyber, sanctions, crypto, CCTV) into **one PostgreSQL database**, serves them live over WebSocket + REST, and exposes them to **AI agents** via a single signed command channel + MCP.

Learned from: `worldmonitor` (risk scoring, seeder/reader, MCP/CLI parity, bootstrap tiers), `osiris` (RECON toolkit, CCTV mesh, Telegram geoparse, crypto/OFAC), `shadowbroker` (AI command channel, two-tier poll, pins/TTL), `ironsight` (theater toggle, 15s-10m polling), `globenewslive` (free brief API), `global-monitor` (ws-per-layer + health), `world-dashboard` (COLLECTORS registry). Sources in `/workspace/.tmp/`.

## Why Thoth

All seven references serve from memory/Redis/JSON. None keep verbose history. None prove provenance per dot. None let agents query the past.

Thoth does:
1. Store raw + normalized + lineage — every dot is citable
2. Stream live (WS + SSE versions) and replay history (SQL + timeline)
3. Let humans use a Bloomberg terminal and agents use the same surface

## Stack (production grade)

- **Language:** TypeScript throughout (Next.js App Router frontend + Node ingestion workers)
- **DB:** PostgreSQL 16 + TimescaleDB + PostGIS — single source of truth
- **Map:** MapLibre GL (2D) + globe.gl (3D), shared layer catalog
- **API:** Next.js Route Handlers + `POST /api/ai/channel/command` + MCP at `/mcp`
- **Ingest:** TypeScript workers (`tsx`), APScheduler-style registry, `stealthFetch` + SSRF guard + per-source rate limit
- **Deploy:** Docker Compose (web + worker + db), GHCR images, non-root

## Repo layout (target)

```
thoth/
  src/app/api/        # REST + WS proxy + ai/channel + mcp
  src/lib/layers/     # layer catalog (renderer, interval, premium, i18n)
  src/components/     # Panel base, Map, Dossier, Terminal bar
  workers/collectors/ # one file per source: flights.ts, quakes.ts, ...
  workers/lib/        # fetch, normalize, store, health
  db/migrations/      # SQL: hypertables, indexes, retention
  sdk/ts/ sdk/py/     # agent clients
  docker-compose.yml
```

## Docs

- `ARCHITECTURE.md` — system, tiers, cache, stream protocol
- `DATABASE.md` — Postgres schema, Timescale, PostGIS, retention
- `DATA_SOURCES.md` — verbose catalog, keyless / free-key / paid, polling
- `AI_AGENTS.md` — command channel, MCP, tools, auth, skills
- `ROADMAP.md` — Phase 0-3 to production

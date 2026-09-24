# Thoth

**Verbose global intelligence terminal — Palantir Maven meets Bloomberg, open and agent-ready.**

Thoth fuses live OSINT streams (flights, sats, quakes, fires, weather, news,
Telegram, markets, cyber, sanctions, crypto, CCTV, …) from ~300 keyless
public sources into **one PostgreSQL database**, serves them over REST + SSE,
and renders them on a MapLibre globe terminal.

Learned from: `worldmonitor` (risk scoring, seeder/reader, bootstrap tiers),
`osiris` (RECON toolkit, CCTV mesh, Telegram geoparse, crypto/OFAC),
`shadowbroker` (command channel, two-tier poll, pins/TTL), `ironsight`
(theater toggle), `globenewslive` (free brief API), `global-monitor`
(per-layer streams + health), `world-dashboard` (COLLECTORS registry).
Per-project digests: `docs/PORT-*.md`.

## Why Thoth

The references serve from memory/Redis/JSON: no verbose history, no
per-dot provenance, no way for agents to query the past. Thoth:

1. Stores raw + normalized + lineage — every dot is citable
2. Streams live (SSE) and replays history (SQL + timeline)
3. Is honest about freshness — stale, frozen and warming feeds are shown, never hidden

## What's in the repo

```
backend/   Express API (:4000) + collector worker, TypeScript, pg, zod
           56 collectors · 107 routes · migrations · vendored static datasets
app/       Next.js 16 terminal (:3000): globe, inspector, tabs, command bar
docs/      architecture, schema, sources, production + hosting runbooks
```

Stack: TypeScript throughout · PostgreSQL 16 + TimescaleDB + PostGIS ·
Express 5 · Next.js 16 / React 19 · MapLibre GL 6 · Docker Compose · GitHub Actions.

## Quick start

```bash
# backend (needs Postgres 16 + PostGIS locally, or use compose below)
cd backend && cp .env.example .env && npm ci
npm run db:migrate && npm run db:seed && npm run db:seed:fixtures
npm run dev:api & npm run dev:worker &
# app
cd ../app && npm ci && npm run dev      # http://localhost:3000
```

Production (Docker Compose, auth, secrets, probes, upgrades): **`docs/PRODUCTION.md`**.

## Docs

- `docs/PRODUCTION.md` — security model, config reference, deploy checklist, operations, upgrade notes
- `docs/HOSTING.md` — host handover runbook · `docs/BACKUP.md` — backup/restore
- `ARCHITECTURE.md` — system, tiers, stream protocol
- `DATABASE.md` — Postgres schema, Timescale, PostGIS, retention
- `DATA_SOURCES.md` — source catalog (keyless / free-key / paid)
- `docs/CONVENTIONS.md` — the bar every change is judged against
- `docs/PHASES.md` / `docs/OUTSTANDING.md` — progress ledger and open work
- `AI_AGENTS.md` + `ROADMAP.md` — **planned** agent surface (HMAC command
  channel, MCP, SDKs); not built yet — see ROADMAP Phase 3

## License

MIT — see `LICENSE`.

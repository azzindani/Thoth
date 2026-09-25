# Thoth — Architecture (TypeScript + PostgreSQL, production grade)

## 1. Overview

```
Browser / Terminal
  MapLibre 2D + Globe 3D + Panels + CmdK bar + Dossier
    │  REST GET /api/*  │  WS /stream  │  SSE /stream/versions
Next.js App Router
  /api/layers/*  /api/dossier  /api/brief  /api/signals
  /api/ai/channel/command  /mcp
    │
Ingestion workers (TypeScript, separate process)
  COLLECTORS registry → fetch → normalize → upsert Postgres
    │
PostgreSQL 16 + TimescaleDB + PostGIS (ONE DB)
  raw_events (immutable) → events (hypertable) → entity_graph
```

No Redis required for v0. Postgres is cache + store. Add Redis only for WS fan-out at scale.

## 2. Ingestion

`workers/collectors/*.ts` registered in `workers/registry.ts`:

```ts
export const COLLECTORS = {
  flights: { module: './flights', intervalSec: 60, ttlSec: 120 },
  quakes: { module: './quakes', intervalSec: 60, ttlSec: 300 },
  oref_alerts: { module: './oref', intervalSec: 15, ttlSec: 60 },
  telegram: { module: './telegram', intervalSec: 60, ttlSec: 600 },
  gdelt: { module: './gdelt', intervalSec: 300, ttlSec: 3600 },
  markets: { module: './markets', intervalSec: 600, ttlSec: 900 },
  firms: { module: './firms', intervalSec: 600, ttlSec: 3600 },
} as const;
```

Stagger start `i*2s` (from world-dashboard). Two tiers (from shadowbroker):
- fast 15-60s: flights (adsb.lol), OREF/alerts, Neptun, sats SGP4 propagate, quakes
- slow 5-10m: GDELT, FIRMS, CCTV probe, markets/Polymarket, sanctions refresh

Each run: `fetch (stealthFetch UA rotate, SSRF-guard, 150ms Yahoo stagger) → validate (zod) → insert raw_events → normalize → upsert events → update feed_health`.

Viewport rule (from osiris/worldmonitor): browser loads counts via `/api/stats` first, full slices only for visible layers + bbox. `layerFetchedRef` dedupes. ETag + gzip.

## 3. Serving

- `GET /api/stats` — counts only, for layer badges
- `GET /api/layers/:layer?bbox=&since=` — normalized GeoJSON-ish `{items,total,serverTs,versions}`
- `GET /api/versions` — `{layer: version}` for `since_layer_versions` polling
- `WS /stream` — `{type:'update', layer, data, ts}` per-layer (global-monitor pattern), auto-reconnect
- `GET /api/dossier?lat=&lng=` — conflicts+GDELT+news+weather+sanctions composite (osiris region-dossier)
- `GET /api/brief` — deterministic keyword classify CRITICAL→INFO + template brief, zero LLM cost (globenewslive)
- `GET /api/health` — `{uptime, perFeed: {lagSec, lastOk, hitRate}, dbSize, versions}`

Boot tiers (worldmonitor): fast payload <3s (counts + visible layers), slow <5s (dossier deps), on-demand (CCTV, RECON, history).

## 4. Frontend terminal (Maven + Bloomberg)

- Responsive contract + primitive catalog: `docs/UI_PRIMITIVES.md` (desk/tab/phone breakpoints, 9 builders).
- Single MapLibre engine, globe projection default (GLOBE/FLAT toggle). No dots: every layer renders
  Lucide SVG symbols (ISC) baked to sprites in layer colors on a dark halo; flights rotate by track.
  Legend, dossier and inspector reuse the same glyphs.
- `Panel` base: `setContent`, 150ms debounce, Immediate/Deferred tiers + shell placeholders (no layout shift)
- Theater toggle (ironsight): `src/lib/theaters/iran-israel.ts`, `russia-ukraine.ts` — one object re-points feeds/map
- Wartime Mode preset, day/night terminator, range rings, measure, Ctrl+K search, F/E/S/D shortcuts
- Cinema Mode wall view + Tape Mode firehose (SitDeck)
- Pins: agent or human `place_pin {cat, lat, lng, ttl}` — 14 cats, visible <15s via WS

## 5. Production rules

- TypeScript strict, zod at ingest + API boundary, `npm run typecheck`, `lint:boundaries` (`types→config→services→components→app`)
- Migrations in `db/migrations/*.sql`, never auto-sync prod
- SSRF-guard allowlist for all fetches, per-IP rate limit, User-Agent on every upstream fetch
- Health is load-bearing: stale feed → intelligence-gap badge, never silent empty
- Non-root Docker, `DATABASE_URL` + `SCANNER_URL/KEY` only secrets, everything else keyless-first

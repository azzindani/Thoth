# Thoth — Roadmap to production (TypeScript + PostgreSQL)

> Priority: automated live data first, AI last. Phases 0-2 ship a self-running
> terminal (collect → store → stream → map) with zero AI dependency. Phase 3 (agents)
> lands only after live automation is solid.

## Phase 0 — Verbose core (2-3 weeks)
- [ ] Next.js 16 + TS strict + MapLibre + `layer-catalog.ts` (6 layers)
- [ ] Postgres + Timescale + PostGIS, `001_init.sql` (raw_events, events, health, versions)
- [ ] 6 collectors: adsb.lol, CelesTrak, USGS, FIRMS CSV, EONET, GDELT + `registry.ts` + staggered cron
- [ ] `/api/stats`, `/api/layers/:layer`, `/api/versions`, `/api/health`, WS `/stream`
- [ ] Docker Compose: `web`, `worker`, `db`. `npm run db:migrate`, `typecheck`, single `health` green

## Phase 1 — Maven depth (3-4 weeks)
- [ ] Telegram `t.me/s` scrape + geoparse, RSS news + relevance filter, markets (Yahoo/CoinGecko/Polymarket)
- [ ] OpenSanctions CSV → DB + crypto (mempool/Blockscout) + SANCTIONED badge
- [ ] 10 CCTV scrapers + probe/proxy, dossier endpoint, theater toggle (2 theaters)
- [ ] RECON split: web never scans, delegate to scanner backend via `SCANNER_URL/KEY` (503 without)
- [ ] Timeline scrubber (history from DB — your moat vs all 7 refs)

## Phase 2 — Live automation depth (next)
- [x] SSE `/api/stream` (layer_changed + snapshot + heartbeat), frontend EventSource auto-update
- [x] NWS weather alerts + NOAA space weather collectors
- [x] Scheduler daemon verified: 9 collectors staggered, 8 live, 1 degraded-honest (GDELT 429)
- [ ] CCTV probe/proxy (5-10 easiest DOT scrapers), OpenSanctions → DB, dossier endpoint
- [ ] Timeline scrubber (history replay — the moat), retention policies live, `pg_dump` + PITR

## Phase 3 — Agents (LAST)
- [ ] `POST /api/ai/channel/command|/batch`, `GET /api/ai/tools`, HMAC auth + tiers + `verify_hmac` tests
- [ ] MCP `/mcp` mirroring channel, `llms.txt`, TS + Py SDKs, OpenClaw skill
- [ ] `/api/brief` deterministic + optional Gemini, `place_pin` + AI-Intel layer live <15s

## Phase 3 — Bloomberg terminal + hardening
- [ ] Ctrl+K bar, watchlists, alerts (3 free daily checks), area PDF, Cinema/Tape modes
- [ ] Auth (Clerk or self), entitlements, `WORLDMONITOR_VALID_KEYS`-style API keys, rate limits, audit log
- [ ] Retention policies + continuous aggregates, `pg_dump` + PITR, load test WS 1k clients, CSP + SSRF audit
- [ ] Docs site + `apiCatalog.ts` + status page from `feed_health`

## Done = production
`docker compose up` → map live in <3s first paint, WS streaming, history replayable, agent can `get_summary → get_layer_slice → place_pin` with HMAC, health shows per-feed lag, raw row exists for every dot.

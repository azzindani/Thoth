# Thoth — Adding More Open-Source Endpoints

Thoth is designed to absorb more open-source endpoints over time. This catalog is v0 — expect it to grow as we digest new repos and public feeds.

## Rules for new endpoints

1. Keyless-first. Only add a keyed source if a keyless fallback exists or is documented as degraded.
2. Every new source gets: collector + raw_events write + normalized events mapping + `feed_health` + `layer_versions` bump + docs row below.
3. No frontend layer without a DB table + collector behind it.
4. Attribution required: keep `source`, `url`, license, credit per row.

## How to propose one

Add a row to the backlog table, then implement `workers/collectors/<name>.ts` + `GET /api/layers/<name>`:

```ts
// workers/registry.ts
myfeed: { module: './myfeed', intervalSec: 300, ttlSec: 900 },
```

```bash
GET /api/layers/myfeed?bbox=&since=
GET /api/stats   # must include myfeed count
GET /api/health  # must include myfeed lag
```

## Candidate queue (keyless only — the loop works top-down)

Keyed sources (OpenSky OAuth2, AISHub, OpenAQ/WAQI, ACLED, …) are out of the
loop by definition; they stay in DATA_SOURCES.md "Free-key".

| Source | Layer | Status | Notes |
|---|---|---|---|
| Vigicrues France flood vigilance (`vigicrues.gouv.fr/services/1/InfoVigiCru.jsonld`) | disasters | blocked | TCP connect times out from this host and the worker (2026-09-24; same IP on both resolvers) — operator |
| waterlevel.ie (OPW Ireland) GeoJSON | oceans | parked | live (464 level sensors, CC BY 4.0) but no flood thresholds — every reading would be an unrankable info dot; needs per-station statistics first |
| SA CFS / TAS TFS / NT PFES bushfire feeds | fires | blocked | old paths moved (2026-09-24: SA `data.eso.sa.gov.au` 197B HTML, TAS 410, NT 404) — find current ones, then extend `wildfires` |
| Canada CWFIS active fires | fires | blocked | old CSV path 404s (2026-09-24); find the current one |
| JMA warnings (`jma.go.jp/bosai/warning/data/…`) | weather | candidate | keyless JSON (HKO `warnsum` shipped in batch36) |
| abuse.ch SSLBL (`sslbl.abuse.ch/blacklist/sslblacklist.csv`) | cyber | candidate | CSV, 813 KB (CERT-FR/CERT-EU/CCCS/JPCERT advisories shipped as `certs`) |
| NCSC-UK feeds (`ncsc.gov.uk/api/1/services/v1/*-rss-feed.xml`) | cyber | parked | live, but news/reports/guidance only — no advisory feed to grade |
| ACSC cyber.gov.au alerts/advisories RSS | cyber | blocked | HTTP/2 stream reset, then connect/read timeouts from this host (2026-09-24) — operator |
| WHO Disease Outbreak News API | health | candidate | keyless JSON |
| ReliefWeb API | disasters | check | appname may now need approval — probe before building |

When a source is live, move it to `ENDPOINTS.md` + `DATA_SOURCES.md` and drop
its row here. Add new finds at the bottom with a one-line probe note.

## Keyless loop (the recurring shipping job)

**Fix first, then ship.** Each run starts from the monitor
(`curl -s localhost:4000/api/monitor/sources`, state `failing`). While any
fixable keyless source is failing, the run is a fix-or-drop pass; only when
none is left does it ship one small batch (2–6 new sources). Every step is on
the real host, in one checkout on `main` — no subagents, no worktrees, no
branches.

### Fix-or-drop pass

1. **Diagnose inside the worker container** (`docker compose exec -T worker
   node -`): print the HTTP status or `err.cause.code`. "fetch failed" hides
   the real error. Compare with `curl` from the host and with `dig @1.1.1.1`
   (this host's resolver sometimes filters).
2. **Fix** the request (moved URL, parameters, `Accept`, spacing for 429s,
   timeout for slow-but-working upstreams), the parser, or the health rule.
   The cause goes in a comment next to the constant that fixes it.
3. **Drop** only when the upstream now needs a key, is gone, or is redundant
   and unfixable: remove the leg, its `source-map.ts`/`freeze.ts` entries and
   test stubs, then delete its `feed_health` row in production — the one
   production write allowed.
4. **Host-blocked** (IP/geo/WAF/DNS filtering, confirmed from the host too):
   don't route around it — list it in OUTSTANDING.md for the operator.

### Shipping a batch

1. **Pick** from the candidate queue (or find new ones). Grep `backend/src`
   for the upstream host first — 300+ sources exist and duplicates waste a run.
2. **Probe live** from the host *and* from inside the worker container
   (`docker compose exec worker node -e 'fetch(…)'`) — some upstreams refuse
   this VPS's egress. Drop anything that needs a key or signup, 4xx/5xx, or has
   unclear terms. Note the drop in the queue.
3. **Build** by extending the collector that owns the theme, or a new
   `collectors/<name>.ts` + `registry.ts` entry; add every new source to
   `api/source-map.ts`, and to `NEVER_FROZEN` in `api/freeze.ts` if it
   publishes a current picture that can legitimately be empty. Current-picture
   feeds `pruneStale` after a successful poll; a changed payload shape throws
   rather than emptying the layer. Points only on point layers (`lib/geo.ts`
   `pointOf` for areas). ≤700 LOC per file.
4. **Test**: contract tests in the collector's own file,
   `test/collectors-<collector>.test.ts` (create it for a new collector) —
   files, describes and comments are named by what they collect, never by
   batch or loop number; `test/helpers/collector-stubs.ts` has the fetch stub
   and read-back helpers. Stubbed fetch first, then run the real collector
   once against the **test DB only**
   (`thoth-testdb` container, `postgres://thoth:thoth@127.0.0.1:55432/thoth_test`
   — the collector suites TRUNCATE, never point them at production). Gates:
   `npm run typecheck && npm run lint && npm run test:collectors && npm run test:unit`.
5. **Receipts**: ENDPOINTS.md row, DATA_SOURCES.md rows, PHASES.md ledger row,
   OUTSTANDING.md entry, queue updated here.
6. **Deploy**: `cd backend && docker compose up -d --build worker` (add `api`
   when routes changed, `app` when the UI/catalog changed). Confirm in
   production (read-only): the new sources' `feed_health` rows have `last_ok`
   and no error, and their events landed with geometry.
7. **Commit on `main` and push.** A source that fails in production gets fixed
   or reverted before the push — never push red.


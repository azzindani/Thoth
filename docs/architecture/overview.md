# Architecture overview

Thoth has three processes and one database:

```
                 ┌────────────────────────────────────────────────────────┐
 browser ──────► │ app  (Next.js 16, :3000)                               │
 (or reverse     │  src/proxy.ts   access-token gate, write-key injection │
  proxy)         │  rewrite /api/* ──► api                                │
                 └──────────────────────────┬─────────────────────────────┘
                                            │ internal network
                 ┌──────────────────────────▼─────────────────────────────┐
                 │ api  (Express 5, :4000)                                │
                 │  REST /api/*  ·  SSE /api/stream  ·  /metrics          │
                 └──────────────────────────┬─────────────────────────────┘
                                            │
                 ┌──────────────────────────▼─────────────────────────────┐
                 │ PostgreSQL 16 + TimescaleDB + PostGIS (single DB)      │
                 └──────────────────────────▲─────────────────────────────┘
                                            │
                 ┌──────────────────────────┴─────────────────────────────┐
 300+ public ──► │ worker  (collectors, scheduler, ops, intel)            │
 upstreams       └────────────────────────────────────────────────────────┘
```

PostgreSQL is both the store and the cache. There is no Redis or message
bus. The API and the worker never talk to each other directly: they
coordinate through tables such as `layer_versions`, `feed_health`,
`collector_requests` and `worker_heartbeat`.

## Components

### Worker (`backend/src/workers/`)

The worker is a long-running scheduler that owns everything that touches
upstream services.

- **Registry.** `registry.ts` maps each collector to its module, its poll
  interval and its TTL. One collector can own several *sources* (legs). For
  example, `quakes` pulls from USGS, EMSC, GFZ, INGV and others. The
  registry is the list of what runs. `api/source-map.ts` maps each source
  back to its collector for the monitor.
- **Scheduling.** Collector start times are staggered 2 s apart, and each
  interval gets ±`POLL_JITTER_PCT` of jitter so upstreams are not hit in
  lockstep. Intervals range from 60 s (earthquakes) to daily (sanctions,
  catalogs).
- **Collector run.** Every run follows the same steps:
  1. Fetch. `lib/fetch.ts` sets a User-Agent and a timeout. `lib/net.ts`
     allows 2.5 s per TCP connect attempt.
  2. Validate the payload shape. If the shape has changed, the run throws
     instead of emptying the layer.
  3. Store the raw payload in `raw_events`.
  4. Normalize and upsert into `events`.
  5. Update `feed_health`.
  6. Bump `layer_versions`.
- **Current-picture feeds.** Sources that publish "what is in force now",
  such as warnings, incidents or vessel positions, call `pruneStale()` after
  a successful poll. Items that left the feed then leave the map.
- **Background jobs**, all in the same process:

  | Job | Cadence | Purpose |
  |---|---|---|
  | Heartbeat | 15 s | `worker_heartbeat`. The UI shows WORKER DOWN after 60 s of silence. |
  | Run-now queue | 5 s | Picks up `POST /api/monitor/run/:collector` requests. |
  | Ops alerts | 60 s | Raises and clears `ops` events for failing, frozen or mass-failing feeds. |
  | Intelligence pass | 5 min | Duplicates, incidents, anomalies (see below). |
  | Retention | hourly (first run 2 min after start) | Batched pruning of monitor history, raw payloads and old events. |

- **Shutdown.** On SIGTERM the worker stops scheduling and drains in-flight
  collectors for up to 25 s.

### API (`backend/src/api/`)

The API is a stateless Express 5 service. Middleware runs in this order
(`app.ts`):

1. Request id and JSON access log (`X-Request-Id`; an inbound id is kept
   if it is sane).
2. Security headers.
3. CORS (`CORS_ORIGIN`).
4. Per-client-IP fixed-window rate limit (`REQUESTS_PER_MIN`; SSE and
   probes are exempt; the client IP comes from `TRUST_PROXY`).
5. Write-key gate on POST, PUT, PATCH and DELETE (`API_WRITE_KEY`).
6. JSON body parser (100 kB limit), routes, then JSON 404 and error
   handlers.

The routes are grouped by module:

| Module | Scope |
|---|---|
| `routes-core.ts` | probes, health, stats, versions, route index, layer slices, history, brief, alerts, dossier |
| `routes-intel.ts` | search, watches, sitreps, imagery, notify, portfolios, notes, screens, trends, export, SSE |
| `routes-country.ts` | country pages |
| `routes-osint.ts`, `routes-recon.ts` | on-demand lookups (IP, ASN, CVE, sanctions, certificates, …) |
| `routes-monitor.ts` | monitor views, run-now, Prometheus metrics |

The authoritative route list is served at runtime by `GET /api/routes`.
See also the [API reference](../reference/api.md).

**Streaming.** `GET /api/stream` is a Server-Sent Events hub. One shared
poller reads `layer_versions` every 5 s while clients are connected, and
each client receives only the layers that changed. The event sequence is
`connected` → `snapshot` → `layer_changed` | `heartbeat`. Clients resume
with `?known=` or `Last-Event-ID`.

**Layer slices.** `GET /api/layers/:layer` is viewport-aware. It takes a
bbox and zoom, samples spatially at world zoom so every region is
represented, and reports truncation so the client only re-fetches layers
that were cut off.

### App (`app/`)

The app is a Next.js 16 App Router application, built as a standalone
server.

- **`src/proxy.ts`** is the edge of the system. It enforces the access-token
  gate and attaches `API_WRITE_KEY` to mutating `/api` calls from vetted
  callers. The browser never sees the key.
- **The rewrite** in `next.config.ts` sends `/api/*` to `THOTH_API_INTERNAL`.
  The browser only ever talks to the app's origin.
- **The map** uses a single MapLibre GL engine with globe and flat
  projections. Layers render as Lucide glyph sprites that are baked per
  severity. Hover cards, click-to-pin and pop-out windows are handled in
  `components/map-popups.ts` and `PopWindows.tsx`.
- **The layer catalog** (`lib/layer-catalog.ts`) defines every map layer:
  glyph, cadence and grouping.
- **Layout.** Floating panels (explorer, inspector, dock) sit over a
  full-bleed map, with desk, tablet and phone breakpoints. See the
  [UI design system](../development/ui-design-system.md).
- **Live updates.** One `EventSource` on `/api/stream`. Only the layers
  that changed are re-sliced.

`backend/public/index.html` is the original single-file terminal. It is
deprecated and scheduled for removal (see the [roadmap](../roadmap.md)).

## Data model in brief

```
upstream payload ─► raw_events (fetch log, short retention)
                 └► events     (normalized, one row per real-world item, geometry)
                       ├─ event_dups     duplicate reports across agencies
                       ├─ layer_samples  hourly activity samples for anomaly baselines
                       └─ layer_versions per-layer change counter that drives SSE
feed_health  current state per source (last ok, content age, error)
collector_runs / source_runs / endpoint_calls  operational history
```

Every event carries `source`, `layer`, `url`, `severity`
(`info` | `watch` | `critical`), geometry and provider metadata. Its `id`
has the form `source:external_id`, so repeated polls upsert instead of
duplicating. For the full schema, see [Database](database.md).

## Freshness contract

The system refuses to show a failure as an empty map:

- **Two timestamps per source.** `last_ok` records when the fetch last
  succeeded. `content_ts` records when the newest observation happened.
- **Frozen.** A source that keeps succeeding while its `content_ts` stops
  moving past its budget is marked frozen. Budgets are set per source class
  in `api/freeze.ts`: tight for sensors, wide for digests. Catalogs and
  sparse-by-design feeds are never frozen.
- **Warming.** A source that has never succeeded is warming, not failing,
  so it raises no alarm before its first publish.
- **Stale.** When a fetch fails, the last good data keeps being served,
  flagged `STALE`. It is not wiped.
- **Fallback rungs.** Where upstreams have fallbacks (for example
  adsb.lol → OpenSky, CelesTrak → TLE mirror), the source that actually
  served the data is stamped on each row.

The same rules drive `/api/health`, the Monitor tab, the ops alerts and
`/metrics`, so they all agree.

## Intelligence pass (deterministic, no LLM)

Every 5 minutes (`workers/intel.ts`):

1. **Duplicates.** The same earthquake reported by several agencies (within
   2 min, 100 km and 0.5 magnitude) collapses to one primary report, by
   agency priority. Readers hide the rest.
2. **Incidents.** Critical and watch events from the last 48 h that cluster
   in space (PostGIS DBSCAN, about 110 km) and are corroborated by at least
   two layers or sources become one row on the `incidents` layer, with a
   timeline.
3. **Anomalies.** Hourly activity per layer and 5° cell is compared with
   its 7-day median/MAD baseline. Sudden spikes, or drops such as airspace
   emptying, raise rows on the `anomalies` layer. A drop is ignored when the
   whole feed is down.

The daily brief (`/api/brief`) is a deterministic keyword and severity
classification. It costs nothing to run.

## Trust boundaries

| Boundary | Control |
|---|---|
| Internet → app | `APP_ACCESS_KEY` token gate (or an SSO proxy with `APP_TRUST_UPSTREAM_AUTH=1`) |
| app → api | Private compose network. Writes need `API_WRITE_KEY`, attached server-side. |
| Host → api | Bound to `127.0.0.1` for cron and debugging |
| api/worker → db | Not published outside the compose network |
| worker → internet | Outbound HTTPS only, no inbound listener |

For details, see the [Security policy](../../SECURITY.md).

## Design decisions

- **One database.** Store, cache, queue and time-series live in PostgreSQL.
  That means one thing to back up, one thing to monitor, and SQL for
  history. Redis would only be added for multi-replica SSE fan-out.
- **Poll, not push.** Nearly all upstreams are HTTP polls. Each collector's
  cadence is tuned to how often its upstream publishes and to its rate
  limits.
- **Keyless first.** Core functionality needs no third-party accounts.
  Keyed sources ship disabled and report themselves as disabled in health.
- **Single operator.** No per-user accounts or roles. Access is by bearer
  tokens that can be revoked.

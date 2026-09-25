# Database

Thoth uses a single PostgreSQL 16 database with these extensions:

| Extension | Used for |
|---|---|
| `postgis` | Geometry on events and area watches, spatial indexes, DBSCAN clustering |
| `pg_trgm` | Fuzzy sanctions-name search |
| `timescaledb` | Hypertables and chunk retention where the schema allows it (optional; migrations skip it with a notice if it is missing) |

The production image is `timescale/timescaledb-ha:pg16`, which ships all
three. The only supported way to change the schema is the numbered SQL
files in [`backend/db/migrations/`](../../backend/db/migrations/).

## Migrations

```bash
npm run db:migrate                         # development (tsx)
node dist/scripts/migrate.js               # production image (compose `migrate` service)
```

The runner (`src/scripts/migrate.ts`) works like this:

- It applies files in filename order and records each one in
  `schema_migrations` along with its checksum.
- Each file runs in a transaction. A file whose first line is
  `-- migrate:no-transaction` runs outside one, which is needed for
  statements such as `CREATE INDEX CONCURRENTLY`.
- A session advisory lock stops two runners from applying migrations at the
  same time.
- It is safe to re-run. Files that are already applied are skipped.
- It warns when an applied file has been edited since it ran.

**Never edit an applied migration.** Add a new file with the next number.
Write migrations to be idempotent (`IF NOT EXISTS`, `ON CONFLICT`).

| File | Adds |
|---|---|
| `001_init.sql` | `raw_events`, `events`, `entity_links`, `feed_health`, `layer_versions`, `pins` |
| `002_sanctions.sql` | `sanctions_entities`, `sanctions_meta` |
| `003_contracts.sql` | `feed_health.content_ts`, `feed_health.first_ok_at` |
| `004_watchlists.sql` | `watchlists` |
| `005_sitreps.sql` | `sitreps` |
| `006_terminal.sql` | `portfolios`, `positions`, `notes`, `screens` |
| `007_monitoring.sql` | `collector_runs`, `source_runs`, `endpoint_calls`, `worker_heartbeat`, `collector_schedule`, `collector_requests` |
| `008_intel.sql` | `event_dups`, `layer_samples` |
| `009_area_watch.sql` | `watchlists.geom` and the `area` watch kind |
| `010_map_notes.sql` | `notes.lat`, `notes.lon` |

## Core tables

### `events`: normalized intelligence

This is the table the API, the UI and any analysis query read from.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | Stable `source:external_id`. Re-polls upsert. |
| `ts` | `timestamptz` | Observation or publication time (content time) |
| `ingested_at` | `timestamptz` | Last time a poll saw this row (refreshed on upsert) |
| `source` | `text` | Upstream source id, e.g. `usgs`, `emsc`, `cert-fr`, `static` |
| `layer` | `text` | Map layer, e.g. `quakes`, `fires`, `cyber`, `ops` |
| `title`, `body`, `url` | `text` | Human-readable content and a link to the original |
| `severity` | `text` | `info` \| `watch` \| `critical` |
| `confidence` | `real` | 0–1 |
| `geom` | `geometry(Geometry, 4326)` | Point, line or polygon; null for non-geographic items |
| `entities` | `jsonb` | Referenced entities (flights, vessels, wallets, tickers, …) |
| `meta` | `jsonb` | Provider fields, fallback rung, derived values |
| `search` | `tsvector` (generated) | Full-text index over title and body |

Indexes: `(layer, ts DESC)`, GiST on `geom`, GIN on `search` and
`entities`.

### `raw_events`: fetch log

One row per upstream payload: `fetched_at`, `source`, `layer`,
`http_status`, `payload jsonb` and a generated `payload_hash`. It exists
for provenance and debugging, and it is kept for a short time
(`RAW_RETENTION_DAYS`).

### `feed_health`: current state per source

| Column | Meaning |
|---|---|
| `last_ok`, `last_attempt` | Last successful fetch, last fetch attempt |
| `content_ts` | Newest observation time seen from this source. Drives the *frozen* state. |
| `first_ok_at` | First success ever. Before it, the source is *warming*, not failing. |
| `lag_sec`, `hit_rate`, `error` | Derived lag, success ratio, last error message |

### `layer_versions`

`(layer, version)` is bumped once per collector batch that writes to the
layer. SSE clients and `GET /api/versions` compare these counters to decide
what to re-fetch.

## Supporting tables

| Table | Purpose |
|---|---|
| `sanctions_entities`, `sanctions_meta` | OFAC SDN (OpenSanctions mirror) and UN Security Council lists, trigram-searchable |
| `watchlists` | Keyword, layer, severity and area watches (`geom` for areas) |
| `sitreps` | Daily archived situation reports, the history behind trend analytics |
| `portfolios`, `positions`, `notes`, `screens` | Analyst workspace objects (single operator) |
| `event_dups` | Events judged duplicates of a primary report (readers hide them) |
| `layer_samples` | Hourly per-layer, per-5°-cell activity counts used for anomaly baselines |
| `collector_runs`, `source_runs`, `endpoint_calls` | Monitor history: runs, per-source outcomes, every upstream HTTP call |
| `worker_heartbeat`, `collector_schedule`, `collector_requests` | Worker liveness, next-due times, run-now queue |
| `entity_links`, `pins` | Reserved for the entity graph and agent pins (see [proposals](../proposals/ai-agents.md)) |
| `schema_migrations` | Migration ledger |

## Retention

The worker's retention job is the authoritative pruning mechanism. It runs
2 minutes after start and then hourly. It deletes in batches of 5,000 rows,
up to 200,000 rows per table per run.

| Data | Setting | Default | Rule |
|---|---|---|---|
| Monitor history (`source_runs`, `endpoint_calls`, `collector_runs`, `collector_requests`, `layer_samples`) | `MONITOR_RETENTION_DAYS` | 14 | Older than the window |
| `raw_events` | `RAW_RETENTION_DAYS` | 14 | Older than the window; `0` disables pruning |
| `events` | `EVENTS_RETENTION_DAYS` | 180 | `ts` **and** `ingested_at` both older than the window. Static catalogs (`source = 'static'`) and `ops` alerts are never pruned. `0` disables pruning. |
| `worker_heartbeat` | — | 1 day | Stale heartbeat rows |

Where TimescaleDB could register them, `001_init.sql` also adds chunk
retention policies of 90 days on `raw_events` and 365 days on `events`.
These act as an outer bound on the settings above.

Current-picture feeds, such as warnings in force or vessel positions,
delete their own rows once an item leaves the upstream feed, independent of
retention.

## Access patterns

- All SQL lives in `backend/src/db/queries.ts` and the collector store
  helpers (`src/workers/lib/store.ts`). All queries are parameterized.
- The pool (`src/db/client.ts`) is limited by `PG_POOL_MAX` per process.
  Each statement is capped by `PG_STATEMENT_TIMEOUT_MS`; migrations are
  exempt.
- External clients and agents use the HTTP API, never SQL.

## Sizing

Database size is shown in the Monitor tab and exported as
`thoth_db_size_bytes`. With the default retention, most of the size comes
from `events` (live layers plus static catalogs) and the 14-day
`raw_events` and `endpoint_calls` logs. Tune the `*_RETENTION_DAYS`
variables before you add disk.

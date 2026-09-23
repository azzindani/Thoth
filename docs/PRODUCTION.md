# THOTH — production guide

The single reference for running Thoth somewhere other people can reach it:
security model, configuration, deploy checklist, operations, upgrade notes.
`HOSTING.md` is the step-by-step host handover; `BACKUP.md` the backup runbook.

## 1. Topology and trust boundaries

```
 user ──► tunnel / reverse proxy ──► app :3000 (Next.js)
                                        │  src/proxy.ts: APP_BASIC_AUTH gate,
                                        │  injects API_WRITE_KEY on writes
                                        ▼  rewrite /api/* → http://api:4000 (compose network)
                                      api :4000 (Express) ──► db (Timescale + PostGIS)
                                                                   ▲
                                      worker (collectors) ─────────┘
```

- **Only the app faces users.** Compose binds the API to `127.0.0.1` (host
  cron + debugging) and the DB to nothing. The browser talks same-origin to
  the app; the app proxies `/api/*` over the internal network.
- **Reads are public to whoever can reach the app.** Put `APP_BASIC_AUTH`
  (or an SSO proxy such as Cloudflare Access) in front if the data must not be.
- **Writes need the key.** Every POST/PUT/PATCH/DELETE on `/api` requires
  `API_WRITE_KEY` (`Authorization: Bearer <key>` or `X-Thoth-Key`). With
  `NODE_ENV=production` and no key configured, the API refuses all writes
  (fail closed). The app attaches the key server-side — it never reaches the
  browser — and only for callers it has vetted: passed `APP_BASIC_AUTH`, or
  `APP_TRUST_UPSTREAM_AUTH=1` when an auth proxy in front vouches for them.
  Anonymous visitors' writes arrive keyless and get `401`.

## 2. Configuration reference

Backend (`backend/src/config.ts`, validated with zod at boot — bad values exit):

| Var | Default | Notes |
|---|---|---|
| `NODE_ENV` | development | `production` in every deployed process |
| `DATABASE_URL` | dev URL | **required** in production (no silent fallback) |
| `API_WRITE_KEY` | — | **required** in compose; `openssl rand -hex 32` |
| `PORT` | 4000 | |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Express `trust proxy`; decides `req.ip` for rate limiting + logs. Widen only for known proxy hops |
| `REQUESTS_PER_MIN` | 120 (compose: 300) | per client IP, fixed window; SSE and probes exempt |
| `CORS_ORIGIN` | `*` | `*` or comma list of origins; only matters for cross-origin API use |
| `PG_POOL_MAX` | 10 | per process |
| `PG_STATEMENT_TIMEOUT_MS` | 60000 | per statement; migrations opt out |
| `SSE_MAX_CLIENTS` | 500 | `/api/stream` answers 503 + Retry-After beyond it |
| `LOG_LEVEL` | info | `debug` adds a line per successful request |
| `POLL_JITTER_PCT` | 10 | worker schedule jitter |
| `OTX_API_KEY`, `FINNHUB_KEY`, `TELEGRAM_*` | — | optional depth; disabled-honest when unset. A Telegram bot token also receives feed alerts |
| `MONITOR_RETENTION_DAYS` | 14 | run log, source outcomes, upstream call log |
| `RAW_RETENTION_DAYS` | 14 | `raw_events` fetch log |
| `EVENTS_RETENTION_DAYS` | 180 | events neither observed nor re-seen in this window are pruned (statics and `ops` alerts never); `0` keeps everything |
| `ALERT_FAIL_STREAK` | 3 | consecutive failed runs before a feed raises an `ops` alert (×3 → critical) |

App (`app/src/proxy.ts`, `app/next.config.ts`):

| Var | When | Notes |
|---|---|---|
| `APP_BASIC_AUTH` | runtime | `user:pass`; gates pages + `/api`; `/healthz` stays open |
| `APP_TRUST_UPSTREAM_AUTH` | runtime | `1` = an auth proxy in front vets users; key injected for all |
| `API_WRITE_KEY` | runtime | same value as the API's |
| `THOTH_API_INTERNAL` | **build** | rewrite target baked into the build (`http://api:4000` in compose) |
| `NEXT_PUBLIC_THOTH_API` | **build** | leave empty (same-origin) unless the browser must call the API directly |

## 3. Deploy checklist

```sh
cd backend
export POSTGRES_PASSWORD=$(openssl rand -hex 32)
export API_WRITE_KEY=$(openssl rand -hex 32)
export APP_BASIC_AUTH="ops:$(openssl rand -hex 12)"   # or APP_TRUST_UPSTREAM_AUTH=1 behind SSO
docker compose up -d --build        # db → migrate → seed → api + worker → app
curl -sf localhost:4000/api/readyz  # {"ok":true,...}
curl -sf localhost:3000/healthz     # {"ok":true}
```

Keep the three secrets in the host's secret store, not in shell history.
`docker compose config -q` fails fast if any required variable is missing.

## 4. Operations

- **Probes:** `/api/livez` (process up, no DB — use for liveness),
  `/api/readyz` (`SELECT 1` — readiness, container healthcheck),
  `/api/health` (verbose per-feed freshness for humans/dashboards), app `/healthz`.
- **Logs:** one JSON line per event on stdout. Every response carries
  `X-Request-Id` (an inbound one is kept if sane); 4xx/5xx access lines and
  error lines include `req_id`, so a user-reported id finds the stack.
  Compose rotates at 10 MB × 5 per service.
- **Shutdown:** API ends open SSE streams and drains in <1s; worker stops
  scheduling and drains in-flight collectors for up to 25s (compose grace 30s).
- **Migrations:** `npm run db:migrate` (compose `migrate` service) records
  applied files in `schema_migrations`, runs each in a transaction under an
  advisory lock, and warns if an applied file was edited. Never edit an
  applied migration — add a new numbered file. First line
  `-- migrate:no-transaction` opts a file out of the transaction.
- **One-off collector runs:** `node dist/workers/run.js --once <name>`, or
  `--all-once [width]` for a full pass (backfill after downtime).
- **Monitoring (Monitor tab, `/api/monitor/*`):** the worker records every
  collector run (`collector_runs`), every source outcome (`source_runs`)
  and every upstream HTTP call (`endpoint_calls`: host, path without query
  string, status, latency, bytes — secrets in paths are masked). It beats a
  heartbeat every 15 s; the UI shows **WORKER DOWN** after 60 s of silence.
  `POST /api/monitor/run/<collector>` (write key; the app injects it) queues
  a run the worker picks up within ~5 s.
- **Alerts:** every 60 s the worker raises/clears `ops` events (layer `ops`,
  source `thoth-monitor`): `ops:failing:<source>` after `ALERT_FAIL_STREAK`
  failed runs, `ops:frozen:<source>` when a succeeding feed's data stops
  advancing, and one `ops:mass` critical when ≥ 25 % of feeds (min 10) fail
  at once — during a mass failure the per-feed pushes are suppressed, so an
  outbound network outage sends one Telegram message, not hundreds.
- **Metrics:** `GET /metrics` (and `/api/metrics`), Prometheus text format:
  `thoth_worker_up`, `thoth_db_size_bytes`, `thoth_ops_alerts`, per-source
  `thoth_source_up` / `_fail_streak` / `_success_ratio_24h` /
  `_last_success_timestamp_seconds`, per-collector p95 and next-due, per-host
  call/error counts and p95 latency. Expose it only to your scraper.
- **Retention:** pruning runs 2 min after worker start, then hourly, in
  batches of 5 000 rows (see the `*_RETENTION_DAYS` vars).
- **Demo / CI data:** `npm run db:seed:fixtures` (refuses in production;
  `-- --clean` removes every `fixture:` row).

## 5. Upgrade notes (2026-09-23 hardening)

1. **Database volume path changed — dump before upgrading.** The old compose
   mounted the volume at `/var/lib/postgresql/data`, but `timescaledb-ha`
   keeps PGDATA in `/home/postgres/pgdata/data`, so data lived in the
   container layer. On an existing host:
   ```sh
   docker compose exec db pg_dump -U thoth -Fc thoth > thoth-pre-upgrade.dump
   git pull && docker compose up -d --build db migrate
   docker compose exec -T db pg_restore -U thoth -d thoth --clean --if-exists < thoth-pre-upgrade.dump
   docker compose up -d --build
   ```
2. **`API_WRITE_KEY` is now required** by compose, and host cron writes must
   send it (see `BACKUP.md`).
3. **The browser no longer calls `:4000` directly** — the app proxies. The
   `THOTH_API_PUBLIC` knob is gone; set `APP_BIND=0.0.0.0` only if the app
   (not a tunnel) should listen publicly.
4. **Rate limits are per real client now** (they were shared by every user
   behind the app proxy). `REQUESTS_PER_MIN=2000` is no longer needed in
   production; keep it only for test runs that hammer the API from one IP.

## 6. Known gaps (tracked in OUTSTANDING.md D)

- No Content-Security-Policy on the app yet (tiles, fonts and video embeds
  come from several third-party origins; allowlist needs an audit).
- Rate-limit and SSE state are per process: fine for the single-API compose
  shape, needs a shared store before running several API replicas.
- Single shared write key, no per-user identity or audit trail.

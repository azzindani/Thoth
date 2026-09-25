# Monitoring and day-to-day operations

## Health probes

| Endpoint | Checks | Use for |
|---|---|---|
| `GET /api/livez` | The API process answers. No database call. | Liveness. A database outage must not cause restart loops. |
| `GET /api/readyz` | `SELECT 1` against the database | Readiness and the container healthcheck |
| `GET /api/health` | Per-source freshness, lag, error, collector and interval | Dashboards and humans (verbose) |
| `GET /healthz` (app) | The Next.js server answers. Bypasses the access gate. | App liveness |

The worker has no HTTP port. Its liveness signal is the `worker_heartbeat`
row, written every 15 s. The Monitor tab and `thoth_worker_up` report the
worker as **down** after 60 s without a heartbeat.

## Monitor tab and `/api/monitor/*`

The worker records:

- **every collector run** in `collector_runs`: duration, outcome, rows
  stored and error;
- **every source outcome** in `source_runs`;
- **every upstream HTTP call** in `endpoint_calls`: host, path without the
  query string, status, latency and bytes. Secrets in paths are masked.

The Monitor tab in the UI shows this data. It is also available as JSON:

| Endpoint | Returns |
|---|---|
| `GET /api/monitor/summary` | Totals, failing, frozen and warming counts, worker state, database size |
| `GET /api/monitor/sources` | One row per source: state, success rate over 24 h and 7 d, fail streak, p50 and p95 latency |
| `GET /api/monitor/sources/:source` | Recent runs and calls for one source |
| `GET /api/monitor/collectors` | Schedule: interval, last run, next due, overdue |
| `GET /api/monitor/endpoints` | Per-host upstream call statistics |
| `GET /api/monitor/catalog` | Upstream hosts, collector, layer, cadence and whether a key is needed |
| `POST /api/monitor/run/:collector` | Queue an immediate run (write key required). The worker picks it up within about 5 s. |

### Source states

| State | Meaning |
|---|---|
| `ok` | Has succeeded and the content is within its freshness budget |
| `failing` | `ALERT_FAIL_STREAK` or more consecutive failed runs. The last good data is still served, flagged `STALE`. |
| `frozen` | Fetches succeed, but the newest observation has stopped advancing past its budget |
| `stale` | Recent errors below the fail streak, or no successful data at the moment |
| `warming` | Never succeeded and no error yet (new source, or first boot) |

Keyed sources without a key report a `disabled: …` error instead of
fetching.

## Alerts

Every 60 s the worker raises and clears `ops` events (layer `ops`, source
`thoth-monitor`). They show as toasts and in the Alerts tab, and they are
pushed to Telegram when it is configured.

| Alert | Raised when | Cleared when |
|---|---|---|
| `ops:failing:<source>` | `ALERT_FAIL_STREAK` consecutive failed runs (critical at three times that) | Next successful run |
| `ops:frozen:<source>` | A succeeding source's content stops advancing | Content advances |
| `ops:mass` (critical) | 25 % or more of sources failing at once (minimum 10) | Failure ratio drops |

During a mass failure, per-source pushes are suppressed, so an outbound
network outage sends **one** message, not hundreds.

For Telegram delivery, the **worker** needs `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID`. See
[Configuration › How variables reach the containers](configuration.md#how-variables-reach-the-containers).
Test delivery with `notify hello` in the command bar, which goes through
the API.

## Prometheus metrics

`GET /metrics` (also `/api/metrics`) serves the Prometheus text format.
Expose it only to your scraper. With compose, scrape
`http://127.0.0.1:4000/metrics` from the host. Through the app, only
`/api/metrics` is proxied, and it sits behind the access gate.

| Metric family | Labels | Meaning |
|---|---|---|
| `thoth_worker_up` | — | 1 if the heartbeat is fresh |
| `thoth_db_size_bytes` | — | Database size |
| `thoth_ops_alerts` | — | Open ops alerts |
| `thoth_source_up` | `source` | 1 when the source state is `ok` |
| `thoth_source_fail_streak` | `source` | Consecutive failures |
| `thoth_source_success_ratio_*` | `source` | Success ratio over the window |
| `thoth_source_last_success_timestamp_seconds` | `source` | Unix time of the last success |
| `thoth_source_content_timestamp_seconds` | `source` | Unix time of the newest observation |
| `thoth_collector_run_p*`, `thoth_collector_next_due_timestamp_seconds` | `collector` | Run-duration percentiles, next scheduled run |
| `thoth_endpoint_calls_*`, `thoth_endpoint_errors_*`, `thoth_endpoint_latency_p*` | `host` | Upstream call volume, errors and latency |

Run `curl -s localhost:4000/metrics | grep '^# HELP'` for the exact names.

Example alerting rules:

```yaml
- alert: ThothWorkerDown
  expr: thoth_worker_up == 0
  for: 2m
- alert: ThothManyFeedsFailing
  expr: avg(thoth_source_up) < 0.75
  for: 15m
```

## Logs

- Every process writes JSON lines to stdout. Compose rotates them at
  10 MB × 5 files per service.
- Every API response carries an `X-Request-Id` header. Access lines for 4xx
  and 5xx responses, and error lines, include `req_id`, so an id reported by
  a user leads straight to the stack trace.
- `LOG_LEVEL=debug` also logs every successful request.

```bash
docker compose logs -f --since 10m api worker
docker compose logs api | grep '"req_id":"<id>"'
```

## One-off collector runs

```bash
# one collector, then exit
docker compose exec worker node dist/workers/run.js --once quakes
# every collector, N at a time (backfill after downtime)
docker compose exec worker node dist/workers/run.js --all-once 6
```

In development, use `npx tsx src/workers/run.ts --once <name>` or
`npm run worker:warmup`. From the UI, use **Run now** in the Monitor tab.

## Background jobs

| Job | Cadence | Notes |
|---|---|---|
| Intelligence pass | 5 min | Duplicates, incidents, anomalies. Anomaly baselines need about a day of samples before anything is flagged. |
| Retention | 2 min after start, then hourly | Batches of 5,000 rows. See [Database › Retention](../architecture/database.md#retention). |
| Daily sitrep archive | Host cron, 00:05 UTC | See [Backup & restore](backup-and-restore.md#scheduled-jobs). |
| Database dump | Host cron, 03:00 UTC | Same. |

## Graceful shutdown

- **API:** closes open SSE streams and drains in under 1 s.
- **Worker:** stops scheduling and drains in-flight collectors for up to
  25 s. Compose allows 30 s.

## Demo and CI data

```bash
npm run db:seed:fixtures              # deterministic demo events (refuses in production)
npm run db:seed:fixtures -- --clean   # remove every fixture: row
```

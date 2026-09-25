# Configuration

All configuration comes from environment variables.

- **Backend (API and worker).** Variables are validated with zod at startup
  (`backend/src/config.ts`). An invalid value makes the process exit with a
  `fatal` log line instead of starting half-configured.
- **App.** Variables are read by `app/src/proxy.ts`, `app/src/lib/auth.ts`
  and `app/next.config.ts`.

A commented template lives in
[`backend/.env.example`](../../backend/.env.example).

## How variables reach the containers

Compose substitutes variables from your shell or `backend/.env`, but it
only **passes a fixed set to each service**, as listed in
[`docker-compose.yml`](../../backend/docker-compose.yml):

| Service | Receives |
|---|---|
| `api` | `DATABASE_URL`, `API_WRITE_KEY`, `CORS_ORIGIN`, `TRUST_PROXY`, `REQUESTS_PER_MIN`, `LOG_LEVEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| `worker` | `DATABASE_URL`, `POLL_JITTER_PCT`, `TELEGRAM_CHANNELS`, `OTX_API_KEY`, `FINNHUB_KEY`, `LOG_LEVEL` |
| `app` | `API_WRITE_KEY`, `APP_ACCESS_KEY`, `APP_TOKENS`, `APP_JWT_SECRET`, `APP_SESSION_TTL_MS`, `APP_TRUST_UPSTREAM_AUTH` |

To set anything else in a container (for example the `*_RETENTION_DAYS`
variables on the worker, or `PG_POOL_MAX`), add it to that service with a
`docker-compose.override.yml`:

```yaml
# backend/docker-compose.override.yml
services:
  worker:
    environment:
      EVENTS_RETENTION_DAYS: "365"
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}   # needed for ops-alert pushes
      TELEGRAM_CHAT_ID: ${TELEGRAM_CHAT_ID:-}
```

> **Telegram alerts:** ops-alert pushes are sent by the **worker**, but the
> default compose file only passes the Telegram bot variables to the `api`
> (which uses them for `POST /api/notify`). Add them to the worker as shown
> above if you want alert delivery.

## Backend: API and worker

### Core

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Set to `production` in every deployed process. This makes `DATABASE_URL` required and makes writes fail closed when `API_WRITE_KEY` is unset. |
| `DATABASE_URL` | `postgres://thoth:thoth@localhost:5432/thoth` | PostgreSQL connection string. **Required** when `NODE_ENV=production`. There is no silent fallback. |
| `PORT` | `4000` | API listen port. |
| `LOG_LEVEL` | `info` | `debug` adds a log line for every successful request. |

### Security and HTTP

| Variable | Default | Description |
|---|---|---|
| `API_WRITE_KEY` | *(empty)* | Shared secret for POST, PUT, PATCH and DELETE on `/api`, sent as `Authorization: Bearer <key>` or `X-Thoth-Key`. When empty, writes are open in development and **refused** in production. Compose requires it. Generate with `openssl rand -hex 32`. |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Express `trust proxy` setting. It decides `req.ip`, which is used for rate limits and logs. Widen it only for proxy hops you know. |
| `REQUESTS_PER_MIN` | `120` (compose: `300`) | Fixed-window rate limit per client IP. SSE and probes are exempt. Raise it only for load tests from a single IP. |
| `CORS_ORIGIN` | `*` | `*` or a comma-separated list of origins. Only matters when browsers call the API cross-origin. |
| `SSE_MAX_CLIENTS` | `500` | Concurrent `/api/stream` clients. Beyond this, the API answers `503` with `Retry-After`. |

### Database

| Variable | Default | Description |
|---|---|---|
| `PG_POOL_MAX` | `10` | Connection pool size per process. |
| `PG_STATEMENT_TIMEOUT_MS` | `60000` | Per-statement timeout. Migrations are exempt. `0` disables it. |

### Worker

| Variable | Default | Description |
|---|---|---|
| `POLL_JITTER_PCT` | `10` | ± jitter applied to every collector interval (0–50). |
| `ALERT_FAIL_STREAK` | `3` | Consecutive failed runs before a source raises an `ops` alert. Three times this count makes the alert critical. |
| `TELEGRAM_CHANNELS` | `osintdefender,war_monitor,clashreport` (compose: `osintdefender,war_monitor,aljazeeraenglish`) | Public Telegram channels to scrape from `t.me/s/`, up to 5. |

### Retention

| Variable | Default | Description |
|---|---|---|
| `MONITOR_RETENTION_DAYS` | `14` | Run log, per-source outcomes, upstream call log, anomaly samples. |
| `RAW_RETENTION_DAYS` | `14` | `raw_events` fetch log. `0` keeps everything. |
| `EVENTS_RETENTION_DAYS` | `180` | Events neither observed nor re-seen within the window are pruned. Static catalogs and `ops` alerts are never pruned. `0` keeps everything. |

For how these interact with TimescaleDB policies, see
[Database › Retention](../architecture/database.md#retention).

### Optional keys

Every keyed integration is off by default. With no key it reports itself as
*disabled* in health, never as failing, and it never fakes data.

| Variable | Enables | How to get it |
|---|---|---|
| `OTX_API_KEY` | AlienVault OTX pulse intel on the `cyber` layer | Free signup at otx.alienvault.com |
| `FINNHUB_KEY` | Earnings calendar on the `markets` layer | Free signup at finnhub.io |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Push delivery for ops alerts (worker) and `POST /api/notify` (API) | Create a bot with @BotFather, message it once, then read the chat id from `https://api.telegram.org/bot<token>/getUpdates` |

### Compose-only

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | `thoth` / `thoth` | Database role and name. |
| `POSTGRES_PASSWORD` | *(required)* | Database password. |
| `API_PORT` | `4000` | Host port for the API, always bound to `127.0.0.1`. |
| `APP_PORT` | `3000` | Host port for the app. |
| `APP_BIND` | `127.0.0.1` | Host interface for the app. Use `0.0.0.0` only if the app itself, rather than a proxy or tunnel, must listen publicly. |

## App (web terminal)

| Variable | When read | Description |
|---|---|---|
| `APP_ACCESS_KEY` | runtime | Operator access key. Gates every page and `/api` call. `/healthz` and static assets stay open. |
| `APP_TOKENS` | runtime | Extra named keys, `name:key,name2:key2`. To revoke one, remove it. |
| `APP_TOKENS_FILE` | runtime | Extra keys as JSON `{"name": "key"}`. Re-read on every check, so you can add or revoke keys without a restart. Needs a volume mount in compose. |
| `APP_JWT_SECRET` | runtime | Session-cookie signing secret. Defaults to `APP_ACCESS_KEY`. Rotating it signs every browser out. |
| `APP_SESSION_TTL_MS` | runtime | Session cookie lifetime. Default 30 days. |
| `APP_TRUST_UPSTREAM_AUTH` | runtime | `1` means an authenticating proxy in front has already vetted every request, so the write key is attached for all callers. |
| `API_WRITE_KEY` | runtime | Must match the API's value. Attached server-side to writes from vetted callers only. |
| `THOTH_API_INTERNAL` | **build** | Rewrite target for `/api/*`. Compose sets `http://api:4000`. The default is `http://localhost:4000`. |
| `NEXT_PUBLIC_THOTH_API` | **build** | Leave empty (same-origin). Set it only if browsers must call the API directly. |

Build-time variables are baked into the image. Changing them requires
`docker compose build app`.

## Development and test only

| Variable | Used by | Description |
|---|---|---|
| `TEST_DATABASE_URL` | `npm run test:collectors`, `test:coverage` | Target for the collector suites, which **TRUNCATE tables**. Defaults to `…/thoth_test`. Never point it at a real database. |
| `API_URL` | `npm test` | API under test for the route and alive suites. |
| `THOTH_DELAY_SCALE` | collector tests | `0` removes backoff sleeps. |
| `E2E_STUB_BASEMAP` | app e2e | `1` swaps the CARTO basemap for a blank local style. |

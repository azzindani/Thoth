# THOTH — permanent-host handover runbook

Everything a human needs to take Thoth from this sandbox to a real host.
The tunnel (`trycloudflare`) is temporary by nature; this is the exit.
Security model, full env reference and upgrade notes: `PRODUCTION.md`.

## 1. First boot (empty host)

```sh
git clone <repo> thoth && cd thoth/backend
export POSTGRES_PASSWORD=$(openssl rand -hex 32)   # required
export API_WRITE_KEY=$(openssl rand -hex 32)       # required (writes fail closed without it)
export APP_BASIC_AUTH="ops:<strong>"               # strongly recommended behind a public tunnel
docker compose up -d --build         # db → migrate → seed → api + worker + app
sleep 60 && curl -s localhost:4000/api/stats | head -c 200
```

Expected: `{"serverTs":...}` with ~28 layers. Full freshness within ~6h
(collectors refill on cadence); statics + theaters seed instantly.

## 2. Environment (only knobs that matter)

| Var | Default | Set to |
|---|---|---|
| `POSTGRES_PASSWORD` | (required) | strong secret |
| `API_WRITE_KEY` | (required) | strong secret; the app injects it server-side for vetted users |
| `APP_BASIC_AUTH` | unset (open) | `user:pass` — gate for the whole terminal; or `APP_TRUST_UPSTREAM_AUTH=1` behind SSO |
| `REQUESTS_PER_MIN` | 300 (compose) | per real client IP now; raise only for load tests from one IP |
| `OTX_API_KEY` | unset (honest-disabled) | free-signup key enables pulse intel |
| `TELEGRAM_CHANNELS` | osintdefender,war_monitor,aljazeeraenglish | adjust anytime, worker picks up on restart |
| AIS/ACLED/Finnhub | not wired | keys alone don't ship these — collectors don't exist yet (OUTSTANDING.md A) |
| `APP_BIND` / `APP_PORT` | 127.0.0.1 / 3000 | `0.0.0.0` only if the app itself (not a tunnel) listens publicly |

Full reference (TRUST_PROXY, CORS_ORIGIN, pool/timeout knobs): `PRODUCTION.md` §2.

## 3. Cron (host owns scheduling, not the worker)

Install `/etc/cron.d/thoth` per `docs/BACKUP.md`: 00:05 UTC sitrep
snapshot (market-HUD history clock), 03:00 UTC pg_dump kept 7 days.
Restore-drill the dump quarterly — an untested backup is a rumor.

## 4. Verify on the host (first green build happens here — sandbox denies mounts)

```sh
cd backend && npm run typecheck && npm run lint && npm test && npm run test:collectors
cd ../app && npm run typecheck && npm run lint && npx vitest run && npx playwright test --workers=1
```

Then: `docker compose up --build` from scratch on the host, confirm
`/api/stats` ~28 layers and the app boots with zero page errors.

## 5. Restarts go through the scripts (fixed 2026-09-13)

`npm run build` replaces `.next` while `next start` still serves the old
build's manifest → every JS chunk 500s → UI frozen at SSR text
("booting…", "click a dot") with zero errors in backend logs. Manual
restarts also failed three ways in one day (npm arg parsing, pkill matching
its own shell, launches dying with the shell). So:

- app: `app/restart.sh` — builds, safe-stops (bracket patterns), starts
  detached, then curls `/` **and a real chunk URL**; exits non-zero otherwise.
- backend: `backend/restart.sh` — restarts api (with `REQUESTS_PER_MIN=2000`, for the dev box running the live suites)
  + worker detached, then curls `/api/stats`.

Diagnose a frozen UI via browser console (`_next/static/chunks/*.js → 500`).

## 5. Cutover + calendar

- Point DNS at the host, keep the tunnel until the host is verified, then kill it.
- `backend/public/index.html` terminal: bannered, **delete after 2026-10-09**.
- Rollback: previous day's dump (`pg_restore`) or fast path
  (migrate + `seed-statics.js` + 6h collector refill).

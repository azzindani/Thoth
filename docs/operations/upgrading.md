# Upgrading

## Standard procedure

```bash
cd backend
docker compose exec -T db pg_dump -U thoth -Fc thoth > thoth-pre-upgrade.dump   # always
git fetch --tags && git checkout <release-tag-or-commit>   # e.g. v0.1.0
docker compose up -d --build          # runs migrate + seed, then restarts services
curl -sf localhost:4000/api/readyz && curl -sf localhost:3000/healthz
```

- Migrations run automatically through the one-shot `migrate` service. They
  only move forward.
- Read the notes below for every release you are crossing. The
  [Changelog](../../CHANGELOG.md) lists all changes. This page lists only
  those that need manual action.

## Version-specific notes

Releases are tagged `vX.Y.Z` from `main`. The dated notes below come from
before the first release and are all included in v0.1.0.

### v0.2.0

No manual steps are required. The migration (`011_webhooks.sql`) runs
automatically, and every new variable is optional.

- **The app now sends a Content-Security-Policy.** If you serve Thoth with
  extra scripts, frames or a different map or tile host, the browser will
  block them; the console names the directive. Diagnose with
  `APP_CSP=report` (or `off`) on the app, then report the missing origin.
  If browsers call the API directly (`NEXT_PUBLIC_THOTH_API`), that origin
  is allowed automatically.
- **Pages render per request** (the CSP nonce needs it). Expect slightly
  more CPU on the app per page load, none per API call.
- **New, optional:** `API_READ_KEYS`, `API_READ_KEYS_FILE` and
  `API_READ_REQUIRED` on the API; `API_READ_KEY` and `APP_CSP` on the app;
  `WEBHOOK_URLS` and `WEBHOOK_SECRET` on the worker. Compose passes them
  all. See [Configuration](configuration.md).
- If you turn on `API_READ_REQUIRED`, give the app a reader key through
  `API_READ_KEY` in the same change, or the app loses its data.
- The install files (`/manifest.webmanifest`, `/sw.js`, `/icons/*`) are
  served without the access token, like `/healthz`. They contain no data.

### v0.1.0

No manual steps: there are no new migrations or required variables.

- Native (non-compose) runs now default `REQUESTS_PER_MIN` to `300`, the
  value compose already used. If you set a lower limit yourself, keep it
  well above about 45 requests per page load, or layers load on retry.
- Display settings are new and kept per browser, so nothing needs to be
  migrated.
- Compose now passes `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to the
  worker. If you added them in a `docker-compose.override.yml`, that
  override can go.

### 2026-09-24: access-token gate and compose project name

1. **`APP_BASIC_AUTH` has been removed.** The app now uses a token gate
   (see [Security](../../SECURITY.md)). Set `APP_ACCESS_KEY` and sign in
   once with `?token=`. Scripts send `Authorization: Bearer <key>`. A
   leftover `APP_BASIC_AUTH` is ignored, which leaves the app **open**, so
   set the new key before you upgrade.
2. **The compose project is now `thoth`.** It used to be `backend`, taken
   from the directory name. Containers are now named `thoth-<service>-1`
   and the database volume is `thoth_thoth_pg`, so the new stack starts
   with an empty database. Migrate the data:

   ```bash
   docker compose -p backend exec -T db pg_dump -U thoth -Fc thoth > thoth-pre-upgrade.dump
   docker compose -p backend down
   git pull && docker compose up -d --build db migrate
   docker compose exec -T db pg_restore -U thoth -d thoth --clean --if-exists < thoth-pre-upgrade.dump
   docker compose up -d --build
   ```

### 2026-09-23: production hardening

1. **The database volume path changed, so dump before upgrading.** The old
   compose file mounted the volume at `/var/lib/postgresql/data`, but
   `timescaledb-ha` keeps PGDATA in `/home/postgres/pgdata/data`, so data
   lived in the container layer. To upgrade:

   ```bash
   docker compose exec -T db pg_dump -U thoth -Fc thoth > thoth-pre-upgrade.dump
   git pull && docker compose up -d --build db migrate
   docker compose exec -T db pg_restore -U thoth -d thoth --clean --if-exists < thoth-pre-upgrade.dump
   docker compose up -d --build
   ```

2. **`API_WRITE_KEY` is now required** by compose. Host cron jobs that
   write, such as the daily sitrep, must send it (see
   [Backup & restore](backup-and-restore.md#scheduled-jobs)).
3. **The browser no longer calls `:4000` directly.** The app proxies
   `/api`. `THOTH_API_PUBLIC` has been removed. Set `APP_BIND=0.0.0.0` only
   if the app, and not a proxy or tunnel, should listen publicly.
4. **Rate limits now apply per real client**, where before every user
   behind the app proxy shared one bucket. `REQUESTS_PER_MIN=2000` is no
   longer needed in production. Keep it only for test runs that hit the
   API hard from one IP.

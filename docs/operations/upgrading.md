# Upgrading

## Standard procedure

```bash
cd backend
docker compose exec -T db pg_dump -U thoth -Fc thoth > thoth-pre-upgrade.dump   # always
git fetch && git checkout <release-or-commit>
docker compose up -d --build          # runs migrate + seed, then restarts services
curl -sf localhost:4000/api/readyz && curl -sf localhost:3000/healthz
```

- Migrations run automatically through the one-shot `migrate` service. They
  only move forward.
- Read the notes below for every release you are crossing. The
  [Changelog](../../CHANGELOG.md) lists all changes. This page lists only
  those that need manual action.

## Version-specific notes

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

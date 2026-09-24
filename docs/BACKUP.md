# THOTH — backup & restore runbook

RPO 24h (daily cron), RTO ~15 min. Two tiers: full dump for disaster recovery,
seed replay for fast rebuild (statics + MITRE map are vendored and re-seedable).

## Daily ops cron (host)

Scheduling belongs to host cron, not the worker — one file, two jobs:

```sh
# /etc/cron.d/thoth
# 00:05 UTC — archive today's sitrep (feeds /api/analytics/trend history)
# (writes need the key; keep it in a root-only env file, not in the crontab)
5 0 * * * thoth . /etc/thoth/env && curl -s -X POST -H "X-Thoth-Key: $API_WRITE_KEY" http://localhost:4000/api/sitrep -o /dev/null
# 03:00 UTC — full dump, keep 7 days
0 3 * * * postgres pg_dump -Fc -d "postgres://thoth:$POSTGRES_PASSWORD@localhost:5432/thoth" \
  -f /var/backups/thoth/thoth-$(date +\%F).dump \
  && find /var/backups/thoth -name 'thoth-*.dump' -mtime +7 -delete
```

Verify the dump is restorable (a backup you never restored is a rumor):

```sh
createdb thoth_restore_test
pg_restore -d thoth_restore_test /var/backups/thoth/thoth-<date>.dump
psql thoth_restore_test -c 'select count(*) from events;'
dropdb thoth_restore_test
```

## Disaster recovery (empty host)

```sh
# 1. postgres + postgis up (see docker-compose.yml)
# 2. schema (tracked: re-running is safe, applied files are skipped)
npm run db:migrate
# 3a. fast path — re-seed vendored statics, let collectors refill live layers
node dist/scripts/seed-statics.js
node dist/scripts/build-mitre-map.js
# 3b. full path — restore the dump instead of 3a (keeps history/dossiers)
pg_restore -d "$DATABASE_URL" /var/backups/thoth/thoth-<date>.dump
```

Live layers refill on their own cadence (quakes 60s … satellites 6h); full
freshness returns within ~6h on the fast path, instantly on the dump path.

## What is NOT in the dump (rebuild from repo)

- `static/*.json` vendored datasets (in git)
- `.next` build output, `node_modules` (rebuild via CI)
- tunnel URLs (ephemeral by nature)

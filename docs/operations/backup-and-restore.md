# Backup and restore

| Objective | Target |
|---|---|
| RPO (maximum data loss) | 24 h, from the nightly dump |
| RTO (time to restore) | About 15 min from a dump |

There are two ways to recover:

- **Full restore from a dump.** Keeps all history: events, sitreps, notes,
  watches and portfolios.
- **Rebuild from the repository.** Re-seed the static datasets and let the
  collectors refill the live layers. It needs no backup, but history is
  lost.

## Scheduled jobs

Host cron owns scheduling, not the worker. Put both jobs in one file. Keep
secrets in a root-only env file, never in the crontab itself.

```sh
# /etc/thoth/env   (chmod 600)
API_WRITE_KEY=...
POSTGRES_PASSWORD=...
```

```sh
# /etc/cron.d/thoth
SHELL=/bin/sh
# 00:05 UTC: archive today's sitrep (feeds /api/analytics/trend history)
5 0 * * * root . /etc/thoth/env && curl -s -X POST -H "X-Thoth-Key: $API_WRITE_KEY" http://127.0.0.1:4000/api/sitrep -o /dev/null
# 03:00 UTC: full dump, keep 7 days
0 3 * * * root mkdir -p /var/backups/thoth && docker compose -f /opt/thoth/backend/docker-compose.yml exec -T db pg_dump -U thoth -Fc thoth > /var/backups/thoth/thoth-$(date +\%F).dump && find /var/backups/thoth -name 'thoth-*.dump' -mtime +7 -delete
```

Adjust `/opt/thoth` to your checkout path. Copy the dumps off the host, for
example to object storage. A backup that lives only on the machine it
protects does not protect against losing that machine.

## Verify backups (quarterly drill)

A backup you have never restored is untested. Restore into a scratch
database and check the row counts:

```bash
docker compose exec -T db createdb -U thoth thoth_restore_test
docker compose exec -T db pg_restore -U thoth -d thoth_restore_test < /var/backups/thoth/thoth-<date>.dump
docker compose exec -T db psql -U thoth -d thoth_restore_test -c 'select layer, count(*) from events group by 1 order by 2 desc limit 10;'
docker compose exec -T db dropdb -U thoth thoth_restore_test
```

## Disaster recovery

On a new host, first follow [Deployment](deployment.md) steps 1 and 2. That
brings the stack up with an empty, migrated and seeded database. Then pick
one path.

### Full restore (keeps history)

```bash
docker compose stop api worker app
docker compose exec -T db pg_restore -U thoth -d thoth --clean --if-exists < thoth-<date>.dump
docker compose start api worker app
```

Freshness is immediate for everything that was in the dump. Live layers
catch up on their normal schedule.

### Rebuild (no dump)

Compose's `seed` service has already loaded the static datasets. Refill the
live layers:

```bash
docker compose exec worker node dist/workers/run.js --all-once 6
```

Full freshness returns within about 6 hours. History from before the loss
is gone.

## What is not in the dump

| Item | Where it comes from |
|---|---|
| Static datasets (`backend/static/*.json`) | Version control |
| Build output and `node_modules` | `docker compose build` |
| Secrets | Your secret store or `backend/.env`. Back these up separately. |

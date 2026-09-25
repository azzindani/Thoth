# Deployment

The supported production setup is **Docker Compose on a single Linux host**.
The compose file is [`backend/docker-compose.yml`](../../backend/docker-compose.yml).

## Requirements

| | Suggested starting point | Notes |
|---|---|---|
| CPU / RAM | 2 vCPU / 4 GB | The compose memory limits add up to 2 GB (api 512 MB, worker 512 MB, app 1 GB), plus PostgreSQL |
| Disk | 20 GB SSD | Grows with `EVENTS_RETENTION_DAYS`. Watch `thoth_db_size_bytes` (see [Database › Sizing](../architecture/database.md#sizing)). |
| Software | Docker Engine with Compose v2 | |
| Network | Outbound HTTPS to the upstream sources; inbound HTTPS only to your reverse proxy | Some upstreams block certain regions or cloud ranges. The Monitor tab shows which. |

## Topology

```
Internet ──► reverse proxy (TLS) ──► app :3000 ──► api :4000 ──► db
                                     (thoth_edge)   (internal)    (internal)
                                                    ▲
                                  worker ───────────┘ (internal; outbound HTTPS)
```

- Only the **app** should face users. By default, compose publishes it on
  `127.0.0.1:3000`, which is what a reverse proxy on the same host needs.
- The **API** is published on `127.0.0.1:4000` for host cron and debugging
  only.
- The **database** is not published.

## 1. Prepare secrets

Generate three secrets and keep them in the host's secret store or in
`backend/.env` (gitignored, `chmod 600`). Compose reads that file
automatically.

```bash
cd backend
umask 077
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
API_WRITE_KEY=$(openssl rand -hex 32)
APP_ACCESS_KEY=$(openssl rand -hex 32)
EOF
docker compose config -q     # fails fast if a required variable is missing
```

| Secret | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Database password |
| `API_WRITE_KEY` | yes | Authorizes every write to the API. The app injects it server-side. |
| `APP_ACCESS_KEY` | strongly recommended | Access gate for the web terminal. Alternatively, set `APP_TRUST_UPSTREAM_AUTH=1` behind an SSO proxy. |

Without `APP_ACCESS_KEY` (and without `APP_TRUST_UPSTREAM_AUTH`), anyone
who can reach the app can read everything, and writes from the UI are
refused.

For every other setting, see [Configuration](configuration.md).

## 2. Start the stack

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f api worker
```

Compose starts `db`, then the `migrate` and `seed` jobs (which run once and
exit), then `api` and `worker`, then `app` once the API is healthy.

## 3. Verify

```bash
curl -sf localhost:4000/api/readyz          # {"ok":true,...}
curl -sf localhost:3000/healthz             # {"ok":true}
curl -s  localhost:4000/api/stats | head -c 300
```

Open `https://<your-host>/?token=<APP_ACCESS_KEY>` once per browser. The
token is swapped for a 30-day session cookie and removed from the URL.

Live layers fill in on their own schedules, with full freshness within
about 6 hours. To fill them immediately:

```bash
docker compose exec worker node dist/workers/run.js --all-once 6
```

## 4. Put a reverse proxy in front

Terminate TLS at a reverse proxy and forward to the app. There are two
requirements:

- **Do not buffer `/api/stream`.** It is a Server-Sent Events endpoint.
- **Forward the client IP.** Send `X-Forwarded-For` so rate limits apply
  per real client. The default `TRUST_PROXY` trusts private-network hops
  only. Widen it only for proxy hops you know.

### Caddy, sharing a Docker network

Compose creates an external-facing network, `thoth_edge`, that contains
**only** the app container. A reverse proxy running in its own container
can join that network and reach `thoth-app-1:3000` without being able to
see the API or the database.

```bash
docker network connect thoth_edge caddy     # once; survives Thoth rebuilds
```

```caddyfile
thoth.example.com {
	reverse_proxy thoth-app-1:3000 {
		flush_interval -1          # stream SSE without buffering
	}
}
```

Running `docker compose down` and then `up` keeps the network attached:
`down` reports `thoth_edge` as still in use and leaves it, and `up` reuses
it. If the network is ever deleted, run `docker network connect` again. The
proxy does not need a restart.

### Caddy or nginx on the host

Proxy to `127.0.0.1:3000`. For nginx, disable buffering on the stream:

```nginx
location /api/stream {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Behind an SSO proxy

If an identity-aware proxy (for example oauth2-proxy, Cloudflare Access or
Authelia) already authenticates every user, set `APP_TRUST_UPSTREAM_AUTH=1`
and leave `APP_ACCESS_KEY` unset. The app then treats every request as
vetted and attaches the write key to writes. **Only do this if the app
cannot be reached except through that proxy.**

### Quick evaluation with a Cloudflare tunnel

[`boot-host.sh`](../../boot-host.sh) builds the stack, waits for the API
and the app, and opens a temporary `trycloudflare.com` quick tunnel. It is
meant for demos. The URL changes every time and the tunnel ends with the
shell session. Always set `APP_ACCESS_KEY` first, because the tunnel is
public.

```bash
export POSTGRES_PASSWORD=... API_WRITE_KEY=... APP_ACCESS_KEY=...
sh boot-host.sh
```

## 5. Scheduled jobs

Scheduling of host-level jobs belongs to the host's cron, not to the
worker. Install the jobs from
[Backup & restore](backup-and-restore.md#scheduled-jobs):

- **00:05 UTC**: archive the daily sitrep. This feeds trend history.
- **03:00 UTC**: `pg_dump`, keeping 7 days.

## Go-live checklist

- [ ] Secrets generated with `openssl rand -hex 32` and stored outside
      shell history
- [ ] `APP_ACCESS_KEY` set, or `APP_TRUST_UPSTREAM_AUTH=1` behind SSO
- [ ] App reachable only through the reverse proxy; API and DB not
      published publicly
- [ ] TLS in place; `/api/stream` stays connected (no proxy buffering)
- [ ] `/api/readyz` and `/healthz` green; Monitor tab shows WORKER UP
- [ ] Backup cron installed and one restore drill completed
- [ ] `/metrics` scraped by your monitoring and not exposed publicly
- [ ] Optional: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for alert
      delivery

## Updating

```bash
git pull
docker compose up -d --build
```

Migrations run automatically as part of `up`. **Read
[Upgrading](upgrading.md) before pulling across a release** that lists
manual steps.

## Rollback

- **Code:** check out the previous tag or commit and run
  `docker compose up -d --build`. Migrations only move forward, so check the
  release notes for schema changes first.
- **Data:** restore the previous night's dump. See
  [Backup & restore](backup-and-restore.md#disaster-recovery).

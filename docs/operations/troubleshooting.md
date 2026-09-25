# Troubleshooting

## The UI is stuck on "booting…" or "click a dot"

**Symptom:** the page renders server-side text but never becomes
interactive. The backend logs show no errors.

**Cause:** the app is serving an old build's manifest. Every
`/_next/static/chunks/*.js` request returns 500. This happens when
`npm run build` replaces `.next` while `next start` is still serving the
previous build.

**Diagnose:** open the browser console and look for
`_next/static/chunks/*.js → 500`.

**Fix:**

- Docker: `docker compose up -d --build app`. The image is immutable, so
  this cannot happen inside it.
- Native host: always restart through [`app/restart.sh`](../../app/restart.sh).
  It builds, stops the old server safely, starts it detached, then checks
  that `/` **and a real chunk URL** load. It exits non-zero if either
  fails. [`backend/restart.sh`](../../backend/restart.sh) does the same
  for the API and worker.

## Many sources fail with `fetch failed`

`fetch failed` hides the real cause. Check `err.cause.code` from inside the
worker container:

```bash
docker compose exec -T worker node -e \
  "fetch('https://example.org').then(r=>console.log(r.status)).catch(e=>console.log(e.cause?.code, e.message))"
```

| `cause.code` | Likely cause |
|---|---|
| `UND_ERR_CONNECT_TIMEOUT`, `ETIMEDOUT` | Slow or blocked route. Thoth allows 2.5 s per connect attempt (`src/lib/net.ts`). Node's default of 250 ms failed every distant upstream. |
| `ENOTFOUND`, `EAI_AGAIN` | DNS. Compare with `dig @1.1.1.1 <host>`, because some hosting providers' resolvers filter domains. |
| `ECONNRESET`, HTTP/2 stream reset | Upstream edge or WAF dropping the host's IP |
| `CERT_*` | TLS interception or a broken upstream certificate chain |

Compare with `curl` from the host. If the host fails as well, the source
is **host-blocked** (IP, geo, WAF or DNS filtering). That is an
infrastructure decision, not a code bug, so don't route around it. Leave
the source failing: the rest of the system is unaffected.

If **most** sources fail at once, the host has lost outbound connectivity.
A single `ops:mass` alert is raised instead of one alert per source.

## A layer is empty

1. Monitor tab → find the layer's sources. Are they `warming`, `failing`,
   `frozen` or `ok`?
2. `warming` on first boot is normal. Run the collector now (Monitor tab →
   **Run now**, or `--once <collector>`).
3. `ok` but empty: some feeds are legitimately empty when nothing is
   happening, for example warnings in force or tropical storms out of
   season.
4. `failing`: open the source detail to see the last HTTP status and error.
   See [`fetch failed`](#many-sources-fail-with-fetch-failed).

## The Monitor tab shows WORKER DOWN

No heartbeat for 60 s.

```bash
docker compose ps worker
docker compose logs --tail 200 worker
```

Common causes are a database connection failure, an invalid environment
variable (look for a `fatal` line, then see [Configuration](configuration.md)),
or the worker being killed for memory (`docker inspect` → `OOMKilled`).

Compose disables the healthcheck on the worker on purpose. It has no HTTP
port, and the heartbeat is its liveness signal.

## Writes return 401

- **From the UI:** the app attaches `API_WRITE_KEY` only for callers that
  passed the access gate. Check that `APP_ACCESS_KEY` is set (or
  `APP_TRUST_UPSTREAM_AUTH=1`), that you have signed in with `?token=`, and
  that the app's `API_WRITE_KEY` matches the API's.
- **From scripts:** send `Authorization: Bearer <API_WRITE_KEY>` or
  `X-Thoth-Key: <API_WRITE_KEY>` directly to the API on `127.0.0.1:4000`.
- **With `NODE_ENV=production` and no `API_WRITE_KEY`:** all writes are
  refused by design.

## Requests return 429

The per-IP limit (`REQUESTS_PER_MIN`, compose default 300) was hit. Behind
a proxy, make sure `TRUST_PROXY` covers the proxy hop. Otherwise every user
shares the proxy's IP. Test suites that load many pages from one IP need a
higher limit (CI uses 5000).

## `/api/stream` disconnects every few seconds

A reverse proxy is buffering or timing out the SSE response. Disable
buffering on `/api/stream` and raise its read timeout (see
[Deployment › reverse proxy](deployment.md#4-put-a-reverse-proxy-in-front)).
If you get `503` with `Retry-After`, `SSE_MAX_CLIENTS` has been reached.

## Collector tests wiped my data

The collector suites `TRUNCATE` their tables. They must only ever run
against a disposable database (`TEST_DATABASE_URL`, default `…/thoth_test`).
Restore the development data with `npm run db:seed` and
`npm run worker:warmup`.

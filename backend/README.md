# Thoth backend v0 (TypeScript + PostgreSQL)

Production-grade starter: verbose single DB, 11 collectors, REST + SSE API, sanctions mirror, dossier + history, 17 liveness tests green.

## Run (local)

```bash
cp .env.example .env
npm ci
npm run db:migrate
npm run dev:worker   # 11 collectors, staggered + jittered
npm run dev:api      # :4000
```

## Deploy (Docker)

```bash
cp .env.example .env   # set POSTGRES_PASSWORD!
docker compose up -d --build
docker compose logs -f api worker
```

Services: `db` (Timescale+PostGIS, healthchecked) → `migrate` (one-shot, must complete) → `api` + `worker` (restart unless-stopped, 512M caps). Images are multi-stage, non-root, with HEALTHCHECK; `npm ci` from the committed lockfile.

Sandbox note (verified 2026-09-08): Docker 29.1.3 installs and the daemon runs with
`dockerd --iptables=false --bridge=none`, and registry pulls work — but the sandbox
kernel denies `mount`/`unshare`, so layer extraction fails and no container can start
here. Build + run on your host:

```bash
docker compose config   # validate
docker compose up -d --build
docker compose logs -f api worker
curl localhost:4000/api/health
```

Verify (backend must stay green before any UI work):

```bash
npm run typecheck
npm test                          # 17 liveness tests vs API_URL (default localhost:4000)
curl localhost:4000/api/health
curl localhost:4000/api/stats
curl "localhost:4000/api/dossier?lat=51.5&lng=-0.12&radius_km=100"
curl "localhost:4000/api/layers/quakes/history?bucket=day"
curl "localhost:4000/api/osint/sanctions?query=putin&limit=5"
curl -N localhost:4000/api/stream  # SSE: connected + snapshot + layer_changed
```

## Add more open-source endpoints

See `../docs/ADDING_ENDPOINTS.md`. Add `src/workers/collectors/<name>.ts` exporting `collect()`, register in `src/workers/registry.ts`, add migration if new tables needed.

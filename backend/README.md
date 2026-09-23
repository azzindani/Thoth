# Thoth backend (TypeScript + PostgreSQL)

Express API + collector worker over one PostgreSQL (Timescale + PostGIS)
database: 56 collectors, REST + SSE, sanctions mirror, dossier + history,
OSINT lookups. Production model and configuration: `../docs/PRODUCTION.md`.

## Run (local)

```bash
cp .env.example .env
npm ci
npm run db:migrate            # tracked; safe to re-run
npm run db:seed               # vendored statics (bases, ports, airports, …)
npm run db:seed:fixtures      # optional: deterministic demo rows, no network needed
npm run dev:worker            # collectors, staggered + jittered
npm run dev:api               # :4000
```

## Deploy (Docker)

```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 32) API_WRITE_KEY=$(openssl rand -hex 32)
docker compose up -d --build   # db → migrate → seed → api + worker → app
docker compose logs -f api worker
```

Images are multi-stage, non-root, with healthchecks (`/api/readyz`); compose
binds the API to localhost and exposes only the app. Upgrading an existing
host: read `../docs/PRODUCTION.md` §5 first (database volume path changed).

## Verify

```bash
npm run typecheck && npm run lint
npm run test:unit          # pure + in-process API middleware tests, no DB rows
npm run test:collectors    # collector contracts on thoth_test, stubbed fetch (~30s)
npm test                   # live route + alive suites vs API_URL (needs data:
                           # seed + fixtures, and `npm run worker:warmup` for alive)
curl localhost:4000/api/readyz
curl localhost:4000/api/health
curl "localhost:4000/api/dossier?lat=51.5&lng=-0.12&radius_km=100"
curl -N localhost:4000/api/stream   # SSE: connected + snapshot + layer_changed
```

Writes need the key when one is set: `curl -H "X-Thoth-Key: $API_WRITE_KEY" -X POST …`.

## Layout

```
src/api/        app.ts (middleware order) · server.ts (listen/shutdown) · middleware.ts
                routes-core|intel|osint|recon.ts · stream.ts (SSE hub)
src/workers/    registry.ts · run.ts (scheduler, --once, --all-once) · collectors/*.ts · lib/
src/db/         client.ts (pool) · queries.ts
src/scripts/    migrate.ts · seed-statics.ts · seed-fixtures.ts · build-*.ts (static datasets)
db/migrations/  numbered SQL, applied in order, tracked in schema_migrations
```

## Add more open-source endpoints

See `../docs/ADDING_ENDPOINTS.md`. Add `src/workers/collectors/<name>.ts`
exporting `collect()`, register it in `src/workers/registry.ts`, add a
contract test `test/collectors-<name>.test.ts`, and a new migration if it
needs tables.

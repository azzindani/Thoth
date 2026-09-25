# thoth-backend

The Express API and the collector worker for Thoth, backed by one
PostgreSQL database (TimescaleDB and PostGIS).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev:api` | API on `:4000` (tsx, no build step) |
| `npm run dev:worker` | Collector scheduler and background jobs |
| `npm run worker:warmup` | Run every collector once, 6 at a time, then exit |
| `npm run db:migrate` | Apply the SQL migrations (tracked, safe to re-run) |
| `npm run db:seed` | Load the static datasets from `static/` |
| `npm run db:seed:fixtures` | Deterministic demo events (refused in production) |
| `npm run typecheck` / `npm run lint` | `tsc` / Biome |
| `npm run test:unit` | In-process unit and middleware tests |
| `npm run test:collectors` | Collector contract tests on `TEST_DATABASE_URL` (**TRUNCATEs** tables) |
| `npm test` | Route and alive suites against a running API (`API_URL`) |

The scripts do not load `.env`. Only Docker Compose reads it. The defaults
expect `postgres://thoth:thoth@localhost:5432/thoth`.

## Layout

```
src/api/          app.ts (middleware order) · server.ts · routes-*.ts · stream.ts (SSE)
                  monitor.ts · freeze.ts (freshness rules) · source-map.ts (source → collector)
src/workers/      run.ts (scheduler: --once <name>, --all-once [width]) · registry.ts
                  collectors/*.ts · intel.ts (duplicates, incidents, anomalies) · ops.ts (alerts, retention)
                  lib/ (fetch, store, geo, push, …)
src/db/           client.ts (pool) · queries.ts
src/scripts/      migrate.ts · seed-statics.ts · seed-fixtures.ts · build-*.ts (static datasets)
db/migrations/    numbered SQL, applied in order
static/           vendored datasets (JSON)
public/           deprecated single-file terminal (scheduled for removal)
test/             unit, collectors-*, routes-*, alive
```

## Documentation

- [Getting started](../docs/getting-started.md)
- [Architecture](../docs/architecture/overview.md) · [Database](../docs/architecture/database.md)
- [Configuration](../docs/operations/configuration.md) · [Deployment](../docs/operations/deployment.md)
- [API reference](../docs/reference/api.md)
- [Adding data sources](../docs/development/adding-data-sources.md) · [Testing](../docs/development/testing.md)

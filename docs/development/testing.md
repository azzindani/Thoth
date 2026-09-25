# Testing

Every behaviour has a test that fails when the behaviour breaks. Tests
check outcomes (a route answers `200` with rows, one card is pinned) rather
than internals.

## Suites

### Backend (`backend/`)

| Command | What it covers | Needs |
|---|---|---|
| `npm run typecheck` | `tsc` over the source and the tests | — |
| `npm run lint` | Biome over `src` and `test` | — |
| `npm run test:unit` | Pure functions and API middleware in-process (auth, rate limit, CORS, errors) | — |
| `npm run test:collectors` | Contract test for each collector (`test/collectors-*.test.ts`) with a stubbed `fetch`, round-tripped through a real database | `TEST_DATABASE_URL` (default `…/thoth_test`), migrated |
| `npm test` | Route suites (`routes-*.test.ts`) and the alive suite, run over HTTP against a running API | Running API at `API_URL`, seeded statics and fixtures; `worker:warmup` for the alive suite |
| `npm run test:coverage` | Unit and collector suites with Node coverage | Same as collectors |
| `npx playwright test` | The deprecated single-file terminal at `backend/public/` | Running API |

> **Warning:** the collector suites `TRUNCATE` tables. Only ever point
> `TEST_DATABASE_URL` at a disposable database.

### App (`app/`)

| Command | What it covers | Needs |
|---|---|---|
| `npm run typecheck`, `npm run lint` | `tsc`, Biome | — |
| `npm test` | Vitest and jsdom: primitives, palette ranking, workspace links, sitrep, auth, catalog, "since you last looked" digest | — |
| `npm run build` | Production build (standalone) | — |
| `npm run test:e2e` | Playwright: smoke, desk/tablet/phone breakpoints, HUD interactions, floating panels, viewport slicing, analyst workflows, alive | Running API with fixtures, running app |

## Running everything locally

```bash
# one-time: disposable test DB
createdb thoth_test
DATABASE_URL=postgres://thoth:thoth@localhost:5432/thoth_test npm --prefix backend run db:migrate

# backend
cd backend
npm run typecheck && npm run lint && npm run test:unit && npm run test:collectors
npm run db:migrate && npm run db:seed && npm run db:seed:fixtures
REQUESTS_PER_MIN=5000 API_WRITE_KEY=dev-key npm run dev:api &
API_URL=http://localhost:4000 API_WRITE_KEY=dev-key npm test

# app (in another shell, API still running)
cd app
npm run typecheck && npm run lint && npm test && npm run build
API_WRITE_KEY=dev-key APP_TRUST_UPSTREAM_AUTH=1 E2E_STUB_BASEMAP=1 npm run test:e2e
```

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | Steps |
|---|---|
| `backend-static` | typecheck, lint, unit, `npm audit --omit=dev --audit-level=high` |
| `backend-db` | collector contracts on `thoth_test`, migrate twice (idempotency), seed and fixtures, one warm-up pass of every collector, route and alive suites, legacy terminal e2e |
| `app` | typecheck, lint, Vitest, production build, then e2e against the **standalone server** (the same artifact as the Docker image) on fixture data |
| `docker` | `docker compose config -q`, build both images |

The database-backed suites run on **deterministic data**: vendored statics
plus fixture events. CI therefore does not depend on 300 third-party
upstreams being up. The alive suite is the only one that touches real
upstreams, and it checks that every collector *attempted* a run (a health
row exists), never that the upstream succeeded.

## Writing tests

- **Collectors.** Add them to `test/collectors-<collector>.test.ts`. Name
  files and `describe` blocks after what they collect, never after a batch.
  Use `test/helpers/collector-stubs.ts` for the fetch stub and the
  read-back helpers. Cover at least: rows stored with geometry, severity
  mapping, and behaviour when the upstream fails or changes its payload
  shape (the collector throws and does not empty the layer).
- **Routes.** Add them to the matching `test/routes-*.test.ts` and assert
  status and shape. A route that depends on an upstream may answer `502`.
  Accept that as a valid outcome, never fake success.
- **Suites that share a database** run serially (`--test-concurrency=1`).
  Scope assertions to your own source or ids so suites don't interfere with
  each other.
- **Backoff sleeps** are scaled by `THOTH_DELAY_SCALE`. The test scripts set
  it to `0`.
- **E2E on the map.** Panels float over the map, so a feature can be
  rendered and still be covered by chrome. Pick map points with
  `document.elementFromPoint` and click only points whose hit target is the
  map canvas (see `firstPoint` in `breakpoints.spec.ts`, `pointOn` in
  `hud.spec.ts`). Never hard-code "free area" bounds.
- **Stable selectors.** The e2e suites depend on the selectors listed in
  [UI design system §2](ui-design-system.md#2-primitive-catalog-use-these-nothing-else).
  Keep them stable.
- **Rate limits.** A page load makes about 35 requests from one IP. Run
  the API with a high `REQUESTS_PER_MIN` for e2e.

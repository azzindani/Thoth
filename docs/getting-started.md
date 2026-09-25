# Getting started

There are two ways to run Thoth on your own machine:

- [Docker Compose](#option-a-docker-compose), which runs the whole stack the
  same way production does.
- [Native development](#option-b-native-development), which gives you hot
  reload for working on the code.

## Prerequisites

| | Docker Compose | Native |
|---|---|---|
| Docker + Compose v2 | required | optional (for the database only) |
| Node.js | — | 22 (see `.nvmrc`) |
| PostgreSQL | bundled (`timescale/timescaledb-ha:pg16`) | 16 with PostGIS; TimescaleDB recommended |
| Outbound internet | required for live data | required for live data |

## Option A: Docker Compose

```bash
git clone https://github.com/azzindani/Thoth.git
cd Thoth/backend

export POSTGRES_PASSWORD=$(openssl rand -hex 32)   # required
export API_WRITE_KEY=$(openssl rand -hex 32)       # required
export APP_ACCESS_KEY=$(openssl rand -hex 32)      # recommended

docker compose up -d --build
```

Compose starts the services in this order:

1. `db`: PostgreSQL 16 with TimescaleDB and PostGIS.
2. `migrate`: applies the numbered SQL migrations, then exits.
3. `seed`: loads the static datasets (military bases, ports, airports and
   so on), then exits.
4. `api` on `127.0.0.1:4000` and `worker`, the collectors.
5. `app` on `127.0.0.1:3000`, once the API is healthy.

Open `http://localhost:3000/?token=<APP_ACCESS_KEY>` once. The app swaps the
token for a 30-day session cookie.

> Instead of exporting the variables in your shell, you can put them in
> `backend/.env`. Copy `.env.example` to get started. Compose reads that file
> automatically.

## Option B: Native development

### 1. Database

Use a local PostgreSQL 16 with the `postgis` extension. If TimescaleDB is
missing, the migrations skip the hypertables and carry on. You can also run
the database alone from compose:

```bash
cd backend
POSTGRES_PASSWORD=thoth API_WRITE_KEY=dev docker compose up -d db
```

The default `DATABASE_URL` is `postgres://thoth:thoth@localhost:5432/thoth`.

### 2. Backend

The native scripts do not read `backend/.env`. Only Docker Compose does.
The built-in defaults match a local `thoth:thoth` database. To override a
value, export it in your shell. To load the whole file into your shell, run
`set -a; . ./.env; set +a`.

```bash
cd backend
npm ci
npm run db:migrate          # tracked, safe to re-run
npm run db:seed             # static datasets
npm run db:seed:fixtures    # optional: demo events, no network needed
npm run dev:api             # http://localhost:4000
npm run dev:worker          # in a second terminal
```

To fill every live layer right away instead of waiting for each collector's
schedule, run one pass of all collectors:

```bash
npm run worker:warmup       # all collectors once, 6 at a time, then exit
```

### 3. App

```bash
cd app
npm ci
npm run dev                 # http://localhost:3000
```

In development the app proxies `/api/*` to `http://localhost:4000`. With
`APP_ACCESS_KEY` unset, the app is open and needs no token. With
`API_WRITE_KEY` unset and `NODE_ENV` other than `production`, the API
accepts writes without a key.

## Verify

```bash
curl -s localhost:4000/api/readyz            # {"ok":true,...}
curl -s localhost:4000/api/stats | head -c 300
curl -s "localhost:4000/api/dossier?lat=51.5&lng=-0.12&radius_km=100" | head -c 300
curl -N localhost:4000/api/stream            # SSE: connected, snapshot, layer_changed
curl -s localhost:3000/healthz               # {"ok":true}
```

In the UI, open the **Monitor** tab to see every collector and source with
its latest state.

## What to expect on first boot

- Static layers (bases, ports, airports, data centres, theatres) appear as
  soon as seeding finishes.
- Fast feeds, such as earthquakes and alerts, fill within minutes. Slow
  feeds, such as daily datasets and 6-hourly catalogs, fill on their own
  schedule. Allow up to about 6 hours for full freshness, or run
  `npm run worker:warmup`.
- Some upstreams block particular networks or regions. Blocked sources show
  as `failing` in the Monitor tab. The rest of the system is unaffected.

## Next steps

- [Deployment](operations/deployment.md): put Thoth on a server.
- [Configuration](operations/configuration.md): all environment variables.
- [API reference](reference/api.md): query the data directly.
- [Contributing](../CONTRIBUTING.md): make changes.

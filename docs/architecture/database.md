# Thoth — Database (PostgreSQL 16 + TimescaleDB + PostGIS)

Single database. Verbose by design: keep what upstream sent, then what we understood.

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

## Tables

### raw_events (immutable log)
```sql
CREATE TABLE raw_events (
  id BIGSERIAL PRIMARY KEY,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,          -- 'adsb.lol','usgs','t.me/s/osintdefender'
  layer TEXT NOT NULL,           -- 'flights','quakes','telegram'
  http_status INT,
  payload JSONB NOT NULL,
  payload_hash TEXT GENERATED ALWAYS AS (md5(payload::text)) STORED
);
CREATE INDEX ON raw_events (source, fetched_at DESC);
CREATE INDEX ON raw_events USING GIN (payload);
SELECT create_hypertable('raw_events','fetched_at', if_not_exists=>TRUE);
```

### events (normalized, query surface for humans + agents)
```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,           -- stable: source:external_id
  ts TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,
  layer TEXT NOT NULL,
  title TEXT,
  body TEXT,
  url TEXT,
  severity TEXT,                 -- info|watch|critical
  confidence REAL,               -- 0-1 corroboration
  geom GEOMETRY(Geometry,4326),
  entities JSONB,                -- {flights:[], ships:[], wallets:[], tickers:[]}
  meta JSONB,                    -- provider fields, versions
  search TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'')||' '||coalesce(body,''))) STORED
);
SELECT create_hypertable('events','ts', if_not_exists=>TRUE);
CREATE INDEX ON events (layer, ts DESC);
CREATE INDEX ON events USING GIST (geom);
CREATE INDEX ON events USING GIN (search);
CREATE INDEX ON events USING GIN (entities);
```

### entity_graph (Maven object graph)
```sql
CREATE TABLE entity_links (
  a TEXT NOT NULL, b TEXT NOT NULL,
  rel TEXT NOT NULL,              -- 'near','owns','sanctioned','same_event'
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (a,b,rel)
);
```

### Support
```sql
CREATE TABLE feed_health (
  source TEXT PRIMARY KEY,
  last_ok TIMESTAMPTZ, last_attempt TIMESTAMPTZ,
  lag_sec INT, hit_rate REAL, error TEXT
);
CREATE TABLE layer_versions (
  layer TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1
); -- bump on every write, drives since_layer_versions + SSE
CREATE TABLE pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by TEXT, cat TEXT, geom GEOMETRY(Point,4326),
  note TEXT, expires_at TIMESTAMPTZ
);
```

## Retention (Timescale)

```sql
SELECT add_retention_policy('raw_events', INTERVAL '90 days');
SELECT add_retention_policy('events', INTERVAL '365 days');
-- continuous aggregates for Bloomberg strips
CREATE MATERIALIZED VIEW events_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', ts) AS h, layer, count(*) FROM events GROUP BY 1,2;
```

## TypeScript access

- `db/client.ts` — `pg` pool, `DATABASE_URL`, prepared statements only
- `db/queries.ts` — `getLayerSlice(layer,bbox,since)`, `searchEvents(q)`, `getDossier(lat,lng)`, `getVersions()`
- Migrations: `db/migrations/001_init.sql`, run via `npm run db:migrate` (node-pg-migrate or plain SQL files in order)
- Never expose SQL to agents — agents call `/api/*` + channel tools only

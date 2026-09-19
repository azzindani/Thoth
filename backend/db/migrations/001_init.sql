-- Thoth 001_init — verbose single DB (Postgres + Timescale + PostGIS)
-- Timescale is required in prod; sandbox-tolerant (skips hypertables/retention if missing)
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS timescaledb; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'timescaledb missing, continuing without hypertables'; END $$;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS raw_events (
  id BIGSERIAL PRIMARY KEY,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,
  layer TEXT NOT NULL,
  http_status INT,
  payload JSONB NOT NULL,
  payload_hash TEXT GENERATED ALWAYS AS (md5(payload::text)) STORED
);
DO $$ BEGIN PERFORM create_hypertable('raw_events','fetched_at', if_not_exists => TRUE); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip raw_events hypertable'; END $$;
CREATE INDEX IF NOT EXISTS idx_raw_events_source_fetched ON raw_events (source, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_events_payload ON raw_events USING GIN (payload);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,
  layer TEXT NOT NULL,
  title TEXT,
  body TEXT,
  url TEXT,
  severity TEXT,
  confidence REAL,
  geom GEOMETRY(Geometry,4326),
  entities JSONB,
  meta JSONB,
  search TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'')||' '||coalesce(body,''))) STORED
);
DO $$ BEGIN PERFORM create_hypertable('events','ts', if_not_exists => TRUE); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip events hypertable'; END $$;
CREATE INDEX IF NOT EXISTS idx_events_layer_ts ON events (layer, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_geom ON events USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_events_search ON events USING GIN (search);
CREATE INDEX IF NOT EXISTS idx_events_entities ON events USING GIN (entities);

CREATE TABLE IF NOT EXISTS entity_links (
  a TEXT NOT NULL, b TEXT NOT NULL, rel TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (a,b,rel)
);

CREATE TABLE IF NOT EXISTS feed_health (
  source TEXT PRIMARY KEY,
  last_ok TIMESTAMPTZ, last_attempt TIMESTAMPTZ,
  lag_sec INT, hit_rate REAL, error TEXT
);

CREATE TABLE IF NOT EXISTS layer_versions (
  layer TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by TEXT, cat TEXT,
  geom GEOMETRY(Point,4326),
  note TEXT, expires_at TIMESTAMPTZ
);

-- retention (tune in prod; skipped where timescaledb absent)
DO $$ BEGIN PERFORM add_retention_policy('raw_events', INTERVAL '90 days', if_not_exists => TRUE); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip retention'; END $$;
DO $$ BEGIN PERFORM add_retention_policy('events', INTERVAL '365 days', if_not_exists => TRUE); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip retention'; END $$;

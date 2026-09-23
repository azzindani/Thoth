-- 007_monitoring — operational history for the monitor (ROADMAP P1).
-- feed_health keeps the *current* state per source; these tables keep the
-- *history* (runs, upstream calls) and the worker's own liveness/schedule.
-- Retention: the worker prunes these on MONITOR_RETENTION_DAYS (portable —
-- no Timescale retention policy required).

-- One row per collector run (scheduled, manual "run now", or --once).
CREATE TABLE IF NOT EXISTS collector_runs (
  id BIGSERIAL PRIMARY KEY,
  collector TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ms INT NOT NULL,
  ok BOOLEAN NOT NULL,
  count INT,
  error TEXT,
  trigger TEXT NOT NULL DEFAULT 'schedule'
);
CREATE INDEX IF NOT EXISTS idx_collector_runs ON collector_runs (collector, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_collector_runs_started ON collector_runs (started_at);

-- One row per source outcome (every markHealth call).
CREATE TABLE IF NOT EXISTS source_runs (
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_source_runs ON source_runs (source, ts DESC);
CREATE INDEX IF NOT EXISTS idx_source_runs_ts ON source_runs (ts);

-- One row per upstream HTTP call made during a collector run. Path only,
-- secrets redacted, never the query string.
CREATE TABLE IF NOT EXISTS endpoint_calls (
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  collector TEXT,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  status INT,
  ms INT NOT NULL,
  bytes BIGINT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_endpoint_calls_host ON endpoint_calls (host, ts DESC);
CREATE INDEX IF NOT EXISTS idx_endpoint_calls_collector ON endpoint_calls (collector, ts DESC);
CREATE INDEX IF NOT EXISTS idx_endpoint_calls_ts ON endpoint_calls (ts);

-- Worker liveness: one row per worker process, beaten every few seconds.
CREATE TABLE IF NOT EXISTS worker_heartbeat (
  id TEXT PRIMARY KEY,
  host TEXT,
  pid INT,
  version TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  beat_at TIMESTAMPTZ NOT NULL,
  collectors INT
);

-- Cadence as the worker actually runs it (jitter included).
CREATE TABLE IF NOT EXISTS collector_schedule (
  collector TEXT PRIMARY KEY,
  interval_sec INT NOT NULL,
  last_start TIMESTAMPTZ,
  last_end TIMESTAMPTZ,
  next_due TIMESTAMPTZ,
  running BOOLEAN NOT NULL DEFAULT false
);

-- "Run now" queue: the API enqueues, the worker claims (SKIP LOCKED).
CREATE TABLE IF NOT EXISTS collector_requests (
  id BIGSERIAL PRIMARY KEY,
  collector TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  picked_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_collector_requests_open
  ON collector_requests (requested_at) WHERE picked_at IS NULL;

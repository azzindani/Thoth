-- Outbound webhooks (workers/webhooks.ts): one row per item and target,
-- so each critical alert or watch match is delivered once per URL.
-- status: sent | baseline (present when webhooks were first switched on;
-- never delivered) | retry | failed (gave up after the last attempt).
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  http_status INT,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, kind, target)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_updated
  ON webhook_deliveries (updated_at);

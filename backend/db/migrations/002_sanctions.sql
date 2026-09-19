-- Thoth 002 — OpenSanctions OFAC SDN mirror (refreshed daily by collector)
CREATE TABLE IF NOT EXISTS sanctions_entities (
  id TEXT PRIMARY KEY,
  schema TEXT,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  countries TEXT[] NOT NULL DEFAULT '{}',
  dataset TEXT,
  meta JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sanctions_name_trgm ON sanctions_entities USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sanctions_name_btree ON sanctions_entities (name);
CREATE TABLE IF NOT EXISTS sanctions_meta (
  key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

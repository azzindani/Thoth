CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('keyword','layer','severity')),
  value TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

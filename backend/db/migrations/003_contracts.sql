-- Phase 2 cache contracts: content-age + activation markers (worldmonitor CONCEPTS).
ALTER TABLE feed_health ADD COLUMN IF NOT EXISTS content_ts TIMESTAMPTZ;
ALTER TABLE feed_health ADD COLUMN IF NOT EXISTS first_ok_at TIMESTAMPTZ;

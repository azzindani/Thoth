-- Intelligence layer (ROADMAP P4): cross-source duplicates, and the
-- per-layer / per-cell activity samples anomaly baselines are built from.

-- One row per event judged a duplicate of another report of the same
-- real-world thing (e.g. one earthquake from USGS, EMSC and GFZ). Rebuilt
-- wholesale by the worker; readers hide `id` and keep `primary_id`.
CREATE TABLE IF NOT EXISTS event_dups (
	id text PRIMARY KEY,
	primary_id text NOT NULL,
	reason text NOT NULL,
	at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_dups_primary ON event_dups (primary_id);

-- Rolling one-hour activity per layer and 5-degree cell, one row per hour
-- (the last sample in the hour wins).
CREATE TABLE IF NOT EXISTS layer_samples (
	ts timestamptz NOT NULL,
	layer text NOT NULL,
	cell text NOT NULL,
	n integer NOT NULL,
	PRIMARY KEY (layer, cell, ts)
);
CREATE INDEX IF NOT EXISTS layer_samples_ts ON layer_samples (ts);

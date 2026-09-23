-- Area watches (ROADMAP P5): a watch can be a geometry (circle or
-- polygon); anything non-static that lands inside it matches.
ALTER TABLE watchlists ADD COLUMN IF NOT EXISTS geom geometry(Geometry, 4326);
ALTER TABLE watchlists DROP CONSTRAINT IF EXISTS watchlists_kind_check;
ALTER TABLE watchlists ADD CONSTRAINT watchlists_kind_check
	CHECK (kind IN ('keyword', 'layer', 'severity', 'area'));
CREATE INDEX IF NOT EXISTS watchlists_geom ON watchlists USING GIST (geom);

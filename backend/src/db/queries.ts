import { query } from "./client.js";

export async function getStats() {
	const rows = await query<{ layer: string; count: string }>(
		`SELECT layer, count(*)::text AS count FROM events
     WHERE ingested_at > now() - interval '24 hours' GROUP BY layer ORDER BY layer`,
	);
	return rows;
}

export async function getVersions() {
	return query<{ layer: string; version: string }>(
		`SELECT layer, version::text FROM layer_versions ORDER BY layer`,
	);
}

export async function bumpVersion(layer: string) {
	await query(
		`INSERT INTO layer_versions(layer, version) VALUES ($1, 1)
     ON CONFLICT (layer) DO UPDATE SET version = layer_versions.version + 1`,
		[layer],
	);
}

export async function getLayerHistory(
	layer: string,
	bucket: "hour" | "day" = "day",
	from?: string,
	to?: string,
) {
	const trunc = bucket === "hour" ? "hour" : "day";
	const conds = ["layer = $1"];
	const params: unknown[] = [layer];
	if (from) {
		params.push(from);
		conds.push(`ts >= $${params.length}`);
	}
	if (to) {
		params.push(to);
		conds.push(`ts <= $${params.length}`);
	}
	return query<{ bucket: string; count: string }>(
		`SELECT date_trunc('${trunc}', ts)::text AS bucket, count(*)::text AS count
     FROM events WHERE ${conds.join(" AND ")} GROUP BY 1 ORDER BY 1`,
		params,
	);
}

export async function getDossier(lat: number, lon: number, radiusKm = 100) {
	const r = Math.min(Math.max(radiusKm, 1), 1000) * 1000;
	const counts = await query<{ layer: string; count: string }>(
		`SELECT layer, count(*)::text AS count FROM events
     WHERE geom IS NOT NULL AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
       AND ts > now() - interval '7 days' GROUP BY layer ORDER BY count(*) DESC`,
		[lon, lat, r],
	);
	const items = await query(
		`SELECT id, ts, source, layer, title, url, severity,
           ST_AsGeoJSON(geom)::json AS geom
     FROM events WHERE geom IS NOT NULL
       AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
     ORDER BY ts DESC LIMIT 50`,
		[lon, lat, r],
	);
	// Threat assessment composite (world-dashboard pattern): criticals weigh 3x,
	// watch 1x, plus the strongest recent quake magnitude in the window.
	const sev = await query<{ c: string; w: string; maxmag: number | null }>(
		`SELECT count(*) FILTER (WHERE severity='critical')::text AS c,
            count(*) FILTER (WHERE severity='watch')::text AS w,
            max((meta->>'mag')::float) FILTER (WHERE layer='quakes') AS maxmag
     FROM events WHERE geom IS NOT NULL
       AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
       AND ts > now() - interval '7 days'`,
		[lon, lat, r],
	);
	const s = sev[0] ?? { c: "0", w: "0", maxmag: null };
	const score =
		Number(s.c) * 3 + Number(s.w) + Math.min(10, Number(s.maxmag ?? 0));
	const level = score >= 15 ? "HIGH" : score >= 5 ? "ELEVATED" : "GUARDED";
	return {
		counts,
		items,
		threat: { score: Math.round(score * 10) / 10, level },
	};
}

export async function searchSanctions(q: string, limit = 20) {
	const lim = Math.min(Math.max(limit, 1), 100);
	return query(
		`SELECT id, schema, name, aliases, countries, dataset FROM sanctions_entities
     WHERE name ILIKE $1 OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE $1)
     ORDER BY length(name) LIMIT $2`,
		[`%${q.replace(/[%_]/g, "")}%`, lim],
	);
}

export async function getAlerts(limit = 50) {
	const lim = Math.min(Math.max(limit, 1), 200);
	return query(
		`SELECT id, ts, source, layer, title, url, severity,
            ST_AsGeoJSON(geom)::json AS geom
     FROM events WHERE severity IN ('critical','watch') AND ts > now() - interval '24 hours'
     ORDER BY ts DESC LIMIT $1`,
		[lim],
	);
}

export async function getLayerSlice(
	layer: string,
	limit = 500,
	since?: string,
) {
	if (since) {
		return query(
			`SELECT id, ts, source, layer, title, body, url, severity, confidence,
              ST_AsGeoJSON(geom)::json AS geom, entities, meta
       FROM events WHERE layer = $1 AND ts > $2 ORDER BY ts DESC LIMIT $3`,
			[layer, since, limit],
		);
	}
	return query(
		`SELECT id, ts, source, layer, title, body, url, severity, confidence,
            ST_AsGeoJSON(geom)::json AS geom, entities, meta
     FROM events WHERE layer = $1 ORDER BY ts DESC LIMIT $2`,
		[layer, limit],
	);
}

/** Rows per map request by zoom: world views sample, close views fill in. */
export function viewLimit(z: number): number {
	return z < 3 ? 1000 : z < 5 ? 1800 : 3000;
}

/**
 * Map slice for a camera view (ROADMAP P2). Only rows with geometry inside
 * `bbox` (w,s,e,n; w > e crosses the antimeridian) are considered. When
 * more match than the zoom's limit, rows are dealt round-robin from a grid
 * sized to the zoom: every occupied cell's best row (severity, then newest)
 * before any cell's second — so at world zoom every region is represented,
 * not just the newest 500 rows wherever they happen to be.
 */
export async function getLayerView(
	layer: string,
	view: {
		z: number;
		bbox?: [number, number, number, number];
		since?: string;
	},
) {
	const limit = viewLimit(view.z);
	const [w, s, e, n] = view.bbox ?? [-180, -90, 180, 90];
	// ~8 cells across a 512px tile at this zoom.
	const cell = Math.max(360 / 2 ** (Math.max(0, view.z) + 3), 0.01);
	const envelopes =
		w <= e
			? "geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)"
			: "(geom && ST_MakeEnvelope($2, $3, 180, $5, 4326) OR geom && ST_MakeEnvelope(-180, $3, $4, $5, 4326))";
	const rows = await query<Record<string, unknown> & { n_total: string }>(
		`WITH hit AS (
       SELECT id, ts, source, layer, title, body, url, severity, confidence,
              geom, entities, meta, ST_Centroid(geom) AS c
       FROM events
       WHERE layer = $1 AND geom IS NOT NULL AND ${envelopes}
         AND ($6::timestamptz IS NULL OR ts > $6)
     ), ranked AS (
       SELECT *, row_number() OVER (
                PARTITION BY floor(ST_X(c) / $7), floor(ST_Y(c) / $7)
                ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END,
                         ts DESC, id) AS rn,
              count(*) OVER () AS n_total
       FROM hit
     )
     SELECT id, ts, source, layer, title, body, url, severity, confidence,
            ST_AsGeoJSON(geom)::json AS geom, entities, meta, n_total
     FROM ranked
     ORDER BY rn, CASE severity WHEN 'critical' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END,
              ts DESC, id
     LIMIT $8`,
		[layer, w, s, e, n, view.since ?? null, cell, limit],
	);
	const matched = rows.length ? Number(rows[0].n_total) : 0;
	const items = rows.map(({ n_total: _, ...r }) => r);
	return { items, matched, limit, truncated: matched > items.length };
}

// Deterministic brief (no LLM): CRITICAL → WATCH → notable INFO, plus feed gaps.
// Same shape every run for the same data — safe to cache, safe to diff.
export async function getBrief() {
	type Row = {
		id: string;
		ts: string;
		source: string;
		layer: string;
		title: string;
		severity: string;
	};
	const q = (sev: string, lim: number) =>
		query<Row>(
			`SELECT id, ts, source, layer, title, severity FROM events
       WHERE ts > now() - interval '24 hours' AND severity = $1
       ORDER BY ts DESC LIMIT $2`,
			[sev, lim],
		);
	const [critical, watch] = await Promise.all([
		q("critical", 10),
		q("watch", 15),
	]);
	const gaps = await query<{ source: string; error: string | null }>(
		`SELECT source, error FROM feed_health
     WHERE last_ok IS NULL OR content_ts < now() - interval '12 hours'
     ORDER BY source LIMIT 20`,
	);
	const counts = await query<{ layer: string; count: string }>(
		`SELECT layer, count(*)::text AS count FROM events
     WHERE ingested_at > now() - interval '24 hours' GROUP BY layer ORDER BY layer`,
	);
	return {
		generated_at: new Date().toISOString(),
		critical,
		watch,
		gaps,
		counts,
	};
}

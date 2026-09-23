import { query } from "../../db/client.js";
import { bumpVersion } from "../../db/queries.js";

// BP4/BP5: single error-message helper so catch blocks stay `unknown` and API/collector
// surfaces never leak stacks.
export const errMsg = (e: unknown) =>
	e instanceof Error ? e.message : String(e);

export type NormalizedEvent = {
	id: string;
	ts: string;
	source: string;
	layer: string;
	title?: string;
	body?: string;
	url?: string;
	severity?: string;
	confidence?: number;
	lon?: number;
	lat?: number;
	/** Raw GeoJSON geometry (Polygon/MultiPolygon). Wins over lon/lat when set. */
	geomJson?: unknown;
	entities?: Record<string, unknown>;
	meta?: Record<string, unknown>;
};

export async function storeRaw(
	source: string,
	layer: string,
	status: number,
	payload: unknown,
) {
	await query(
		`INSERT INTO raw_events(source, layer, http_status, payload) VALUES ($1,$2,$3,$4)`,
		[source, layer, status, JSON.stringify(payload)],
	);
}

/** Esri and friends ship [x,y,z(,m)] tuples; the events.geom column is 2D. */
function stripZ(v: unknown): unknown {
	if (Array.isArray(v))
		return typeof v[0] === "number" ? v.slice(0, 2) : v.map(stripZ);
	if (v && typeof v === "object")
		return Object.fromEntries(
			Object.entries(v as Record<string, unknown>).map(([k, x]) => [
				k,
				stripZ(x),
			]),
		);
	return v;
}

// Layers written since the last flush. storeNormalized used to bump
// layer_versions once per event — thousands of upserts on the same hot row per
// poll. Now a batch bumps each touched layer once: flushed by markHealth (every
// collector calls it after each source batch) and by the runner after every
// collect(), so readers still see one version move per batch.
const dirtyLayers = new Set<string>();

export async function flushVersions() {
	const layers = [...dirtyLayers];
	dirtyLayers.clear();
	for (const layer of layers) await bumpVersion(layer);
}

export async function storeNormalized(e: NormalizedEvent) {
	await query(
		`INSERT INTO events(id, ts, source, layer, title, body, url, severity, confidence, geom, entities, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         CASE WHEN $14::jsonb IS NOT NULL
              THEN ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($14::jsonb)),4326)
              WHEN $10::float IS NOT NULL AND $11::float IS NOT NULL
              THEN ST_SetSRID(ST_MakePoint($10::float,$11::float),4326) END,
         $12,$13)
		ON CONFLICT (id) DO UPDATE SET ts=EXCLUDED.ts, title=EXCLUDED.title, body=EXCLUDED.body,
          severity=EXCLUDED.severity, geom=EXCLUDED.geom, entities=EXCLUDED.entities, meta=EXCLUDED.meta,
          -- ingested_at = last-seen-in-a-poll (drives the 24h stats window);
          -- ts stays the observation time (drives content_ts / freeze budgets).
          ingested_at=now()`,
		[
			e.id,
			e.ts,
			e.source,
			e.layer,
			e.title ?? null,
			e.body ?? null,
			e.url ?? null,
			e.severity ?? null,
			e.confidence ?? null,
			e.lon ?? null,
			e.lat ?? null,
			JSON.stringify(e.entities ?? {}),
			JSON.stringify(e.meta ?? {}),
			e.geomJson ? JSON.stringify(stripZ(e.geomJson)) : null,
		],
	);
	dirtyLayers.add(e.layer);
}

/** The database clock (ingested_at is written with now()). */
export async function dbClock(): Promise<string> {
	const r = await query<{ t: string }>(`SELECT clock_timestamp()::text AS t`);
	return r[0].t;
}

/** For sources that publish a *current picture* (active warnings, live
 * interference cells): drop this source's rows that the latest successful
 * poll did not re-store, so ended items leave the map. Only call after a
 * poll that succeeded — a failed fetch must never empty the layer.
 * `runStart` comes from dbClock() so app/DB clock skew can't bite. */
export async function pruneStale(source: string, runStart: string) {
	const rows = await query<{ layer: string }>(
		`DELETE FROM events WHERE source=$1 AND ingested_at < $2::timestamptz RETURNING layer`,
		[source, runStart],
	);
	for (const r of rows) dirtyLayers.add(r.layer);
	return rows.length;
}

export async function markHealth(source: string, ok: boolean, error?: string) {
	await flushVersions();
	// Content-age contract: freshness = newest observation date stored for this
	// source, not the run clock. A frozen upstream that still 200s is detectable.
	const content = await query<{ m: string | null }>(
		`SELECT max(ts)::text AS m FROM events WHERE source=$1`,
		[source],
	);
	await query(
		`INSERT INTO feed_health(source, last_ok, last_attempt, error, content_ts, first_ok_at)
     VALUES ($1, CASE WHEN $2 THEN now() END, now(), $3, $4::timestamptz,
       CASE WHEN $2 THEN now() END)
     ON CONFLICT (source) DO UPDATE SET last_attempt=now(),
       last_ok=CASE WHEN $2 THEN now() ELSE feed_health.last_ok END, error=$3,
       content_ts=GREATEST(feed_health.content_ts, $4::timestamptz),
       first_ok_at=COALESCE(feed_health.first_ok_at, CASE WHEN $2 THEN now() END)`,
		[source, ok, error ?? null, content[0]?.m ?? null],
	);
}

// Intelligence layer (ROADMAP P4), deterministic — no LLM:
//  1. Duplicates: the same earthquake from several agencies collapses to
//     one primary report (event_dups; readers hide the rest).
//  2. Incidents: critical/watch events that cluster in space (DBSCAN) and
//     time (48h) across at least two layers or sources become one incident
//     row on the `incidents` layer, with a timeline in meta.
//  3. Anomalies: rolling one-hour activity per layer and 5° cell is
//     sampled hourly; a cell far above (spike) or below (drop) its 7-day
//     median raises a row on the `anomalies` layer. Cleared ones leave.
import { query } from "../db/client.js";
import { log } from "../lib/logger.js";
import { nearestCountry } from "./lib/countries.js";
import {
	dbClock,
	errMsg,
	flushVersions,
	pruneStale,
	storeNormalized,
} from "./lib/store.js";

// ── 1. duplicates ─────────────────────────────────────────────────────────

/** Lower wins as the primary report. Unknown agencies after the known. */
const QUAKE_PRIORITY = [
	"usgs",
	"emsc",
	"geofon",
	"ingv",
	"jma",
	"geonet",
	"bmkg",
	"turkey-afad",
	"turkey-kandilli",
];
const rank = (s: string) => {
	const i = QUAKE_PRIORITY.indexOf(s);
	return i < 0 ? QUAKE_PRIORITY.length : i;
};

export type QuakeRow = {
	id: string;
	source: string;
	ts: string;
	lat: number;
	lon: number;
	mag: number;
};

function km(a: QuakeRow, b: QuakeRow): number {
	const r = Math.PI / 180;
	const x =
		Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
		Math.cos(a.lat * r) *
			Math.cos(b.lat * r) *
			Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
	return 12742 * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Same quake: within 2 minutes, 100 km and 0.5 magnitude. Groups are
 * connected components; the primary is the highest-priority agency (then
 * the earliest id). Returns [duplicateId, primaryId] pairs. */
export function groupQuakes(rows: QuakeRow[]): [string, string][] {
	const q = [...rows].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
	const parent = q.map((_, i) => i);
	const find = (i: number): number => {
		if (parent[i] !== i) parent[i] = find(parent[i]);
		return parent[i];
	};
	for (let i = 0; i < q.length; i++) {
		const ti = Date.parse(q[i].ts);
		for (let j = i + 1; j < q.length; j++) {
			if (Date.parse(q[j].ts) - ti > 120_000) break;
			if (q[i].source === q[j].source) continue;
			if (Math.abs(q[i].mag - q[j].mag) > 0.5) continue;
			if (km(q[i], q[j]) > 100) continue;
			parent[find(j)] = find(i);
		}
	}
	const groups = new Map<number, QuakeRow[]>();
	q.forEach((row, i) => {
		const g = groups.get(find(i)) ?? [];
		g.push(row);
		groups.set(find(i), g);
	});
	const out: [string, string][] = [];
	for (const g of groups.values()) {
		if (g.length < 2) continue;
		g.sort(
			(a, b) => rank(a.source) - rank(b.source) || a.id.localeCompare(b.id),
		);
		for (const d of g.slice(1)) out.push([d.id, g[0].id]);
	}
	return out;
}

export async function markDuplicates(): Promise<number> {
	const rows = await query<QuakeRow>(
		`SELECT id, source, ts::text AS ts, ST_Y(ST_Centroid(geom)) AS lat,
		        ST_X(ST_Centroid(geom)) AS lon, (meta->>'mag')::float AS mag
		   FROM events
		  WHERE layer = 'quakes' AND geom IS NOT NULL
		    AND ts > now() - interval '7 days'
		    AND jsonb_typeof(meta->'mag') = 'number'`,
	);
	const pairs = groupQuakes(rows);
	// Rebuilt in one statement: readers never see an empty table mid-swap.
	await query(
		`WITH gone AS (DELETE FROM event_dups RETURNING 1)
		 INSERT INTO event_dups (id, primary_id, reason)
		 SELECT d, p, 'same quake' FROM unnest($1::text[], $2::text[]) AS t(d, p)`,
		[pairs.map((p) => p[0]), pairs.map((p) => p[1])],
	);
	return pairs.length;
}

// ── 2. incidents ──────────────────────────────────────────────────────────

/** Layers whose critical/watch rows can seed an incident. Background
 * catalogs (airports, cables…), derived layers and ops stay out. */
export const INCIDENT_LAYERS = [
	"quakes",
	"volcanoes",
	"fires",
	"perims",
	"disasters",
	"gdacs",
	"radiation",
	"weather",
	"airwx",
	"oceans",
	"conflicts",
	"drones",
	"navwarn",
	"gpsjam",
	"cyber",
	"news",
	"telegram",
	"health",
];
const INCIDENT_SOURCE = "thoth-incidents";
const EPS_DEG = 1.0; // ~110 km neighbourhood
const TIMELINE_MAX = 40;

type Member = {
	id: string;
	ts: string;
	layer: string;
	source: string;
	title: string | null;
	severity: string;
	lat: number;
	lon: number;
	cid: number;
	dups: number;
};

const SEV = { critical: 0, watch: 1, info: 2 } as Record<string, number>;

export async function buildIncidents(): Promise<{
	incidents: number;
	events: number;
}> {
	const runStart = await dbClock();
	const rows = await query<Member>(
		`WITH pts AS (
		   SELECT e.id, e.ts::text AS ts, e.layer, e.source, e.title, e.severity,
		          ST_Centroid(e.geom) AS g
		     FROM events e
		    WHERE e.geom IS NOT NULL AND e.severity IN ('critical','watch')
		      AND e.layer = ANY($1) AND e.ts > now() - interval '48 hours'
		      AND NOT EXISTS (SELECT 1 FROM event_dups d WHERE d.id = e.id)
		    ORDER BY e.ts DESC LIMIT 20000
		 ), cl AS (
		   SELECT *, ST_ClusterDBSCAN(g, eps := $2, minpoints := 2) OVER () AS cid
		     FROM pts
		 )
		 SELECT cl.id, cl.ts, cl.layer, cl.source, cl.title, cl.severity,
		        ST_Y(cl.g) AS lat, ST_X(cl.g) AS lon, cl.cid,
		        (SELECT count(*)::int FROM event_dups d WHERE d.primary_id = cl.id) AS dups
		   FROM cl WHERE cl.cid IS NOT NULL
		  ORDER BY cl.cid, cl.ts`,
		[INCIDENT_LAYERS, EPS_DEG],
	);
	const clusters = new Map<number, Member[]>();
	for (const r of rows) {
		const c = clusters.get(r.cid) ?? [];
		c.push(r);
		clusters.set(r.cid, c);
	}
	let n = 0;
	for (const c of clusters.values()) {
		const layers = [...new Set(c.map((m) => m.layer))];
		const sources = [...new Set(c.map((m) => m.source))];
		// One feed repeating itself is not an incident; corroboration is.
		if (layers.length < 2 && sources.length < 2) continue;
		const byTs = [...c].sort(
			(a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id),
		);
		const lead = [...c].sort(
			(a, b) =>
				(SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3) ||
				b.ts.localeCompare(a.ts),
		)[0];
		const lat = c.reduce((s, m) => s + m.lat, 0) / c.length;
		const lon = c.reduce((s, m) => s + m.lon, 0) / c.length;
		const radiusKm = Math.round(
			Math.max(
				...c.map((m) =>
					km(
						{ id: "", source: "", ts: "", mag: 0, lat, lon },
						{ id: "", source: "", ts: "", mag: 0, lat: m.lat, lon: m.lon },
					),
				),
			),
		);
		const reports = c.length + c.reduce((s, m) => s + m.dups, 0);
		const place = nearestCountry(lat, lon, 800);
		const title =
			`${lead.title ?? lead.layer} — ${reports} reports · ${layers.join(", ")}${place ? ` · near ${place}` : ""}`.slice(
				0,
				280,
			);
		await storeNormalized({
			// Anchored on the earliest member: stable while the incident grows.
			id: `incident:${byTs[0].id}`.slice(0, 200),
			ts: byTs[byTs.length - 1].ts,
			source: INCIDENT_SOURCE,
			layer: "incidents",
			title,
			body: byTs
				.slice(-5)
				.map((m) => `${m.layer}: ${m.title ?? m.id}`)
				.join("\n"),
			severity: lead.severity,
			confidence: Math.min(0.95, 0.5 + 0.1 * (layers.length + sources.length)),
			lat,
			lon,
			entities: { layers, sources, place: place ?? undefined },
			meta: {
				started: byTs[0].ts,
				updated: byTs[byTs.length - 1].ts,
				events: c.length,
				reports,
				layers,
				sources,
				radius_km: radiusKm,
				lead: lead.id,
				timeline: byTs.slice(-TIMELINE_MAX).map((m) => ({
					id: m.id,
					ts: m.ts,
					layer: m.layer,
					source: m.source,
					severity: m.severity,
					title: m.title,
					dups: m.dups,
				})),
			},
		});
		n++;
	}
	await pruneStale(INCIDENT_SOURCE, runStart);
	await flushVersions();
	return { incidents: n, events: rows.length };
}

// ── 3. anomalies ──────────────────────────────────────────────────────────

/** "present": rows seen in a poll within the hour (live pictures: flights,
 * vessels, jamming cells). "new": observations made within the hour. */
export const ANOMALY_LAYERS: Record<
	string,
	{ metric: "present" | "new"; dir: "drop" | "spike"; label: string }
> = {
	flights: { metric: "present", dir: "drop", label: "Air traffic" },
	vessels: { metric: "present", dir: "drop", label: "Ship traffic" },
	gpsjam: { metric: "present", dir: "spike", label: "GNSS jamming" },
	news: { metric: "new", dir: "spike", label: "News volume" },
	quakes: { metric: "new", dir: "spike", label: "Seismic activity" },
	fires: { metric: "new", dir: "spike", label: "Fire detections" },
	conflicts: { metric: "new", dir: "spike", label: "Conflict reports" },
	cyber: { metric: "new", dir: "spike", label: "Cyber reports" },
};
const CELL = 5;
const ANOMALY_SOURCE = "thoth-anomaly";
const MIN_SAMPLES = 24;

/** Rolling-hour count per layer and cell into this hour's sample row
 * (re-sampling within the hour overwrites). Drop layers also record 0 for
 * cells active in the last day, so a cell that empties is still seen. */
export async function sampleLayers(): Promise<number> {
	let n = 0;
	for (const [layer, cfg] of Object.entries(ANOMALY_LAYERS)) {
		const col = cfg.metric === "present" ? "ingested_at" : "ts";
		const r = await query<{ n: number }>(
			`WITH cur AS (
			   SELECT floor(ST_X(ST_Centroid(geom)) / $2)::int || ',' ||
			          floor(ST_Y(ST_Centroid(geom)) / $2)::int AS cell,
			          count(*)::int AS n
			     FROM events
			    WHERE layer = $1 AND geom IS NOT NULL
			      AND ${col} > now() - interval '1 hour'
			      AND NOT EXISTS (SELECT 1 FROM event_dups d WHERE d.id = events.id)
			    GROUP BY 1
			 ), zeros AS (
			   SELECT DISTINCT s.cell, 0 AS n FROM layer_samples s
			    WHERE $3 AND s.layer = $1 AND s.ts > now() - interval '1 day'
			      AND s.n > 0
			      AND s.cell NOT IN (SELECT cell FROM cur)
			 ), up AS (
			   INSERT INTO layer_samples (ts, layer, cell, n)
			   SELECT date_trunc('hour', now()), $1, cell, n
			     FROM (SELECT * FROM cur UNION ALL SELECT * FROM zeros) x
			   ON CONFLICT (layer, cell, ts) DO UPDATE SET n = EXCLUDED.n
			   RETURNING 1
			 )
			 SELECT count(*)::int AS n FROM up`,
			[layer, CELL, cfg.dir === "drop"],
		);
		n += r[0]?.n ?? 0;
	}
	return n;
}

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type Verdict = {
	dir: "drop" | "spike";
	severity: "critical" | "watch";
	median: number;
	sigma: number;
	z: number;
};

/** Robust score of `n` against a baseline series (median + MAD). Null:
 * normal, or too little history to judge. */
export function judge(
	n: number,
	history: number[],
	dir: "drop" | "spike",
): Verdict | null {
	if (history.length < MIN_SAMPLES) return null;
	const m = median(history);
	const mad = median(history.map((x) => Math.abs(x - m)));
	const sigma = Math.max(1.4826 * mad, 1, 0.1 * m);
	const z = (n - m) / sigma;
	if (dir === "spike") {
		if (n >= m + Math.max(4 * sigma, 3) && n >= 2 * m)
			return {
				dir,
				severity: z >= 8 && n >= 3 * m ? "critical" : "watch",
				median: m,
				sigma,
				z,
			};
		return null;
	}
	if (m >= 10 && n <= 0.3 * m && m - n >= 4 * sigma)
		return {
			dir,
			severity: n <= 0.1 * m ? "critical" : "watch",
			median: m,
			sigma,
			z,
		};
	return null;
}

function cellPolygon(cell: string) {
	const [cx, cy] = cell.split(",").map(Number);
	const w = cx * CELL;
	const s = cy * CELL;
	return {
		type: "Polygon",
		coordinates: [
			[
				[w, s],
				[w + CELL, s],
				[w + CELL, s + CELL],
				[w, s + CELL],
				[w, s],
			],
		],
	};
}

export async function detectAnomalies(): Promise<{
	anomalies: number;
	skipped: string[];
}> {
	const runStart = await dbClock();
	let found = 0;
	const skipped: string[] = [];
	for (const [layer, cfg] of Object.entries(ANOMALY_LAYERS)) {
		const hist = await query<{ cell: string; ts: string; n: number }>(
			`SELECT cell, ts::text AS ts, n FROM layer_samples
			  WHERE layer = $1 AND ts > now() - interval '7 days'
			  ORDER BY cell, ts`,
			[layer],
		);
		if (!hist.length) continue;
		const nowBucket = hist.reduce((m, r) => (r.ts > m ? r.ts : m), "");
		const byCell = new Map<string, { cur: number | null; past: number[] }>();
		const total = new Map<string, number>();
		for (const r of hist) {
			const c = byCell.get(r.cell) ?? { cur: null, past: [] };
			if (r.ts === nowBucket) c.cur = r.n;
			else c.past.push(r.n);
			byCell.set(r.cell, c);
			total.set(r.ts, (total.get(r.ts) ?? 0) + r.n);
		}
		// A dead feed is not an emptied sky: judge drops only while the
		// layer as a whole is near its usual volume.
		if (cfg.dir === "drop") {
			const past = [...total.entries()]
				.filter(([t]) => t !== nowBucket)
				.map(([, v]) => v);
			const cur = total.get(nowBucket) ?? 0;
			if (past.length >= MIN_SAMPLES && cur < 0.5 * median(past)) {
				skipped.push(layer);
				continue;
			}
		}
		for (const [cell, c] of byCell) {
			if (c.cur == null) continue;
			const v = judge(c.cur, c.past, cfg.dir);
			if (!v) continue;
			const [cx, cy] = cell.split(",").map(Number);
			const place = nearestCountry(cy * CELL + CELL / 2, cx * CELL + CELL / 2);
			const usual = Math.round(v.median);
			const change =
				v.dir === "spike"
					? `${(c.cur / Math.max(v.median, 1)).toFixed(1)}×`
					: `−${Math.round((1 - c.cur / Math.max(v.median, 1)) * 100)}%`;
			await storeNormalized({
				id: `anomaly:${layer}:${cell}`,
				ts: new Date().toISOString(),
				source: ANOMALY_SOURCE,
				layer: "anomalies",
				title:
					`${cfg.label} ${v.dir === "spike" ? "surge" : "drop"}${place ? ` near ${place}` : ""}: ${c.cur} in the last hour vs usual ${usual} (${change})`.slice(
						0,
						280,
					),
				severity: v.severity,
				confidence: Math.min(0.95, 0.5 + Math.abs(v.z) / 40),
				geomJson: cellPolygon(cell),
				entities: { layer, place: place ?? undefined },
				meta: {
					layer,
					cell,
					dir: v.dir,
					n: c.cur,
					median: v.median,
					sigma: Math.round(v.sigma * 10) / 10,
					z: Math.round(v.z * 10) / 10,
					samples: c.past.length,
				},
			});
			found++;
		}
	}
	await pruneStale(ANOMALY_SOURCE, runStart);
	await flushVersions();
	return { anomalies: found, skipped };
}

/** One intel pass (worker loop, every 5 minutes). Each stage is isolated:
 * a failure in one never blocks the others. */
export async function intelPass() {
	const out: Record<string, unknown> = {};
	for (const [k, fn] of [
		["dups", markDuplicates],
		["incidents", buildIncidents],
		["samples", sampleLayers],
		["anomalies", detectAnomalies],
	] as const) {
		try {
			out[k] = await fn();
		} catch (e: unknown) {
			out[k] = { error: errMsg(e) };
			log.warn("intel stage failed", { stage: k, error: errMsg(e) });
		}
	}
	return out;
}

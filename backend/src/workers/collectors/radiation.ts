import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import {
	dbClock,
	errMsg,
	markHealth,
	pruneStale,
	storeNormalized,
	storeRaw,
} from "../lib/store.js";

// Safecast citizen radiation network, keyless. Rolling 7-day window so the layer
// reflects live sensors, not the 2020 backfill the unfiltered endpoint returns.
// NOTE 2026-09-15: the API now ignores order/captured_after (serves 2013 rows),
// so Safecast is a frozen-honest fallback; BfS ODL carries the live pulse.
// BfS ODL (Bundesamt für Strahlenschutz, keyless WFS, DL-DE/BY-2.0): the
// latest 1-hour gamma dose rate of every German monitoring station (~1,600
// operating). Current picture: stations that stop reporting are pruned.
// (EPA Ireland radmon was dropped 2026-09-24: its newest rows sit at the
// deepest page offset, past the upstream's 30 s gateway limit, and the API
// ignores every filter and ordering parameter.)
const BFS_ODL_URL =
	"https://www.imis.bfs.de/ogc/opendata/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=opendata:odlinfo_odl_1h_latest&outputFormat=application/json";
// ~900 KB; served in ~4 s, slower under load.
const BFS_TIMEOUT_MS = 60_000;
// Readings older than this are a station that stopped reporting.
const BFS_MAX_AGE_MS = 6 * 3600_000;
// Natural background in Germany is ~0.05–0.18 µSv/h; heavy rain washes
// radon progeny down and can briefly lift a station toward 0.3.
const BFS_WATCH_USV_H = 0.3;
const BFS_CRITICAL_USV_H = 1;

const OdlFeature = z.object({
	geometry: z
		.object({ type: z.literal("Point"), coordinates: z.array(z.number()) })
		.nullable(),
	properties: z
		.object({
			id: z.string(),
			name: z.string().nullish(),
			site_status: z.number().nullish(),
			value: z.number().nullish(),
			value_cosmic: z.number().nullish(),
			value_terrestrial: z.number().nullish(),
			unit: z.string().nullish(),
			end_measure: z.string().nullish(),
			validated: z.number().nullish(),
			height_above_sea: z.number().nullish(),
		})
		.passthrough(),
});
const OdlCollection = z
	.object({ features: z.array(z.unknown()) })
	.passthrough();

export type OdlReading = {
	id: string;
	name: string;
	lon: number;
	lat: number;
	value: number;
	ts: string;
	meta: Record<string, unknown>;
};

export function odlSeverity(usvh: number): "critical" | "watch" | "info" {
	if (usvh >= BFS_CRITICAL_USV_H) return "critical";
	return usvh >= BFS_WATCH_USV_H ? "watch" : "info";
}

/** Operating stations with a reading newer than BFS_MAX_AGE_MS. Throws when
 * the payload is not a feature collection (shape changed). */
export function odlReadings(j: unknown, now = Date.now()): OdlReading[] {
	const out: OdlReading[] = [];
	for (const raw of OdlCollection.parse(j).features) {
		const f = OdlFeature.safeParse(raw);
		if (!f.success || !f.data.geometry) continue;
		const p = f.data.properties;
		const [lon, lat] = f.data.geometry.coordinates;
		const ts = Date.parse(p.end_measure ?? "");
		if (p.site_status !== 1 || p.value == null || Number.isNaN(ts)) continue;
		if (now - ts > BFS_MAX_AGE_MS) continue;
		if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
		out.push({
			id: p.id,
			name: p.name ?? p.id,
			lon,
			lat,
			value: p.value,
			ts: new Date(ts).toISOString(),
			meta: {
				value: p.value,
				cosmic: p.value_cosmic ?? null,
				terrestrial: p.value_terrestrial ?? null,
				unit: p.unit ?? "µSv/h",
				validated: p.validated === 1,
				altitude: p.height_above_sea ?? null,
			},
		});
	}
	return out;
}

/** Newest hour stored by the last run (the worker is long-lived; a restart
 * simply rewrites the picture once). Data is hourly, polls are 15 min. */
let lastOdlHour = "";

const M = z.object({
	id: z.union([z.string(), z.number()]).optional(),
	value: z.union([z.string(), z.number()]).nullable().optional(),
	unit: z.string().nullable().optional(),
	latitude: z.union([z.string(), z.number()]).nullable().optional(),
	longitude: z.union([z.string(), z.number()]).nullable().optional(),
	captured_at: z.string().nullable().optional(),
	location_name: z.string().nullable().optional(),
});

export async function collect() {
	const layer = "radiation";
	let n = 0;
	const errors: string[] = [];
	try {
		const url =
			"https://api.safecast.org/measurements.json?limit=100&order=captured_at+desc&captured_after=" +
			encodeURIComponent(
				new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10),
			);
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const items = z.array(M).parse(await res.json());
		await storeRaw("safecast", layer, res.status, { n: items.length });
		for (const m of items.slice(0, 150)) {
			const lat = Number(m.latitude);
			const lon = Number(m.longitude);
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
			const cpm = Number(m.value);
			const ts = Date.parse(m.captured_at ?? "");
			await storeNormalized({
				id: `safecast:${String(m.id)}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "safecast",
				layer,
				title: `${Number.isFinite(cpm) ? cpm : "?"} ${m.unit ?? "cpm"} — ${m.location_name ?? `${lat.toFixed(2)},${lon.toFixed(2)}`}`,
				severity: Number.isFinite(cpm) && cpm > 100 ? "watch" : "info",
				confidence: 0.8,
				lon,
				lat,
				entities: {},
				meta: { value: m.value, unit: m.unit },
			});
			n++;
		}
		await markHealth("safecast", true);
	} catch (e: unknown) {
		errors.push(`safecast: ${errMsg(e)}`);
		await markHealth("safecast", false, errors[errors.length - 1]);
	}
	try {
		const runStart = await dbClock();
		assertSafeUrl(BFS_ODL_URL);
		const res = await stealthFetch(BFS_ODL_URL, {}, BFS_TIMEOUT_MS);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = odlReadings(await res.json());
		await storeRaw("bfs-odl", layer, res.status, { n: rows.length });
		if (!rows.length) throw new Error("no operating stations with a reading");
		const newest = rows.reduce((m, r) => (r.ts > m ? r.ts : m), "");
		if (newest !== lastOdlHour) {
			for (const r of rows) {
				await storeNormalized({
					id: `bfs-odl:${r.id}`,
					ts: r.ts,
					source: "bfs-odl",
					layer,
					title: `${r.value} µSv/h — ${r.name}`.slice(0, 300),
					severity: odlSeverity(r.value),
					confidence: 0.95,
					lon: r.lon,
					lat: r.lat,
					entities: {},
					meta: r.meta,
				});
			}
			await pruneStale("bfs-odl", runStart);
			lastOdlHour = newest;
		}
		n += rows.length;
		await markHealth("bfs-odl", true);
	} catch (e: unknown) {
		errors.push(`bfs-odl: ${errMsg(e)}`);
		await markHealth("bfs-odl", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

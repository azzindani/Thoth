import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const URL =
	"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
// EMSC FDSN Event (Euro-med + global RTS catalog, keyless): second opinion
// with denser European coverage + felt-region names. Different property
// shape than USGS (mag/time/flynn_region/unid), same thresholds.
const EMSC_URL =
	"https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=50&minmagnitude=4&orderby=time";
// INGV FDSN text (Italy + Med, keyless): pipe-delimited rows, header starts
// with #EventID. Third opinion for the basin USGS/EMSC cover thinly.
const INGV_URL = "https://webservices.ingv.it/fdsnws/event/1/query?starttime=";
const Feature = z.object({
	id: z.string(),
	properties: z.object({
		mag: z.number().nullable(),
		place: z.string().nullable(),
		time: z.number(),
		url: z.string().nullable(),
		title: z.string().nullable(),
	}),
	geometry: z.object({ coordinates: z.array(z.number()) }),
});

export async function collect() {
	const layer = "quakes";
	let n = 0;
	const errors: string[] = [];
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { features?: unknown };
		await storeRaw("usgs", layer, res.status, json);
		const feats = z.array(Feature).parse(json.features ?? []);
		for (const f of feats) {
			const [lon, lat] = f.geometry.coordinates;
			await storeNormalized({
				id: `usgs:${f.id}`,
				ts: new Date(f.properties.time).toISOString(),
				source: "usgs",
				layer,
				title:
					f.properties.title ?? `M${f.properties.mag} ${f.properties.place}`,
				url: f.properties.url ?? undefined,
				severity:
					(f.properties.mag ?? 0) >= 6
						? "critical"
						: (f.properties.mag ?? 0) >= 4.5
							? "watch"
							: "info",
				confidence: 0.95,
				lon,
				lat,
				entities: {},
				meta: { mag: f.properties.mag, place: f.properties.place },
			});
			n++;
		}
		await markHealth("usgs", true);
	} catch (e: unknown) {
		errors.push(`usgs: ${errMsg(e)}`);
		await markHealth("usgs", false, errors[errors.length - 1]);
	}
	try {
		const since = new Date(Date.now() - 24 * 3600e3).toISOString().slice(0, 19);
		const url = `${EMSC_URL}&starttime=${since}`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { features?: unknown };
		const EF = z.object({
			id: z.string().optional(),
			properties: z.object({
				mag: z.number().nullable().optional(),
				time: z.string().optional(),
				flynn_region: z.string().nullable().optional(),
				unid: z.string().optional(),
			}),
			geometry: z.object({ coordinates: z.array(z.number()) }),
		});
		const feats = z.array(EF).parse(json.features ?? []);
		await storeRaw("emsc", layer, res.status, { n: feats.length });
		for (const f of feats.slice(0, 50)) {
			const [lon, lat] = f.geometry.coordinates;
			const mag = f.properties.mag ?? 0;
			const ts = Date.parse(f.properties.time ?? "");
			await storeNormalized({
				id: `emsc:${f.properties.unid ?? f.id ?? `${lon},${lat}`}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "emsc",
				layer,
				title: `M${mag} ${f.properties.flynn_region ?? ""}`.slice(0, 300),
				severity: mag >= 6 ? "critical" : mag >= 4.5 ? "watch" : "info",
				confidence: 0.9,
				lon,
				lat,
				entities: {},
				meta: { mag, region: f.properties.flynn_region },
			});
			n++;
		}
		await markHealth("emsc", true);
	} catch (e: unknown) {
		errors.push(`emsc: ${errMsg(e)}`);
		await markHealth("emsc", false, errors[errors.length - 1]);
	}
	try {
		const since = new Date(Date.now() - 7 * 24 * 3600e3)
			.toISOString()
			.slice(0, 10);
		const url = `${INGV_URL}${since}&endtime=${new Date().toISOString().slice(0, 10)}&minmag=4&format=text&limit=50`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = parseIngv(await res.text());
		await storeRaw("ingv", layer, res.status, { n: rows.length });
		for (const r of rows) {
			await storeNormalized({
				id: `ingv:${r.id}`,
				ts: r.ts,
				source: "ingv",
				layer,
				title: `M${r.mag.toFixed(1)} ${r.place}`.slice(0, 300),
				severity: r.mag >= 6 ? "critical" : r.mag >= 4.5 ? "watch" : "info",
				confidence: 0.9,
				lon: r.lon,
				lat: r.lat,
				entities: {},
				meta: { mag: r.mag, place: r.place, depth: r.depth },
			});
			n++;
		}
		await markHealth("ingv", true);
	} catch (e: unknown) {
		errors.push(`ingv: ${errMsg(e)}`);
		await markHealth("ingv", false, errors[errors.length - 1]);
	}
	// GEOFON Potsdam FDSN text (keyless): same pipe format as INGV, fourth
	// opinion — GFZ catalog, strong in central Asia / mid-Atlantic.
	try {
		const since = new Date(Date.now() - 7 * 24 * 3600e3)
			.toISOString()
			.slice(0, 10);
		const url = `https://geofon.gfz-potsdam.de/fdsnws/event/1/query?starttime=${since}&endtime=${new Date().toISOString().slice(0, 10)}&minmagnitude=4&format=text&limit=50`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = parseIngv(await res.text());
		await storeRaw("geofon", layer, res.status, { n: rows.length });
		for (const r of rows) {
			await storeNormalized({
				id: `geofon:${r.id}`,
				ts: r.ts,
				source: "geofon",
				layer,
				title: `M${r.mag.toFixed(1)} ${r.place}`.slice(0, 300),
				severity: r.mag >= 6 ? "critical" : r.mag >= 4.5 ? "watch" : "info",
				confidence: 0.9,
				lon: r.lon,
				lat: r.lat,
				entities: {},
				meta: { mag: r.mag, place: r.place, depth: r.depth },
			});
			n++;
		}
		await markHealth("geofon", true);
	} catch (e: unknown) {
		errors.push(`geofon: ${errMsg(e)}`);
		await markHealth("geofon", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

export interface IngvRow {
	id: string;
	ts: string;
	lat: number;
	lon: number;
	depth: number | null;
	mag: number;
	place: string;
}

// Exported for unit tests: INGV pipe-delimited text rows.
export function parseIngv(text: string, cap = 50): IngvRow[] {
	const out: IngvRow[] = [];
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		const c = t.split("|");
		// EventID|Time|Lat|Lon|Depth|Author|Cat|Contrib|ContribID|MagType|Mag|MagAuthor|Place|Type
		if (c.length < 13) continue;
		const lat = Number(c[2]);
		const lon = Number(c[3]);
		const mag = Number(c[10]);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		if (!Number.isFinite(mag)) continue;
		const ts = Date.parse(c[1] ?? "");
		const depth = Number(c[4]);
		out.push({
			id: (c[0] ?? "").trim(),
			ts: Number.isNaN(ts)
				? new Date().toISOString()
				: new Date(ts).toISOString(),
			lat,
			lon,
			depth: Number.isFinite(depth) ? depth : null,
			mag,
			place: (c[12] ?? "").trim() || "INGV event",
		});
		if (out.length >= cap) break;
	}
	return out;
}

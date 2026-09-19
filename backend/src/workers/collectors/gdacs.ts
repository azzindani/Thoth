import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// GDACS keyless API: EQ + TC + FL + VO + WF + DR in one call, GeoJSON with alert levels.
const URL =
	"https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR";

const Props = z.object({
	eventid: z.union([z.string(), z.number()]).optional(),
	eventtype: z.string().optional(),
	alertlevel: z.string().optional(),
	country: z.string().optional(),
	name: z.string().optional(),
	htmldescription: z.string().optional(),
	description: z.string().optional(),
	url: z.object({ report: z.string().optional() }).nullable().optional(),
	dateturn: z.string().optional(),
	fromdate: z.string().optional(),
	todate: z.string().optional(),
});
const Feature = z.object({
	type: z.string().optional(),
	geometry: z
		.object({ type: z.string().optional(), coordinates: z.unknown() })
		.nullable()
		.optional(),
	properties: Props.optional(),
});

export function alertToSeverity(a?: string): "critical" | "watch" | "info" {
	if (a === "Red") return "critical";
	if (a === "Orange") return "watch";
	return "info";
}

export function pointOf(coords: unknown): { lon: number; lat: number } | null {
	if (!Array.isArray(coords)) return null;
	// Point [lon, lat(, depth)] or Polygon ring — average first ring
	const ring = (
		typeof coords[0] === "number" ? [coords] : (coords[0] as unknown)
	) as unknown[];
	if (!Array.isArray(ring) || ring.length === 0) return null;
	let x = 0;
	let y = 0;
	let m = 0;
	for (const pt of ring as unknown[][]) {
		if (!Array.isArray(pt)) continue;
		const [lon, lat] = pt as number[];
		if (typeof lon !== "number" || typeof lat !== "number") continue;
		x += lon;
		y += lat;
		m++;
	}
	return m ? { lon: x / m, lat: y / m } : null;
}

export async function collect() {
	const source = "gdacs";
	const layer = "gdacs";
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { features?: unknown };
		const features = z.array(Feature).parse(json.features ?? []);
		await storeRaw(source, layer, res.status, { n: features.length });
		let n = 0;
		for (const f of features.slice(0, 60)) {
			const p = f.properties ?? {};
			const pt = pointOf(f.geometry?.coordinates);
			const title = `${p.eventtype ?? "event"}${p.alertlevel ? ` ${p.alertlevel}` : ""} — ${p.country ?? p.name ?? "?"}`;
			const ts = Date.parse(p.dateturn ?? p.fromdate ?? p.todate ?? "");
			await storeNormalized({
				id: `gdacs:${String(p.eventid ?? `${p.eventtype}-${p.country}-${p.fromdate ?? ""}`)}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source,
				layer,
				title: title.slice(0, 300),
				body: (p.htmldescription ?? p.description ?? "")
					.replace(/<[^>]+>/g, " ")
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, 500),
				url: p.url?.report,
				severity: alertToSeverity(p.alertlevel),
				confidence: 0.9,
				lon: pt?.lon,
				lat: pt?.lat,
				entities: {},
				meta: {
					eventtype: p.eventtype,
					alertlevel: p.alertlevel,
					country: p.country,
				},
			});
			n++;
		}
		await markHealth(source, true);
		return { ok: true, count: n };
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

// GeoNet New Zealand quakes (keyless GeoJSON): second opinion next to
// USGS/EMSC, denser South-Pacific coverage. Same thresholds, `quakes` layer.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const URL = "https://api.geonet.org.nz/quake?MMI=3";

const Quake = z.object({
	type: z.string().optional(),
	geometry: z.object({ coordinates: z.array(z.number()) }),
	properties: z
		.object({
			publicID: z.string().optional(),
			time: z.string().optional(),
			depth: z.number().optional(),
			magnitude: z.number().optional(),
			mmi: z.number().optional(),
			locality: z.string().nullable().optional(),
			quality: z.string().optional(),
		})
		.passthrough(),
});

export async function collect() {
	const source = "geonet";
	const layer = "quakes";
	let n = 0;
	const errors: string[] = [];
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as { features?: unknown };
		const feats = z.array(Quake).parse(j.features ?? []);
		await storeRaw(source, layer, res.status, { n: feats.length });
		for (const f of feats) {
			const [lon, lat] = f.geometry.coordinates;
			const mag = f.properties.magnitude ?? 0;
			const ts = Date.parse(f.properties.time ?? "");
			const id = f.properties.publicID ?? `${lon},${lat}`;
			await storeNormalized({
				id: `geonet:${id}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source,
				layer,
				title: `M${mag.toFixed(1)} ${f.properties.locality ?? ""}`.slice(
					0,
					300,
				),
				severity: mag >= 6 ? "critical" : mag >= 4.5 ? "watch" : "info",
				confidence: 0.9,
				lon,
				lat,
				entities: {},
				meta: { mag, depth: f.properties.depth, mmi: f.properties.mmi },
			});
			n++;
		}
		await markHealth(source, true);
	} catch (e: unknown) {
		errors.push(`${source}: ${errMsg(e)}`);
		await markHealth(source, false, errors[errors.length - 1]);
	}
	// GeoNet volcano VAL (keyless, same host): alert-level/color per
	// monitored NZ volcano — the volcanic leg next to quakes.
	// Probe-verified 2026-09-17 (12 volcanoes, Taupo Green sample).
	try {
		const url = "https://api.geonet.org.nz/volcano/val";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			features?: {
				geometry?: { coordinates?: number[] };
				properties?: {
					volcanoID?: string;
					volcanoTitle?: string;
					acc?: string;
					level?: number;
					activity?: string;
					hazards?: string;
				};
			}[];
		};
		const feats = j.features ?? [];
		await storeRaw("geonet-val", layer, res.status, { n: feats.length });
		for (const f of feats) {
			const p = f.properties ?? {};
			if (!p.volcanoID) continue;
			const [lon, lat] = f.geometry?.coordinates ?? [];
			const acc = (p.acc ?? "").toUpperCase();
			await storeNormalized({
				id: `geonetval:${p.volcanoID}`,
				ts: new Date().toISOString(),
				source: "geonet-val",
				layer,
				title: `${p.volcanoTitle ?? p.volcanoID}: VAL ${p.acc ?? "?"} lvl ${p.level ?? "?"}`,
				severity:
					acc === "RED" ? "critical" : acc === "ORANGE" ? "watch" : "info",
				confidence: 0.85,
				lon: typeof lon === "number" ? lon : undefined,
				lat: typeof lat === "number" ? lat : undefined,
				entities: {},
				meta: {
					volcano: p.volcanoID,
					acc: p.acc ?? null,
					level: p.level ?? null,
					activity: (p.activity ?? "").slice(0, 200),
				},
			});
			n++;
		}
		await markHealth("geonet-val", true);
	} catch (e: unknown) {
		errors.push(`geonet-val: ${errMsg(e)}`);
		await markHealth("geonet-val", false, errors[errors.length - 1]);
	}
	// GeoNet news feed (keyless, same host): data blogs + eruption updates —
	// the comms leg. Probe-verified 2026-09-17 (1290 total, 10/page).
	try {
		const url = "https://api.geonet.org.nz/news/geonet";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			feed?: {
				title?: string;
				type?: string;
				tag?: string;
				published?: string;
				link?: string;
			}[];
		};
		const items = j.feed ?? [];
		await storeRaw("geonet-news", layer, res.status, { n: items.length });
		for (const it of items.slice(0, 5)) {
			if (!it.title || !it.link) continue;
			await storeNormalized({
				id: `geonetnews:${it.link.replace(/[^A-Za-z0-9]+/g, "-").slice(-24)}`,
				ts: it.published ?? new Date().toISOString(),
				source: "geonet-news",
				layer,
				title: `GeoNet ${it.type ?? "news"}: ${it.title.slice(0, 200)}`,
				severity: /eruption|unrest|earthquake/i.test(it.title)
					? "watch"
					: "info",
				confidence: 0.8,
				entities: {},
				meta: { tag: it.tag ?? null, link: it.link },
			});
			n++;
		}
		await markHealth("geonet-news", true);
	} catch (e: unknown) {
		errors.push(`geonet-news: ${errMsg(e)}`);
		await markHealth("geonet-news", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

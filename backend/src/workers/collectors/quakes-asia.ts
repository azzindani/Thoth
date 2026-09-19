// JMA (Japan) + BMKG (Indonesia) quakes: keyless national catalogs denser
// than USGS for their arcs. JMA `cod` = "+lat+lon-depth/" (depth in meters,
// often -10000 placeholder); `mag` string; `maxi` = shindo 1-7. BMKG
// `Infogempa.gempa[]` with Coordinates "lat,lon", Kedalaman "N km",
// Potensi tsunami flag. Same thresholds → `quakes` layer.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const JMA_URL = "https://www.jma.go.jp/bosai/quake/data/list.json";
const BMKG_URL = "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json";

const JmaRow = z.object({
	eid: z.string().optional(),
	rdt: z.string().optional(),
	anm: z.string().optional(),
	cod: z.string().optional(),
	mag: z.string().optional(),
	maxi: z.string().optional(),
});

const BmkgRow = z.object({
	DateTime: z.string().optional(),
	Coordinates: z.string().optional(),
	Magnitude: z.string().optional(),
	Kedalaman: z.string().optional(),
	Wilayah: z.string().optional(),
	Potensi: z.string().optional(),
});

function parseJmaCod(cod?: string): { lat: number; lon: number } | null {
	// "+32.2+130.4-10000/" → lat 32.2, lon 130.4
	const m = (cod ?? "").match(/^([+-][\d.]+)([+-][\d.]+)/);
	if (!m) return null;
	const lat = Number(m[1]);
	const lon = Number(m[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return { lat, lon };
}

function sev(mag: number): "info" | "watch" | "critical" {
	if (mag >= 6) return "critical";
	if (mag >= 4.5) return "watch";
	return "info";
}

export async function collect() {
	const layer = "quakes";
	let n = 0;
	const errors: string[] = [];

	try {
		assertSafeUrl(JMA_URL);
		const res = await stealthFetch(JMA_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z.array(JmaRow).parse(await res.json());
		await storeRaw("jma", layer, res.status, { n: rows.length });
		for (const r of rows.slice(0, 30)) {
			const ll = parseJmaCod(r.cod);
			if (!ll) continue;
			const mag = Number(r.mag ?? NaN);
			const ts = Date.parse(r.rdt ?? "");
			const eid = r.eid ?? `${ll.lat},${ll.lon}`;
			await storeNormalized({
				id: `jma:${eid}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "jma",
				layer,
				title:
					`M${Number.isFinite(mag) ? mag.toFixed(1) : "?"} ${r.anm ?? ""} (shindo ${r.maxi ?? "?"})`.slice(
						0,
						300,
					),
				severity: sev(Number.isFinite(mag) ? mag : 0),
				confidence: 0.9,
				lon: ll.lon,
				lat: ll.lat,
				entities: {},
				meta: { mag, shindo: r.maxi },
			});
			n++;
		}
		await markHealth("jma", true);
	} catch (e: unknown) {
		errors.push(`jma: ${errMsg(e)}`);
		await markHealth("jma", false, errors[errors.length - 1]);
	}

	try {
		assertSafeUrl(BMKG_URL);
		const res = await stealthFetch(BMKG_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			Infogempa?: { gempa?: unknown };
		};
		const rows = z.array(BmkgRow).parse(j.Infogempa?.gempa ?? []);
		await storeRaw("bmkg", layer, res.status, { n: rows.length });
		for (const r of rows.slice(0, 30)) {
			const [la, lo] = (r.Coordinates ?? "").split(",").map(Number);
			if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
			const mag = Number(r.Magnitude ?? NaN);
			const ts = Date.parse(r.DateTime ?? "");
			const tsunami = /berpotensi/i.test(r.Potensi ?? "");
			await storeNormalized({
				id: `bmkg:${r.DateTime ?? `${la},${lo}`}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "bmkg",
				layer,
				title:
					`M${Number.isFinite(mag) ? mag.toFixed(1) : "?"} ${r.Wilayah ?? ""}${tsunami ? " — TSUNAMI POTENTIAL" : ""}`.slice(
						0,
						300,
					),
				severity:
					tsunami || (Number.isFinite(mag) && mag >= 6)
						? "critical"
						: Number.isFinite(mag) && mag >= 4.5
							? "watch"
							: "info",
				confidence: 0.9,
				lon: lo,
				lat: la,
				entities: {},
				meta: {
					mag,
					depth: r.Kedalaman,
					tsunamiPotential: tsunami,
				},
			});
			n++;
		}
		await markHealth("bmkg", true);
	} catch (e: unknown) {
		errors.push(`bmkg: ${errMsg(e)}`);
		await markHealth("bmkg", false, errors[errors.length - 1]);
	}

	// JMA Tokyo + Osaka forecasts (keyless bosai JSON): 3-day weather
	// codes — the Japan-conditions leg next to the JMA quake catalog.
	for (const [city, fcode, clon, clat] of [
		["tokyo", "130000", 139.69, 35.69],
		["osaka", "270000", 135.5, 34.69],
		["nagoya", "230000", 136.91, 35.18],
		["fukuoka", "400000", 130.4, 33.59],
		["yokohama", "140000", 139.64, 35.45],
		["sapporo", "016000", 141.35, 43.06],
	] as const) {
		try {
			const url = `https://www.jma.go.jp/bosai/forecast/data/forecast/${fcode}.json`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${city}`);
			const j = (await res.json()) as {
				reportDatetime?: string;
				timeSeries?: {
					timeDefines?: string[];
					areas?: {
						area?: { name?: string };
						weatherCodes?: string[];
						weathers?: string[];
					}[];
				}[];
			}[];
			const area = j[0]?.timeSeries?.[0]?.areas?.[0];
			const defs = j[0]?.timeSeries?.[0]?.timeDefines ?? [];
			await storeRaw("jma-forecast", layer, res.status, {
				city,
				n: area?.weatherCodes?.length ?? 0,
			});
			for (let i = 0; i < (area?.weatherCodes?.length ?? 0) && i < 3; i++) {
				const wcode = area?.weatherCodes?.[i] ?? "?";
				const wx = (area?.weathers?.[i] ?? "")
					.replace(/\u3000/g, " ")
					.slice(0, 120);
				await storeNormalized({
					id: `jmafx:${city}:${(defs[i] ?? "").slice(0, 10)}`,
					ts: defs[i] ?? new Date().toISOString(),
					source: "jma-forecast",
					layer,
					title: `${city[0].toUpperCase()}${city.slice(1)} ${wcode}: ${wx}`,
					severity: /^3|^4/.test(wcode) ? "watch" : "info",
					confidence: 0.9,
					lon: clon,
					lat: clat,
					entities: {},
					meta: { code: wcode, day: (defs[i] ?? "").slice(0, 10) },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`jmafx/${city}: ${errMsg(e)}`);
		}
	}
	const jmafxOk = !errors.some((e) => e.startsWith("jmafx/"));
	await markHealth(
		"jma-forecast",
		jmafxOk,
		jmafxOk ? undefined : errors.join("; "),
	);

	// Kandilli + AFAD live (orhanaydogdu mirror, keyless): Turkish quakes
	// with geojson points — the Anatolian leg next to JMA/BMKG.
	for (const [prov, label] of [
		["kandilli", "Kandilli"],
		["afad", "AFAD"],
	] as const) {
		try {
			const url = `https://api.orhanaydogdu.com.tr/deprem/${prov}/live`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${prov}`);
			const j = (await res.json()) as {
				result?: {
					earthquake_id?: string;
					title?: string;
					mag?: number;
					depth?: number;
					date_time?: string;
					geojson?: { coordinates?: number[] };
					location_properties?: { closestCity?: { name?: string } };
				}[];
			};
			const rows = (j.result ?? []).filter(
				(r) => typeof r.mag === "number" && r.mag >= 2.0,
			);
			await storeRaw(`turkey-${prov}`, layer, res.status, { n: rows.length });
			for (const r of rows.slice(0, 15)) {
				if (!r.earthquake_id) continue;
				const coords = r.geojson?.coordinates ?? [];
				const lon = coords[0];
				const lat = coords[1];
				if (typeof lat !== "number" || typeof lon !== "number") continue;
				await storeNormalized({
					id: `turkey:${prov}:${r.earthquake_id.slice(0, 16)}`,
					ts: r.date_time
						? new Date(r.date_time.replace(" ", "T")).toISOString()
						: new Date().toISOString(),
					source: `turkey-${prov}`,
					layer,
					title:
						`M${(r.mag as number).toFixed(1)} ${r.title ?? "?"} — ${r.location_properties?.closestCity?.name ?? "?"} (${label})`.slice(
							0,
							300,
						),
					severity: (r.mag as number) >= 4.5 ? "watch" : "info",
					confidence: 0.85,
					lon,
					lat,
					entities: {},
					meta: {
						mag: r.mag,
						depth: r.depth ?? null,
						city: r.location_properties?.closestCity?.name ?? null,
					},
				});
				n++;
			}
			await markHealth(`turkey-${prov}`, true);
		} catch (e: unknown) {
			errors.push(`turkey-${prov}: ${errMsg(e)}`);
			await markHealth(`turkey-${prov}`, false, errors[errors.length - 1]);
		}
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

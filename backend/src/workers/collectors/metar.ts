// Aviation surface observations via NOAA Aviation Weather Center (keyless,
// US-gov public domain). METAR = current conditions at major fields, TAF =
// terminal forecast. Complements the `airwx` SIGMET polygons with point
// obs. One request per product for a curated world station list (well under
// the 400-id / 100-req-min AWC limits).
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const METAR_URL = "https://aviationweather.gov/api/data/metar";
const TAF_URL = "https://aviationweather.gov/api/data/taf";

// Curated world fields: hubs + theater-adjacent strips. Static facts.
const STATIONS = [
	"KJFK",
	"KLAX",
	"KORD",
	"KMIA",
	"EGLL",
	"LFPG",
	"EDDF",
	"EHAM",
	"LEMD",
	"LIRF",
	"CYYZ",
	"SBGR",
	"FACT",
	"OMDB",
	"OERK",
	"VIDP",
	"VHHH",
	"ZBAA",
	"RJTT",
	"RKSI",
	"WSSS",
	"YSSY",
	"LTFM",
	"HECA",
	"OIIE",
	"UKBB",
	"EPWA",
	"LROP",
	"LGAV",
	"HLLT",
	"ORBI",
	"OISS",
	"VOBL",
	"ZSPD",
	"KSEA",
	"PANC",
	"BGTL",
	"OKBK",
	"LLBG",
	"OTHH",
	"VEMH",
	"UAAA",
	"DAAG",
	"GMMN",
];

const Metar = z.object({
	icaoId: z.string(),
	obsTime: z.union([z.string(), z.number()]).optional(),
	temp: z.number().nullable().optional(),
	dewp: z.number().nullable().optional(),
	wdir: z.union([z.string(), z.number()]).nullable().optional(),
	wspd: z.number().nullable().optional(),
	wgst: z.number().nullable().optional(),
	visib: z.union([z.string(), z.number()]).nullable().optional(),
	fltCat: z.string().nullable().optional(),
	wxString: z.string().nullable().optional(),
	lat: z.number().nullable().optional(),
	lon: z.number().nullable().optional(),
	name: z.string().nullable().optional(),
});

const Taf = z.object({
	icaoId: z.string(),
	issueTime: z.string().optional(),
	validTimeFrom: z.number().nullable().optional(),
	validTimeTo: z.number().nullable().optional(),
	rawTAF: z.string().nullable().optional(),
});

export function metarSeverity(
	fltCat?: string | null,
): "info" | "watch" | "critical" {
	const c = (fltCat ?? "").toUpperCase();
	if (c === "LIFR") return "critical";
	if (c === "IFR") return "watch";
	return "info";
}

export async function collect() {
	const layer = "metar";
	let n = 0;
	const errors: string[] = [];
	const ids = STATIONS.join(",");
	const coords = new Map<string, { lon: number; lat: number }>();

	try {
		const url = `${METAR_URL}?ids=${ids}&format=json`;
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z.array(Metar).parse(await res.json());
		await storeRaw("awc-metar", layer, res.status, { n: rows.length });
		for (const m of rows) {
			const lon = m.lon ?? undefined;
			const lat = m.lat ?? undefined;
			if (typeof lon === "number" && typeof lat === "number")
				coords.set(m.icaoId, { lon, lat });
			const obs =
				typeof m.obsTime === "number"
					? m.obsTime * 1000
					: Date.parse(m.obsTime ?? "");
			await storeNormalized({
				id: `awc-metar:${m.icaoId}:${m.obsTime ?? "na"}`,
				ts: Number.isNaN(obs)
					? new Date().toISOString()
					: new Date(obs).toISOString(),
				source: "awc-metar",
				layer,
				title: `${m.icaoId} ${m.fltCat ?? "UNK"} ${m.temp ?? "?"}°C vis ${m.visib ?? "?"}`,
				body:
					[m.wxString, m.name].filter(Boolean).join(" · ").slice(0, 300) ||
					undefined,
				severity: metarSeverity(m.fltCat),
				confidence: 0.95,
				lon,
				lat,
				entities: {},
				meta: {
					icao: m.icaoId,
					fltCat: m.fltCat,
					temp: m.temp,
					dewpoint: m.dewp,
					wdir: typeof m.wdir === "number" ? m.wdir : null,
					wspd: m.wspd,
					gust: m.wgst,
				},
			});
			n++;
		}
		await markHealth("awc-metar", true);
	} catch (e: unknown) {
		errors.push(`awc-metar: ${errMsg(e)}`);
		await markHealth("awc-metar", false, errors[errors.length - 1]);
	}

	try {
		const url = `${TAF_URL}?ids=${ids}&format=json`;
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z.array(Taf).parse(await res.json());
		await storeRaw("awc-taf", layer, res.status, { n: rows.length });
		for (const t of rows) {
			const g = coords.get(t.icaoId);
			const from =
				typeof t.validTimeFrom === "number"
					? t.validTimeFrom * 1000
					: Date.now();
			await storeNormalized({
				id: `awc-taf:${t.icaoId}:${t.validTimeFrom ?? "na"}`,
				ts: new Date(from).toISOString(),
				source: "awc-taf",
				layer,
				title: `TAF ${t.icaoId} valid ${new Date(from).toISOString().slice(0, 16)}Z`,
				body: (t.rawTAF ?? "").slice(0, 300) || undefined,
				severity: "info",
				confidence: 0.9,
				lon: g?.lon,
				lat: g?.lat,
				entities: {},
				meta: { icao: t.icaoId, validTo: t.validTimeTo },
			});
			n++;
		}
		await markHealth("awc-taf", true);
	} catch (e: unknown) {
		errors.push(`awc-taf: ${errMsg(e)}`);
		await markHealth("awc-taf", false, errors[errors.length - 1]);
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

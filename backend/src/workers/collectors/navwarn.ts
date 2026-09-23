// NGA Maritime Safety Information broadcast warnings (keyless JSON):
// NAVAREA IV/XII + HYDROLANT/HYDROPAC/HYDROARC. The official channel for
// missile/rocket firing boxes, GNSS interference, live-fire and exercise
// areas, mines, piracy. Coordinates live in the free text
// ("35-12.40N 024-56.78E"); lettered paragraphs are separate areas.
// A current picture: cancelled warnings leave the map via pruneStale.
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

const URL_ACTIVE =
	"https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active";
const SOURCE = "nga-msi";

const AREA_NAME: Record<string, string> = {
	"4": "NAVAREA IV",
	"12": "NAVAREA XII",
	A: "HYDROLANT",
	P: "HYDROPAC",
	C: "HYDROARC",
};

const Warn = z
	.object({
		msgYear: z.coerce.number(),
		msgNumber: z.coerce.number(),
		navArea: z.coerce.string(),
		subregion: z.string().nullish(),
		text: z.string(),
		issueDate: z.string().nullish(),
		authority: z.string().nullish(),
	})
	.passthrough();

type Pt = [number, number]; // [lon, lat]

const COORD =
	/(\d{1,2})-(\d{1,2}(?:\.\d+)?)(?:-(\d{1,2}(?:\.\d+)?))?\s*([NS])\s*,?\s*(\d{1,3})-(\d{1,2}(?:\.\d+)?)(?:-(\d{1,2}(?:\.\d+)?))?\s*([EW])/g;

/** Every "DD-MM.mmN DDD-MM.mmE" in a text span, as [lon, lat]. */
export function parseNavCoords(text: string): Pt[] {
	const out: Pt[] = [];
	for (const m of text.matchAll(COORD)) {
		let lat = Number(m[1]) + Number(m[2]) / 60 + Number(m[3] ?? 0) / 3600;
		let lon = Number(m[5]) + Number(m[6]) / 60 + Number(m[7] ?? 0) / 3600;
		if (m[4] === "S") lat = -lat;
		if (m[8] === "W") lon = -lon;
		if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
			out.push([+lon.toFixed(4), +lat.toFixed(4)]);
	}
	return out;
}

/** Warning text → one GeoJSON geometry: areas (≥3 vertices in a
 * paragraph that bounds an area) win, then tracklines, then points. */
export function navGeometry(text: string): unknown | null {
	// Lettered/numbered paragraphs ("A. 35-..", "2. ..") are separate areas.
	const parts = text.split(/\n\s*(?:[A-Z]|\d{1,2})\.\s+/);
	const polys: Pt[][][] = [];
	const lines: Pt[][] = [];
	const points: Pt[] = [];
	for (const p of parts) {
		const c = parseNavCoords(p);
		if (!c.length) continue;
		// Not "BETWEEN x AND y": that is how firing windows are written.
		const isLine = /TRACK ?LINE|LINE JOINING|ALONG/i.test(p);
		if (c.length >= 3 && !isLine) polys.push([[...c, c[0]]]);
		else if (c.length >= 2 && isLine) lines.push(c);
		else points.push(...c);
	}
	if (polys.length) return { type: "MultiPolygon", coordinates: polys };
	if (lines.length) return { type: "MultiLineString", coordinates: lines };
	if (points.length === 1) return { type: "Point", coordinates: points[0] };
	if (points.length) return { type: "MultiPoint", coordinates: points };
	return null;
}

export function navSeverity(text: string): "critical" | "watch" | "info" {
	const t = text.toUpperCase();
	if (
		/MISSILE|\bMINES?\b|MINED|ATTACK|PIRACY|ARMED ROBBERY|HIJACK|UNEXPLODED|HOSTILE|ARMED CONFLICT/.test(
			t,
		)
	)
		return "critical";
	if (
		/GNSS|\bGPS\b|JAMMING|INTERFERENCE|ROCKET|FIRING|GUNNERY|MILITARY EXERCISE|NAVAL EXERCISE|HAZARDOUS OPERATIONS|SPACE DEBRIS|SUBMARINE/.test(
			t,
		)
	)
		return "watch";
	return "info";
}

const MONTHS = "JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC";
/** "281722Z AUG 2026" (DDHHMMZ MON YYYY) → ISO; null when unparseable. */
export function parseDtg(s: string | null | undefined): string | null {
	const m = s?.match(/(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{4})/i);
	if (!m) return null;
	const mon = MONTHS.indexOf(m[4].toUpperCase()) / 3;
	if (mon < 0 || !Number.isInteger(mon)) return null;
	const d = Date.UTC(+m[5], mon, +m[1], +m[2], +m[3]);
	return Number.isNaN(d) ? null : new Date(d).toISOString();
}

/** "EASTERN MEDITERRANEAN." + "1. HAZARDOUS OPERATIONS ..." → headline. */
export function navHeadline(text: string): string {
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const region = (lines[0] ?? "").replace(/\.$/, "");
	const subj =
		lines.find((l) => /^1\.\s/.test(l))?.replace(/^1\.\s+/, "") ??
		lines[1] ??
		"";
	return subj ? `${region} — ${subj}` : region;
}

export async function collect() {
	const layer = "navwarn";
	const runStart = await dbClock();
	try {
		assertSafeUrl(URL_ACTIVE);
		const res = await stealthFetch(URL_ACTIVE, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as unknown;
		const arr = Array.isArray(json)
			? json
			: ((json as Record<string, unknown>)["broadcast-warn"] ?? []);
		const warns = z.array(Warn).parse(arr);
		await storeRaw(SOURCE, layer, res.status, { n: warns.length });
		let n = 0;
		let geo = 0;
		for (const w of warns) {
			const area = AREA_NAME[w.navArea] ?? `NAVAREA ${w.navArea}`;
			const yy = String(w.msgYear).slice(-2);
			const geom = navGeometry(w.text);
			if (geom) geo++;
			await storeNormalized({
				id: `navwarn:${w.navArea}:${w.msgYear}:${w.msgNumber}`,
				ts: parseDtg(w.issueDate) ?? new Date().toISOString(),
				source: SOURCE,
				layer,
				title: `${area} ${w.msgNumber}/${yy} · ${navHeadline(w.text)}`.slice(
					0,
					280,
				),
				body: w.text.slice(0, 4000),
				url: "https://msi.nga.mil/NavWarnings",
				severity: navSeverity(w.text),
				confidence: 0.95,
				geomJson: geom ?? undefined,
				entities: { navArea: area },
				meta: {
					navArea: area,
					subregion: w.subregion ?? null,
					authority: w.authority ?? null,
					located: !!geom,
				},
			});
			n++;
		}
		// An empty list from a 200 is more likely an upstream hiccup than a
		// world without a single active warning: never empty the layer on it.
		if (n > 0) await pruneStale(SOURCE, runStart);
		await markHealth(SOURCE, n > 0, n > 0 ? undefined : "no active warnings");
		return { ok: n > 0, count: n, located: geo };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

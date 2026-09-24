// Official public warnings (keyless), each a CURRENT picture pruned after a
// successful poll so lifted warnings leave the map:
//   eccc-alerts  Environment Canada weather alerts (MSC GeoMet OGC API),
//                one row per alerted forecast region → `weather`
//   ea-floods    Environment Agency flood warnings, England → `disasters`
//   mowas        German federal warning system (MoWaS via warnung.bund.de,
//                the NINA app's feed): civil-protection alerts → `disasters`
//   katwarn, biwapp, lhp-floods, de-police
//                the other warnung.bund.de providers — same record shape and
//                footprint lookup as MoWaS (DWD weather is `dwd-warn`)
//   hko-warn     Hong Kong Observatory warnings in force (typhoon signals,
//                rainstorm, landslip, tsunami…) → `weather`
//   jma-warn     Japan Meteorological Agency warnings and advisories (2026
//                "r8" system), one row per forecast sub-area → `weather`
// Area geometries become one marker each (lib/geo pointOf); area lookups are
// cached in memory, since flood areas and warning footprints do not move.
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { type LonLat, pointOf } from "../lib/geo.js";
import {
	dbClock,
	errMsg,
	markHealth,
	pruneStale,
	storeNormalized,
	storeRaw,
} from "../lib/store.js";

// Geometry is most of this payload and the server is slow (~25s for ~400KB),
// so ask only for the properties we store and allow a long timeout.
const ECCC_URL =
	"https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=1000&lang=en&properties=alert_type,alert_short_name_en,alert_name_en,publication_datetime,expiration_datetime,feature_name_en,province,risk_colour_en";
const ECCC_TIMEOUT_MS = 60_000;
const ECCC_PAGE = "https://weather.gc.ca/warnings/index_e.html";
const EA_FLOODS_URL =
	"https://environment.data.gov.uk/flood-monitoring/id/floods";
const EA_AREA_URL = (id: string) =>
	`https://environment.data.gov.uk/flood-monitoring/id/floodAreas/${encodeURIComponent(id)}`;
const EA_PAGE = "https://check-for-flooding.service.gov.uk/";
const BBK_LIST_URL = (provider: string) =>
	`https://warnung.bund.de/api31/${provider}/mapData.json`;
const BBK_GEO_URL = (id: string) =>
	`https://warnung.bund.de/api31/warnings/${encodeURIComponent(id)}.geojson`;
const BBK_PAGE = "https://warnung.bund.de/meldungen";
// warnung.bund.de usually answers in <1 s but stalls now and then (5 s, and
// one >15 s abort in a live run, 2026-09-24) — shared by all five providers.
const BBK_TIMEOUT_MS = 30_000;
/** warnung.bund.de providers → our source name + title label. */
export const BBK_PROVIDERS = [
	{ provider: "mowas", source: "mowas", label: "MoWaS" },
	{ provider: "katwarn", source: "katwarn", label: "KATWARN" },
	{ provider: "biwapp", source: "biwapp", label: "BIWAPP" },
	{ provider: "lhp", source: "lhp-floods", label: "LHP flood" },
	{ provider: "police", source: "de-police", label: "Police" },
] as const;
type BbkProvider = (typeof BBK_PROVIDERS)[number];
// HKO open data "warnsum": `{}` when nothing is in force, else one entry per
// warning type keyed by type (WTCSGNL, WRAIN, WFIRE, …) with the active
// `code` (TC8NE, WRAINB, WFIRER, …). HK is one place: markers sit at the
// Observatory.
const HKO_WARN_URL =
	"https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en";
const HKO_PAGE = "https://www.hko.gov.hk/en/wxinfo/dailywx/wxwarntoday.htm";
const HKO_AT = { lat: 22.3022, lon: 114.1741 };
// JMA "r8" warnings (the 2026 revision; the old data/warning/*.json froze on
// 2026-05-28). map.json holds each forecast office's latest report per data
// type (VPWW55–61); an area's picture is the union of its active kinds
// across them. Sub-area polygons (class10s.json, 153 areas) give the marker.
const JMA_WARN_URL = "https://www.jma.go.jp/bosai/warning/data/r8/map.json";
const JMA_AREAS_URL =
	"https://www.jma.go.jp/bosai/common/const/geojson/class10s.json";
const JMA_PAGE = "https://www.jma.go.jp/bosai/warning/";
/** r8 kind codes → element + level, from the JMA warning page's own table:
 * 50 special warning, 40 danger warning (new in 2026), 30 warning,
 * 20 advisory. */
const JMA_KINDS: Record<string, [string, 20 | 30 | 40 | 50]> = {
	"02": ["snowstorm", 30],
	"03": ["heavy rain", 30],
	"05": ["storm", 30],
	"06": ["heavy snow", 30],
	"07": ["high waves", 30],
	"08": ["storm surge", 30],
	"09": ["landslide", 30],
	"10": ["heavy rain", 20],
	"12": ["heavy snow", 20],
	"13": ["snowstorm", 20],
	"14": ["thunderstorm", 20],
	"15": ["gale", 20],
	"16": ["high waves", 20],
	"17": ["snowmelt", 20],
	"19": ["storm surge", 20],
	"20": ["dense fog", 20],
	"21": ["dry air", 20],
	"22": ["avalanche", 20],
	"23": ["low temperature", 20],
	"24": ["frost", 20],
	"25": ["ice accretion", 20],
	"26": ["snow accretion", 20],
	"29": ["landslide", 20],
	"32": ["snowstorm", 50],
	"33": ["heavy rain", 50],
	"35": ["storm", 50],
	"36": ["heavy snow", 50],
	"37": ["high waves", 50],
	"38": ["storm surge", 50],
	"39": ["landslide", 50],
	"43": ["heavy rain", 40],
	"48": ["storm surge", 40],
	"49": ["landslide", 40],
};
const JMA_LEVEL_NAME = {
	20: "advisory",
	30: "warning",
	40: "danger warning",
	50: "special warning",
} as const;
/** Lifted (解除) and "none in force" (…なし) are the only inactive states. */
const jmaActive = (status?: string) =>
	!!status && status !== "解除" && !status.includes("なし");

/** Per-run cap on uncached area lookups — a flood crisis can raise hundreds
 * of warnings; the rest get located on later runs as the cache fills. */
const MAX_LOOKUPS_PER_RUN = 60;

type Sev = "critical" | "watch" | "info";
type Row = Parameters<typeof storeNormalized>[0];
type Feature = {
	id?: string;
	geometry?: unknown;
	properties?: Record<string, unknown>;
};

export function ecccSeverity(colour: string, type: string): Sev {
	const c = colour.toLowerCase();
	if (c === "red") return "critical";
	if (c === "orange" || type.toLowerCase() === "warning") return "watch";
	return "info";
}

/** EA levels: 1 severe flood warning, 2 flood warning, 3 flood alert,
 * 4 no longer in force (null → dropped). */
export function eaSeverity(level: number): Sev | null {
	if (level === 1) return "critical";
	if (level === 2) return "watch";
	if (level === 3) return "info";
	return null;
}

/** CAP severity as MoWaS publishes it. */
export function capSeverity(s: string): Sev {
	const l = s.toLowerCase();
	if (l === "extreme" || l === "severe") return "critical";
	if (l === "moderate") return "watch";
	return "info";
}

export function ecccRows(features: Feature[], now = Date.now()): Row[] {
	const rows: Row[] = [];
	for (const f of features) {
		const p = f.properties ?? {};
		const id = String(f.id ?? p.id ?? "");
		const at = pointOf(f.geometry);
		const expires = Date.parse(String(p.expiration_datetime ?? ""));
		if (!id || !at || (Number.isFinite(expires) && expires <= now)) continue;
		const name = String(p.alert_short_name_en ?? p.alert_name_en ?? "Alert");
		const region = String(p.feature_name_en ?? "");
		rows.push({
			id: `eccc:${id}`,
			ts: new Date(
				Date.parse(String(p.publication_datetime ?? "")) || now,
			).toISOString(),
			source: "eccc-alerts",
			layer: "weather",
			title: `ECCC · ${name} — ${region}${p.province ? `, ${p.province}` : ""}`,
			url: ECCC_PAGE,
			severity: ecccSeverity(
				String(p.risk_colour_en ?? ""),
				String(p.alert_type ?? ""),
			),
			confidence: 0.95,
			lat: at.lat,
			lon: at.lon,
			entities: { agency: "Environment Canada", province: p.province ?? null },
			meta: {
				alert_type: p.alert_type ?? null,
				risk_colour: p.risk_colour_en ?? null,
				expires: p.expiration_datetime ?? null,
				region,
			},
		});
	}
	return rows;
}

type EaFlood = {
	floodAreaID?: string;
	description?: string;
	eaAreaName?: string;
	message?: string;
	severity?: string;
	severityLevel?: number;
	timeRaised?: string;
	floodArea?: { county?: string; riverOrSea?: string };
};

export function eaRows(
	items: EaFlood[],
	areaAt: (id: string) => LonLat | null,
): Row[] {
	const rows: Row[] = [];
	for (const w of items) {
		const sev = eaSeverity(Number(w.severityLevel));
		if (!w.floodAreaID || !sev) continue;
		const at = areaAt(w.floodAreaID);
		rows.push({
			id: `ea-flood:${w.floodAreaID}`,
			ts: new Date(Date.parse(w.timeRaised ?? "") || Date.now()).toISOString(),
			source: "ea-floods",
			layer: "disasters",
			title: `EA · ${w.severity ?? "Flood warning"} — ${w.description ?? w.floodAreaID}`,
			body: (w.message ?? "").slice(0, 2000) || undefined,
			url: EA_PAGE,
			severity: sev,
			confidence: 0.95,
			lat: at?.lat,
			lon: at?.lon,
			entities: {
				agency: "Environment Agency",
				county: w.floodArea?.county ?? null,
			},
			meta: {
				flood: true,
				severity_level: w.severityLevel ?? null,
				river_or_sea: w.floodArea?.riverOrSea ?? null,
				ea_area: w.eaAreaName ?? null,
			},
		});
	}
	return rows;
}

type BbkWarning = {
	id?: string;
	version?: number;
	startDate?: string;
	severity?: string;
	type?: string;
	i18nTitle?: Record<string, string>;
};

export function bbkRows(
	p: BbkProvider,
	list: BbkWarning[],
	footprint: (id: string) => LonLat | null,
): Row[] {
	const rows: Row[] = [];
	for (const w of list) {
		// A Cancel message announces the end of a warning; it is not one.
		if (!w.id || w.type === "Cancel") continue;
		const en = w.i18nTitle?.en ?? "";
		const de = w.i18nTitle?.de ?? "";
		const at = footprint(w.id);
		rows.push({
			id: `${p.source}:${w.id}`,
			ts: new Date(Date.parse(w.startDate ?? "") || Date.now()).toISOString(),
			source: p.source,
			layer: "disasters",
			title: `${p.label} · ${en || de || "Warning"}`,
			body: de && de !== en ? de : undefined,
			url: BBK_PAGE,
			severity: capSeverity(w.severity ?? ""),
			confidence: 0.95,
			lat: at?.lat,
			lon: at?.lon,
			entities: { agency: `BBK (${p.label})` },
			meta: {
				cap_severity: w.severity ?? null,
				msg_type: w.type ?? null,
				version: w.version ?? null,
			},
		});
	}
	return rows;
}

/** HKO warning codes: No. 8+ typhoon signals, red/black rainstorm and
 * tsunami are the critical tier; No. 3, amber rain, landslip, northern NT
 * flooding and red fire danger are watch; the rest informational. */
export function hkoSeverity(code: string): Sev {
	const c = code.toUpperCase();
	if (/^TC(8|9|10)/.test(c) || c === "WRAINR" || c === "WRAINB" || c === "WTMW")
		return "critical";
	if (/^TC3/.test(c) || ["WRAINA", "WL", "WFNTSA", "WFIRER"].includes(c))
		return "watch";
	return "info";
}

type HkoWarning = {
	name?: string;
	code?: string;
	type?: string;
	actionCode?: string;
	issueTime?: string;
	updateTime?: string;
};

export function hkoRows(sum: Record<string, HkoWarning>): Row[] {
	const rows: Row[] = [];
	for (const [kind, w] of Object.entries(sum)) {
		if (!w || w.actionCode === "CANCEL") continue;
		const code = w.code ?? kind;
		rows.push({
			id: `hko:${kind}`,
			ts: new Date(
				Date.parse(w.updateTime ?? w.issueTime ?? "") || Date.now(),
			).toISOString(),
			source: "hko-warn",
			layer: "weather",
			title: `HKO · ${w.name ?? kind}${w.type ? ` (${w.type})` : ""} — ${code}`,
			url: HKO_PAGE,
			severity: hkoSeverity(code),
			confidence: 0.95,
			lat: HKO_AT.lat,
			lon: HKO_AT.lon,
			entities: { agency: "Hong Kong Observatory" },
			meta: { kind, code, action: w.actionCode ?? null },
		});
	}
	return rows;
}

export type JmaReport = {
	reportDatetime?: string;
	warning?: {
		class10Items?: {
			areaCode?: string;
			kinds?: { code?: string; status?: string }[];
		}[];
	};
};
export type JmaArea = { name: string; at: LonLat };

export const jmaSeverity = (level: number): Sev =>
	level >= 40 ? "critical" : level >= 30 ? "watch" : "info";

/** Latest reports → one row per sub-area with anything in force, at its
 * worst level; kinds listed worst first. Areas without geometry are kept
 * unplaced rather than dropped. */
export function jmaRows(
	reports: JmaReport[],
	areas: Map<string, JmaArea>,
): Row[] {
	const byArea = new Map<string, { kinds: Set<string>; at: string }>();
	for (const r of reports)
		for (const it of r.warning?.class10Items ?? []) {
			if (!it.areaCode) continue;
			for (const k of it.kinds ?? []) {
				if (!k.code || !JMA_KINDS[k.code] || !jmaActive(k.status)) continue;
				const a = byArea.get(it.areaCode) ?? { kinds: new Set(), at: "" };
				a.kinds.add(k.code);
				if ((r.reportDatetime ?? "") > a.at) a.at = r.reportDatetime ?? "";
				byArea.set(it.areaCode, a);
			}
		}
	const rows: Row[] = [];
	for (const [code, a] of byArea) {
		const kinds = [...a.kinds]
			.map((c) => JMA_KINDS[c])
			.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
		const level = kinds[0][1];
		const area = areas.get(code);
		rows.push({
			id: `jma:${code}`,
			ts: new Date(Date.parse(a.at) || Date.now()).toISOString(),
			source: "jma-warn",
			layer: "weather",
			title: `JMA · ${area?.name ?? code} — ${kinds
				.map(([el, lv]) => `${el} ${JMA_LEVEL_NAME[lv]}`)
				.join(", ")}`.slice(0, 300),
			url: JMA_PAGE,
			severity: jmaSeverity(level),
			confidence: 0.95,
			lat: area?.at.lat,
			lon: area?.at.lon,
			entities: { agency: "Japan Meteorological Agency" },
			meta: {
				area: code,
				level: JMA_LEVEL_NAME[level],
				kinds: [...a.kinds].sort(),
			},
		});
	}
	return rows;
}

/** class10s.json → area code → English name + marker. Ten codes repeat as
 * a separate island part (`islandBold`, no English name); the main feature
 * names and places the area. */
export function jmaAreas(geo: unknown): Map<string, JmaArea> {
	const out = new Map<string, JmaArea>();
	const feats = (geo as { features?: unknown[] } | null)?.features ?? [];
	for (const f of feats as {
		properties?: {
			code?: string;
			name?: string;
			enName?: string;
			islandBold?: boolean;
		};
		geometry?: unknown;
	}[]) {
		const code = f.properties?.code;
		const at = pointOf(f.geometry);
		if (!code || !at) continue;
		if (out.has(code) && f.properties?.islandBold) continue;
		out.set(code, {
			name: f.properties?.enName || f.properties?.name || code,
			at,
		});
	}
	return out;
}

// Area/footprint caches survive across runs (the worker is long-lived).
// null = looked up, has no usable geometry — don't ask again.
const eaAreas = new Map<string, LonLat | null>();
// Warning ids are unique across providers, so one footprint cache serves all.
const bbkFootprints = new Map<string, LonLat | null>();
// JMA sub-area polygons are static: fetched once per worker life.
let jmaAreaCache: Map<string, JmaArea> | null = null;

async function fetchJson(
	url: string,
	timeoutMs?: number,
): Promise<{ status: number; json: unknown }> {
	assertSafeUrl(url);
	const res = await stealthFetch(url, {}, timeoutMs);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return { status: res.status, json: await res.json() };
}

/** Fill `cache` for ids it lacks, up to the per-run cap. A failed lookup is
 * left uncached so the next run retries it. */
async function locate(
	ids: string[],
	cache: Map<string, LonLat | null>,
	lookup: (id: string) => Promise<LonLat | null>,
) {
	let budget = MAX_LOOKUPS_PER_RUN;
	for (const id of ids) {
		if (cache.has(id) || budget-- <= 0) continue;
		try {
			cache.set(id, await lookup(id));
		} catch {
			// retried next run
		}
	}
}

async function eaAreaLookup(id: string): Promise<LonLat | null> {
	const { json } = await fetchJson(EA_AREA_URL(id));
	const item = (json as { items?: { lat?: number; long?: number } })?.items;
	const lat = Number(item?.lat);
	const lon = Number(item?.long);
	return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

async function bbkLookup(id: string): Promise<LonLat | null> {
	const { json } = await fetchJson(BBK_GEO_URL(id), BBK_TIMEOUT_MS);
	const first = (json as { features?: Feature[] })?.features?.[0];
	return pointOf(first?.geometry);
}

function listOf<T>(j: unknown, key?: string): T[] {
	const v = key ? (j as Record<string, unknown> | null)?.[key] : j;
	if (!Array.isArray(v))
		throw new Error(`unexpected payload: no ${key ? `${key}[]` : "list"}`);
	return v as T[];
}

const SOURCES: Array<{
	source: string;
	layer: string;
	run: () => Promise<{ status: number; rows: Row[] }>;
}> = [
	{
		source: "eccc-alerts",
		layer: "weather",
		run: async () => {
			const { status, json } = await fetchJson(ECCC_URL, ECCC_TIMEOUT_MS);
			return { status, rows: ecccRows(listOf<Feature>(json, "features")) };
		},
	},
	{
		source: "ea-floods",
		layer: "disasters",
		run: async () => {
			const { status, json } = await fetchJson(EA_FLOODS_URL);
			const items = listOf<EaFlood>(json, "items");
			const ids = items
				.map((w) => w.floodAreaID)
				.filter((x): x is string => !!x);
			await locate(ids, eaAreas, eaAreaLookup);
			return { status, rows: eaRows(items, (id) => eaAreas.get(id) ?? null) };
		},
	},
	{
		source: "hko-warn",
		layer: "weather",
		run: async () => {
			const { status, json } = await fetchJson(HKO_WARN_URL);
			if (!json || typeof json !== "object" || Array.isArray(json))
				throw new Error("unexpected payload: not an object");
			return { status, rows: hkoRows(json as Record<string, HkoWarning>) };
		},
	},
	{
		source: "jma-warn",
		layer: "weather",
		run: async () => {
			const { status, json } = await fetchJson(JMA_WARN_URL);
			// Every forecast office always has a latest report; an empty or
			// non-list payload means the r8 path moved again.
			if (!Array.isArray(json) || !json.length)
				throw new Error("unexpected payload: no reports");
			if (!jmaAreaCache) {
				const geo = await fetchJson(JMA_AREAS_URL);
				const areas = jmaAreas(geo.json);
				if (!areas.size) throw new Error("no sub-area geometry");
				jmaAreaCache = areas;
			}
			return { status, rows: jmaRows(json as JmaReport[], jmaAreaCache) };
		},
	},
	...BBK_PROVIDERS.map((p) => ({
		source: p.source,
		layer: "disasters",
		run: async () => {
			const { status, json } = await fetchJson(
				BBK_LIST_URL(p.provider),
				BBK_TIMEOUT_MS,
			);
			const list = listOf<BbkWarning>(json);
			const ids = list
				.filter((w) => w.type !== "Cancel")
				.map((w) => w.id)
				.filter((x): x is string => !!x);
			await locate(ids, bbkFootprints, bbkLookup);
			return {
				status,
				rows: bbkRows(p, list, (id) => bbkFootprints.get(id) ?? null),
			};
		},
	})),
];

export async function collect() {
	let n = 0;
	const errors: string[] = [];
	for (const s of SOURCES) {
		try {
			const runStart = await dbClock();
			const { status, rows } = await s.run();
			await storeRaw(s.source, s.layer, status, { n: rows.length });
			for (const r of rows) await storeNormalized(r);
			// No warnings in force is the normal state, not an outage (these
			// sources are NEVER_FROZEN in api/freeze.ts for that reason).
			await pruneStale(s.source, runStart);
			n += rows.length;
			await markHealth(s.source, true);
		} catch (e: unknown) {
			errors.push(`${s.source}: ${errMsg(e)}`);
			await markHealth(s.source, false, errMsg(e));
		}
	}
	const ok = errors.length < SOURCES.length;
	return ok ? { ok, count: n } : { ok, error: errors.join("; ") };
}

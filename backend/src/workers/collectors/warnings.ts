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

// Area/footprint caches survive across runs (the worker is long-lived).
// null = looked up, has no usable geometry — don't ask again.
const eaAreas = new Map<string, LonLat | null>();
// Warning ids are unique across providers, so one footprint cache serves all.
const bbkFootprints = new Map<string, LonLat | null>();

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

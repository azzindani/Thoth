// USGS NWIS instant river gauges (keyless): streamflow + gage height at
// curated flood-prone stations → `oceans` layer. Provisional data, latest
// value per series; severity by flow percentile is downstream work — here,
// gage-height over flood stage (when published) is the watch trigger.
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

// [site, label] — major basins + flash-flood corridors. Static facts.
const SITES: [string, string][] = [
	["01491000", "Choptank River MD"],
	["03612500", "Ohio River KY"],
	["09380000", "Colorado River AZ"],
	["01646500", "Potomac DC"],
	["07374000", "Mississippi LA"],
	["08158000", "Rio Grande TX"],
	["12472800", "Spokane River WA"],
	["14211720", "Columbia River OR"],
];

const Series = z
	.object({
		name: z.string().optional(),
		sourceInfo: z
			.object({
				siteName: z.string().optional(),
				geoLocation: z
					.object({
						geogLocation: z
							.object({
								latitude: z.number().optional(),
								longitude: z.number().optional(),
							})
							.passthrough()
							.optional(),
					})
					.passthrough()
					.optional(),
			})
			.passthrough()
			.optional(),
		variable: z
			.object({
				variableName: z.string().optional(),
				variableCode: z
					.array(z.object({ value: z.string() }).passthrough())
					.optional(),
				unit: z
					.object({ unitCode: z.string().optional() })
					.passthrough()
					.optional(),
			})
			.passthrough()
			.optional(),
		values: z
			.array(
				z
					.object({
						value: z.array(
							z
								.object({
									value: z.string().optional(),
									dateTime: z.string().optional(),
								})
								.passthrough(),
						),
					})
					.passthrough(),
			)
			.optional(),
	})
	.passthrough();

export async function collect() {
	const source = "nwis";
	const layer = "oceans";
	try {
		const sites = SITES.map((s) => s[0]).join(",");
		const url =
			`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${sites}` +
			`&parameterCd=00060,00065&siteStatus=all`;
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as { value?: { timeSeries?: unknown[] } };
		const series = z.array(Series).parse(j.value?.timeSeries ?? []);
		await storeRaw(source, layer, res.status, { n: series.length });
		let n = 0;
		for (const s of series) {
			const code = s.variable?.variableCode?.[0]?.value;
			if (code !== "00060" && code !== "00065") continue;
			const vals = s.values?.[0]?.value ?? [];
			const last = vals[vals.length - 1];
			const v = Number(last?.value ?? NaN);
			if (!Number.isFinite(v) || !last?.dateTime) continue;
			const site = (s.name ?? "").split(":")[1] ?? "?";
			const label = SITES.find(([id]) => id === site)?.[1] ?? site;
			const geo = s.sourceInfo?.geoLocation?.geogLocation;
			const isFlow = code === "00060";
			const unit = isFlow ? "ft³/s" : "ft";
			await storeNormalized({
				id: `nwis:${site}:${code}:${last.dateTime.slice(0, 16)}`,
				ts: new Date(last.dateTime).toISOString(),
				source,
				layer,
				title: `${label}: ${isFlow ? "flow" : "stage"} ${v.toLocaleString("en-US")} ${unit}`,
				severity: "info",
				confidence: 0.85,
				lon: geo?.longitude,
				lat: geo?.latitude,
				entities: {},
				meta: {
					site,
					param: isFlow ? "flow" : "stage",
					value: v,
					unit: s.variable?.unit?.unitCode,
				},
			});
			n++;
		}
		await markHealth(source, true);
		const f = (await collectFlood()) + (await collectPegel());
		return { ok: true, count: n + f };
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		const f = (await collectFlood()) + (await collectPegel());
		if (f > 0) return { ok: true, count: f };
		return { ok: false, error: errMsg(e) };
	}
}

// Open-Meteo flood API (keyless, GloFAS): 7d river discharge at curated
// gauges — forecast leg next to NWIS observations. [label, lat, lon].
const FLOOD_PTS: [string, number, number][] = [
	["Rhone-Geneva", 46.2, 6.14],
	["Danube-Vienna", 48.21, 16.37],
	["Rhine-Cologne", 50.94, 6.96],
	["Po-Turin", 45.07, 7.69],
	["Mississippi-StLouis", 38.63, -90.2],
	["Ganges-Patna", 25.6, 85.14],
	["Tone-Tokyo", 35.68, 139.69],
	["Yodo-Osaka", 34.69, 135.5],
];

/** Each gauge is its own request: one stalled point (a >15 s abort,
 * 2026-09-24) used to throw out of the loop and fail all eight. Healthy while
 * any gauge reports; misses stay visible in the error text. */
async function collectFlood(): Promise<number> {
	let n = 0;
	const misses: string[] = [];
	for (const [label, lat, lon] of FLOOD_PTS) {
		try {
			const url =
				`https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}` +
				`&daily=river_discharge&past_days=7&forecast_days=3`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const j = (await res.json()) as {
				daily?: { time?: string[]; river_discharge?: (number | null)[] };
			};
			const times = j.daily?.time ?? [];
			const flows = j.daily?.river_discharge ?? [];
			const last = flows.filter((v) => typeof v === "number").slice(-1)[0];
			if (typeof last !== "number") continue;
			const day = times[flows.lastIndexOf(last)] ?? "";
			await storeNormalized({
				id: `omflood:${label.toLowerCase().replace(/[^a-z]+/g, "-")}:${day}`,
				ts: day ? `${day}T00:00:00Z` : new Date().toISOString(),
				source: "om-flood",
				layer: "oceans",
				title: `${label} discharge ${Math.round(last)} m³/s`,
				severity: last >= 5000 ? "watch" : "info",
				confidence: 0.8,
				lon,
				lat,
				entities: {},
				meta: { discharge: last, day },
			});
			n++;
		} catch (e: unknown) {
			misses.push(`${label}: ${errMsg(e)}`);
		}
	}
	await storeRaw("om-flood", "oceans", 200, { n, misses: misses.length });
	const ok = n > 0 || misses.length === 0;
	await markHealth(
		"om-flood",
		ok,
		misses.length
			? `${n}/${FLOOD_PTS.length} points; misses: ${misses.join("; ").slice(0, 300)}`
			: undefined,
	);
	return n;
}

// Pegelonline (WSV, keyless, DL-DE/Zero): every German federal waterway gauge
// with its level state against mean low/high water (MNW/MHW) and the highest
// navigable level (HSW). Stored: fixed reference gauges on the big rivers
// every run (freshness), plus any gauge currently above MHW (watch) or HSW
// (critical, shipping stops) — pruned once it drops back.
const PEGEL_URL =
	"https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?includeTimeseries=true&includeCurrentMeasurement=true&timeseries=W";
/** The public gauge page is keyed by gauge number (a uuid answers 404). */
const PEGEL_PAGE = (number: string) =>
	`https://pegelonline.wsv.de/gast/stammdaten?pegelnr=${encodeURIComponent(number)}`;
/** Rhine (Kaub = the shipping bellwether), Elbe, Oder, Danube. */
export const PEGEL_REFERENCE = new Set([
	"KÖLN",
	"KAUB",
	"MAXAU",
	"DRESDEN",
	"MAGDEBURG-STROMBRÜCKE",
	"FRANKFURT1 (ODER)",
	"PASSAU DONAU",
	"HOFKIRCHEN",
]);
const PEGEL_STATE_LABEL: Record<string, string> = {
	low: "below mean low water",
	normal: "normal",
	high: "above mean high water",
};

type PegelStation = {
	uuid?: string;
	number?: string;
	shortname?: string;
	latitude?: number;
	longitude?: number;
	water?: { shortname?: string };
	timeseries?: {
		unit?: string;
		currentMeasurement?: {
			timestamp?: string;
			value?: number;
			stateMnwMhw?: string;
			stateNswHsw?: string;
		};
	}[];
};

export function pegelRows(stations: PegelStation[]) {
	const rows: Parameters<typeof storeNormalized>[0][] = [];
	for (const st of stations) {
		const m = st.timeseries?.[0]?.currentMeasurement;
		const lat = Number(st.latitude);
		const lon = Number(st.longitude);
		if (!st.uuid || !st.shortname || typeof m?.value !== "number") continue;
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		const aboveHsw = m.stateNswHsw === "high";
		const aboveMhw = m.stateMnwMhw === "high";
		if (!aboveHsw && !aboveMhw && !PEGEL_REFERENCE.has(st.shortname)) continue;
		const water = st.water?.shortname ?? "";
		const state = aboveHsw
			? "above highest navigable water"
			: (PEGEL_STATE_LABEL[m.stateMnwMhw ?? ""] ?? "state unknown");
		rows.push({
			id: `pegel:${st.uuid}`,
			ts: new Date(Date.parse(m.timestamp ?? "") || Date.now()).toISOString(),
			source: "pegelonline",
			layer: "oceans",
			title: `${st.shortname} (${water}) ${m.value} ${st.timeseries?.[0]?.unit ?? "cm"} — ${state}`,
			url: st.number ? PEGEL_PAGE(st.number) : "https://pegelonline.wsv.de/",
			severity: aboveHsw ? "critical" : aboveMhw ? "watch" : "info",
			confidence: 0.95,
			lat,
			lon,
			entities: { water },
			meta: {
				level_cm: m.value,
				state_mnw_mhw: m.stateMnwMhw ?? null,
				state_nsw_hsw: m.stateNswHsw ?? null,
				reference: PEGEL_REFERENCE.has(st.shortname),
			},
		});
	}
	return rows;
}

async function collectPegel(): Promise<number> {
	try {
		assertSafeUrl(PEGEL_URL);
		const runStart = await dbClock();
		const res = await stealthFetch(PEGEL_URL, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j: unknown = await res.json();
		if (!Array.isArray(j)) throw new Error("unexpected payload: not a list");
		const rows = pegelRows(j as PegelStation[]);
		// No reference gauge found = the payload changed, not a quiet river.
		if (!rows.some((r) => r.meta?.reference))
			throw new Error("no reference gauge in payload");
		await storeRaw("pegelonline", "oceans", res.status, {
			stations: j.length,
			n: rows.length,
		});
		for (const r of rows) await storeNormalized(r);
		await pruneStale("pegelonline", runStart);
		await markHealth("pegelonline", true);
		return rows.length;
	} catch (e: unknown) {
		await markHealth("pegelonline", false, errMsg(e));
		return 0;
	}
}

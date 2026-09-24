import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";
import { parseRSS } from "./news.js";

// NWS active alerts, keyless authoritative US feed (GeoJSON). Global severe weather stays on EONET.
// MET Norway MetAlerts 2.0, keyless European alerts (requires identifying User-Agent).
const URL = "https://api.weather.gov/alerts/active?status=actual";
const METALERTS_URL =
	"https://api.met.no/weatherapi/metalerts/2.0/current.json";
// MeteoAlarm legacy ATOM per-country feeds (EUMETNET, CC BY 4.0, keyless):
// the new EDR data API needs auth (401), but the maintained Atom feeds
// carry the same warnings. Empty feed = quiet skies, not an outage.
const METALARM_FEEDS = [
	"germany",
	"france",
	"poland",
	"spain",
	"italy",
	"romania",
	"united-kingdom",
	"ukraine",
] as const;

export function metalarmSeverity(title: string): "critical" | "watch" | "info" {
	// Titles carry the color word ("Red Wind Warning", "Orange ...").
	if (/\bred\b/i.test(title)) return "critical";
	if (/\borange\b/i.test(title)) return "watch";
	return "info";
}

const Feature = z.object({
	id: z.string(),
	properties: z.object({
		event: z.string().optional(),
		headline: z.string().nullable().optional(),
		severity: z.string().nullable().optional(),
		certainty: z.string().nullable().optional(),
		sent: z.string().optional(),
	}),
	geometry: z
		.object({ type: z.string(), coordinates: z.unknown() })
		.nullable()
		.optional(),
});

function numOf(d: Record<string, unknown>, k: string): number | null {
	const v = d[k];
	return typeof v === "number" ? v : null;
}
function tempOf(d: Record<string, unknown>): string {
	const t = numOf(d, "air_temperature");
	return t === null ? "?" : `${Math.round(t)}°C`;
}
function windOf(d: Record<string, unknown>): string {
	const w = numOf(d, "wind_speed");
	return w === null ? "?" : `${Math.round(w)}m/s`;
}
function precipOf(d: Record<string, unknown>): string {
	const p = numOf(d, "precipitation_amount");
	return p === null ? "?" : `${p}mm`;
}

export function centroid(g: unknown): { lon: number; lat: number } | null {
	try {
		const flat: Array<[number, number]> = [];
		const walk = (c: unknown): void => {
			if (
				Array.isArray(c) &&
				typeof c[0] === "number" &&
				typeof c[1] === "number"
			) {
				flat.push([c[0], c[1]]);
			} else if (Array.isArray(c)) {
				c.forEach(walk);
			}
		};
		walk((g as { coordinates?: unknown } | null)?.coordinates);
		if (!flat.length) return null;
		let x = 0;
		let y = 0;
		for (const [lon, lat] of flat) {
			x += lon;
			y += lat;
		}
		return { lon: x / flat.length, lat: y / flat.length };
	} catch {
		return null;
	}
}

export async function collect() {
	const layer = "weather";
	let n = 0;
	const errors: string[] = [];
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL, {
			headers: { Accept: "application/geo+json" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { features?: unknown };
		const feats = z.array(Feature).parse(json.features ?? []);
		await storeRaw("nws", layer, res.status, { n: feats.length });
		for (const f of feats.slice(0, 200)) {
			const g = f.geometry ? centroid(f.geometry) : null;
			const sev = (f.properties.severity ?? "").toLowerCase();
			await storeNormalized({
				id: `nws:${createHash("md5").update(f.id).digest("hex")}`,
				ts: f.properties.sent ?? new Date().toISOString(),
				source: "nws",
				layer,
				title: f.properties.headline ?? f.properties.event ?? "Weather alert",
				severity:
					sev === "extreme" || sev === "severe"
						? "critical"
						: sev === "moderate"
							? "watch"
							: "info",
				confidence: 0.95,
				lon: g?.lon,
				lat: g?.lat,
				entities: {},
				meta: { event: f.properties.event, certainty: f.properties.certainty },
			});
			n++;
		}
		await markHealth("nws", true);
	} catch (e: unknown) {
		errors.push(`nws: ${errMsg(e)}`);
		await markHealth("nws", false, errors[errors.length - 1]);
	}
	// MET Norway MetAlerts: European severe-weather alerts (CAP-flavoured
	// GeoJSON: no top-level id, properties carry title/event/severity, time in
	// when.interval). Best-effort second upstream — NWS alone still yields ok:true.
	try {
		assertSafeUrl(METALERTS_URL);
		const res = await stealthFetch(METALERTS_URL, {
			headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { features?: unknown };
		const MetAlert = z.object({
			properties: z.object({
				title: z.string().optional(),
				event: z.string().optional(),
				severity: z.string().nullable().optional(),
				certainty: z.string().nullable().optional(),
			}),
			when: z.object({ interval: z.array(z.string()).optional() }).optional(),
			geometry: z
				.object({ type: z.string(), coordinates: z.unknown() })
				.nullable()
				.optional(),
		});
		const feats = z.array(MetAlert).parse(json.features ?? []);
		await storeRaw("metalerts", layer, res.status, { n: feats.length });
		for (const f of feats.slice(0, 100)) {
			const g = f.geometry ? centroid(f.geometry) : null;
			const sev = (f.properties.severity ?? "").toLowerCase();
			await storeNormalized({
				id: `met:${createHash("md5")
					.update(
						f.properties.title ??
							f.properties.event ??
							Math.random().toString(),
					)
					.digest("hex")}`,
				ts: f.when?.interval?.[0] ?? new Date().toISOString(),
				source: "metalerts",
				layer,
				title: f.properties.title ?? f.properties.event ?? "Weather alert",
				severity:
					sev === "extreme" || sev === "severe"
						? "critical"
						: sev === "moderate"
							? "watch"
							: "info",
				confidence: 0.9,
				lon: g?.lon,
				lat: g?.lat,
				entities: {},
				meta: { event: f.properties.event, certainty: f.properties.certainty },
			});
			n++;
		}
		await markHealth("metalerts", true);
	} catch (e: unknown) {
		errors.push(`metalerts: ${errMsg(e)}`);
		await markHealth("metalerts", false, errors[errors.length - 1]);
	}
	// MET Norway forecast extras (same keyless host/UA as MetAlerts): Oslo
	// nowcast (90-min radar-ECMWF blend) + ocean + sunrise + air-quality.
	try {
		const base = "https://api.met.no/weatherapi";
		const ua = { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" };
		// Nowcast: current hour detail row.
		const nc = await stealthFetch(
			`${base}/nowcast/2.0/complete?lat=59.9&lon=10.7`,
			{ headers: ua },
		);
		if (nc.ok) {
			const j = (await nc.json()) as {
				properties?: {
					timeseries?: {
						time?: string;
						data?: { instant?: { details?: Record<string, unknown> } };
					}[];
				};
			};
			const row = j.properties?.timeseries?.[0];
			const d = row?.data?.instant?.details ?? {};
			await storeRaw("metnow", layer, nc.status, { t: row?.time });
			await storeNormalized({
				id: `metnow:${(row?.time ?? "").slice(0, 16)}`,
				ts: row?.time ?? new Date().toISOString(),
				source: "metnow",
				layer,
				title: `Oslo now ${tempOf(d)} · wind ${windOf(d)} · precip ${precipOf(d)}`,
				severity: "info",
				confidence: 0.85,
				lon: 10.7,
				lat: 59.9,
				entities: {},
				meta: { details: d },
			});
			n++;
		}
		if (nc.ok) await markHealth("metnow", true);
		else await markHealth("metnow", false, `nowcast HTTP ${nc.status}`);
	} catch (e: unknown) {
		errors.push(`metnow: ${errMsg(e)}`);
		await markHealth("metnow", false, errors[errors.length - 1]);
	}
	// NWS gridpoints 7-day (extends the alerts feed already polled): NYC office.
	try {
		const url = "https://api.weather.gov/gridpoints/OKX/33,37/forecast";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {
			headers: { Accept: "application/geo+json" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			properties?: {
				periods?: {
					name?: string;
					startTime?: string;
					temperature?: number;
					temperatureUnit?: string;
					shortForecast?: string;
				}[];
			};
		};
		const periods = j.properties?.periods ?? [];
		await storeRaw("nws-fx", layer, res.status, { n: periods.length });
		for (const p of periods.slice(0, 7)) {
			await storeNormalized({
				id: `nwsfx:${(p.startTime ?? p.name ?? "").slice(0, 16)}`,
				ts: p.startTime ?? new Date().toISOString(),
				source: "nws-fx",
				layer,
				title:
					`NYC ${p.name ?? ""}: ${p.shortForecast ?? "?"} ${p.temperature ?? "?"}°${p.temperatureUnit ?? "F"}`.slice(
						0,
						300,
					),
				severity: "info",
				confidence: 0.9,
				lon: -74.0,
				lat: 40.7,
				entities: {},
				meta: { period: p.name, temp: p.temperature },
			});
			n++;
		}
		await markHealth("nws-fx", true);
	} catch (e: unknown) {
		errors.push(`nws-fx: ${errMsg(e)}`);
		await markHealth("nws-fx", false, errors[errors.length - 1]);
	}
	// HKO 9-day (Hong Kong Observatory, keyless): CJK-region second opinion.
	try {
		const url =
			"https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=en";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			weatherForecast?: {
				forecastDate?: string;
				week?: string;
				forecastWeather?: string;
				forecastMaxtemp?: { value?: number };
				forecastMintemp?: { value?: number };
			}[];
		};
		const days = j.weatherForecast ?? [];
		await storeRaw("hko", layer, res.status, { n: days.length });
		for (const d of days.slice(0, 4)) {
			const fd = d.forecastDate ?? "";
			const iso =
				fd.length === 8
					? `${fd.slice(0, 4)}-${fd.slice(4, 6)}-${fd.slice(6, 8)}T00:00:00Z`
					: new Date().toISOString();
			await storeNormalized({
				id: `hko:${fd}`,
				ts: iso,
				source: "hko",
				layer,
				title:
					`Hong Kong ${d.week ?? fd}: ${d.forecastWeather ?? "?"} ${d.forecastMintemp?.value ?? "?"}/${d.forecastMaxtemp?.value ?? "?"}°C`.slice(
						0,
						300,
					),
				severity: (d.forecastMaxtemp?.value ?? 0) >= 35 ? "watch" : "info",
				confidence: 0.9,
				lon: 114.17,
				lat: 22.32,
				entities: {},
				meta: {
					tmax: d.forecastMaxtemp?.value,
					tmin: d.forecastMintemp?.value,
				},
			});
			n++;
		}
		await markHealth("hko", true);
	} catch (e: unknown) {
		errors.push(`hko: ${errMsg(e)}`);
		await markHealth("hko", false, errors[errors.length - 1]);
	}
	// MET Norway ocean forecast (Oslo fjord point): wave height/temp/speed.
	try {
		const url =
			"https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=59.9&lon=10.7";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {
			headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			properties?: {
				timeseries?: {
					time?: string;
					data?: { instant?: { details?: Record<string, number> } };
				}[];
			};
		};
		const row = j.properties?.timeseries?.[0];
		const d = row?.data?.instant?.details ?? {};
		const wv = d.sea_surface_wave_height;
		await storeRaw("metocean", layer, res.status, { t: row?.time });
		if (typeof wv === "number") {
			await storeNormalized({
				id: `metocean:${(row?.time ?? "").slice(0, 16)}`,
				ts: row?.time ?? new Date().toISOString(),
				source: "metocean",
				layer,
				title: `Oslo fjord seas ${Math.round(wv * 10) / 10}m · water ${typeof d.sea_water_temperature === "number" ? Math.round(d.sea_water_temperature) : "?"}°C`,
				severity: wv >= 4 ? "watch" : "info",
				confidence: 0.85,
				lon: 10.7,
				lat: 59.9,
				entities: {},
				meta: { wave: wv, waterTemp: d.sea_water_temperature ?? null },
			});
			n++;
		}
		await markHealth("metocean", true);
	} catch (e: unknown) {
		errors.push(`metocean: ${errMsg(e)}`);
		await markHealth("metocean", false, errors[errors.length - 1]);
	}
	// MET Norway ocean North Sea points (open water, not fjord): wave
	// height + water temp rows — offshore-seas leg next to metocean.
	for (const [name, la, lo] of [
		["NorthSea", 60.0, 2.0],
		["NorwegianSea", 64.0, 0.0],
	] as const) {
		try {
			const url = `https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=${la}&lon=${lo}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url, {
				headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} ${name}`);
			const j = (await res.json()) as {
				properties?: {
					timeseries?: {
						time?: string;
						data?: { instant?: { details?: Record<string, number> } };
					}[];
				};
			};
			const row = j.properties?.timeseries?.[0];
			const d = row?.data?.instant?.details ?? {};
			const wv = d.sea_surface_wave_height;
			await storeRaw("metocean-ns", layer, res.status, {
				pt: name,
				t: row?.time,
			});
			if (typeof wv === "number" && row?.time) {
				await storeNormalized({
					id: `metoceanns:${name.toLowerCase()}:${row.time.slice(0, 16)}`,
					ts: row.time,
					source: "metocean-ns",
					layer,
					title: `${name} seas ${Math.round(wv * 10) / 10}m · water ${typeof d.sea_water_temperature === "number" ? Math.round(d.sea_water_temperature) : "?"}°C`,
					severity: wv >= 4 ? "watch" : "info",
					confidence: 0.85,
					lon: lo,
					lat: la,
					entities: {},
					meta: { wave: wv, waterTemp: d.sea_water_temperature ?? null },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`metoceanns/${name}: ${errMsg(e)}`);
		}
	}
	const metoceannsOk = !errors.some((e) => e.startsWith("metoceanns/"));
	await markHealth(
		"metocean-ns",
		metoceannsOk,
		metoceannsOk ? undefined : errors.join("; "),
	);
	// MET Norway sunrise (Oslo): daylight bounds for the ops clock.
	try {
		const today = new Date().toISOString().slice(0, 10);
		const url = `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=59.9&lon=10.7&date=${today}&offset=+01:00`;
		assertSafeUrl(url);
		const res = await stealthFetch(url, {
			headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			properties?: {
				sunrise?: { time?: string };
				sunset?: { time?: string };
			};
		};
		const sr = j.properties?.sunrise?.time ?? "?";
		const ss = j.properties?.sunset?.time ?? "?";
		await storeRaw("metsun", layer, res.status, { sr, ss });
		await storeNormalized({
			id: `metsun:${new Date().toISOString().slice(0, 10)}`,
			ts: new Date().toISOString(),
			source: "metsun",
			layer,
			title: `Oslo daylight ${sr.slice(11, 16)}→${ss.slice(11, 16)}`,
			severity: "info",
			confidence: 0.9,
			lon: 10.7,
			lat: 59.9,
			entities: {},
			meta: { sunrise: sr, sunset: ss },
		});
		n++;
		await markHealth("metsun", true);
	} catch (e: unknown) {
		errors.push(`metsun: ${errMsg(e)}`);
		await markHealth("metsun", false, errors[errors.length - 1]);
	}
	// sunrise-sunset.org (keyless): Kyiv + Warsaw + Berlin + Istanbul
	// daylight bounds — the theater-town leg next to Oslo metsun (MET
	// Norway covers only its own grid well; this API is global).
	for (const [name, la, lo] of [
		["Kyiv", 50.45, 30.52],
		["Warsaw", 52.23, 21.01],
		["Berlin", 52.52, 13.41],
		["Istanbul", 41.01, 28.98],
	] as const) {
		try {
			const today = new Date().toISOString().slice(0, 10);
			const url = `https://api.sunrise-sunset.org/json?lat=${la}&lng=${lo}&formatted=0&date=${today}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${name}`);
			const j = (await res.json()) as {
				results?: {
					sunrise?: string;
					sunset?: string;
					day_length?: number;
				};
			};
			const sr = j.results?.sunrise ?? "";
			const ss = j.results?.sunset ?? "";
			if (!sr || !ss) throw new Error(`no times ${name}`);
			await storeRaw("sunsched", layer, res.status, { city: name });
			await storeNormalized({
				id: `sunsched:${name.toLowerCase()}:${today}`,
				ts: new Date().toISOString(),
				source: "sunsched",
				layer,
				title: `${name} daylight ${sr.slice(11, 16)}→${ss.slice(11, 16)} (${Math.round((j.results?.day_length ?? 0) / 360) / 10}h)`,
				severity: "info",
				confidence: 0.85,
				lon: lo,
				lat: la,
				entities: {},
				meta: {
					sunrise: sr,
					sunset: ss,
					dayLength: j.results?.day_length ?? null,
				},
			});
			n++;
		} catch (e: unknown) {
			errors.push(`sunsched/${name}: ${errMsg(e)}`);
		}
	}
	const sunschedOk = !errors.some((e) => e.startsWith("sunsched/"));
	await markHealth(
		"sunsched",
		sunschedOk,
		sunschedOk ? undefined : errors.join("; "),
	);
	// MeteoAlarm country atoms: one feed per country, graceful each.
	let metalarmOk = 0;
	const metalarmErrs: string[] = [];
	for (const cc of METALARM_FEEDS) {
		try {
			const url = `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${cc}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const items = parseRSS(await res.text(), 25);
			await storeRaw("metalarm", layer, res.status, { cc, n: items.length });
			for (const a of items) {
				const ts = Date.parse(a.pubDate);
				await storeNormalized({
					id: `metalarm:${cc}:${createHash("md5").update(a.link).digest("hex")}`,
					ts: Number.isNaN(ts)
						? new Date().toISOString()
						: new Date(ts).toISOString(),
					source: "metalarm",
					layer,
					title: a.title.slice(0, 300),
					url: a.link,
					severity: metalarmSeverity(a.title),
					confidence: 0.9,
					entities: {},
					meta: { country: cc },
				});
				n++;
			}
			metalarmOk++;
		} catch (e: unknown) {
			metalarmErrs.push(`${cc}: ${errMsg(e)}`);
		}
	}
	if (metalarmOk > 0) await markHealth("metalarm", true);
	else await markHealth("metalarm", false, metalarmErrs.join("; "));
	if (metalarmErrs.length) errors.push(`metalarm: ${metalarmErrs.join("; ")}`);
	// YR locationforecast (MET Norway, global grid): 6h slices for 3 cities —
	// temp/wind/symbol rows. Same UA contract as metalerts.
	for (const [name, la, lo] of [
		["Oslo", 59.9, 10.7],
		["Kyiv", 50.45, 30.52],
		["Tokyo", 35.68, 139.65],
	] as const) {
		try {
			const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${la}&lon=${lo}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url, {
				headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} ${name}`);
			const j = (await res.json()) as {
				properties?: {
					timeseries?: {
						time?: string;
						data?: {
							instant?: { details?: Record<string, number> };
							next_1_hours?: { summary?: { symbol_code?: string } };
						};
					}[];
				};
			};
			const series = j.properties?.timeseries ?? [];
			await storeRaw("yr-forecast", layer, res.status, { city: name });
			for (const row of series.filter((_, i) => i % 6 === 0).slice(0, 4)) {
				const d = row.data?.instant?.details ?? {};
				const t = d.air_temperature;
				if (typeof t !== "number" || !row.time) continue;
				const sym = row.data?.next_1_hours?.summary?.symbol_code ?? "?";
				await storeNormalized({
					id: `yr:${name.toLowerCase()}:${row.time.slice(0, 13)}`,
					ts: row.time,
					source: "yr-forecast",
					layer,
					title: `${name} ${Math.round(t)}°C ${sym} wind ${Math.round(d.wind_speed ?? 0)}m/s (YR)`,
					severity: t >= 35 || t <= -20 ? "watch" : "info",
					confidence: 0.85,
					lon: lo,
					lat: la,
					entities: {},
					meta: { temp: t, wind: d.wind_speed ?? null, symbol: sym },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`yr/${name}: ${errMsg(e)}`);
		}
	}
	const yrOk = !errors.some((e) => e.startsWith("yr/"));
	await markHealth("yr-forecast", yrOk, yrOk ? undefined : errors.join("; "));
	// MET Norway nowcast (radar now + ~2h, Oslo/Bergen/Trondheim): precip
	// rate + 1h/6h sums — the now leg next to locationforecast's 6h slices.
	for (const [name, la, lo] of [
		["Oslo", 59.9, 10.7],
		["Bergen", 60.39, 5.32],
		["Trondheim", 63.43, 10.39],
	] as const) {
		try {
			const url = `https://api.met.no/weatherapi/nowcast/2.0/complete?lat=${la}&lon=${lo}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url, {
				headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} ${name}`);
			const j = (await res.json()) as {
				properties?: {
					timeseries?: {
						time?: string;
						data?: {
							instant?: { details?: { precipitation_rate?: number } };
							next_1_hours?: { details?: { precipitation_amount?: number } };
							next_6_hours?: { details?: { precipitation_amount?: number } };
						};
					}[];
				};
			};
			const series = j.properties?.timeseries ?? [];
			await storeRaw("yr-nowcast", layer, res.status, { city: name });
			const row = series[0];
			const rate = row?.data?.instant?.details?.precipitation_rate;
			if (row?.time && typeof rate === "number") {
				const p1 = row.data?.next_1_hours?.details?.precipitation_amount;
				const p6 = row.data?.next_6_hours?.details?.precipitation_amount;
				await storeNormalized({
					id: `yrnow:${name.toLowerCase()}:${row.time.slice(0, 16)}`,
					ts: row.time,
					source: "yr-nowcast",
					layer,
					title: `${name} now: ${rate}mm/h (1h ${p1 ?? "?"}mm, 6h ${p6 ?? "?"}mm)`,
					severity: rate >= 5 ? "watch" : "info",
					confidence: 0.85,
					lon: lo,
					lat: la,
					entities: {},
					meta: { rate, p1h: p1 ?? null, p6h: p6 ?? null },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`yrnow/${name}: ${errMsg(e)}`);
		}
	}
	const yrnowOk = !errors.some((e) => e.startsWith("yrnow/"));
	await markHealth(
		"yr-nowcast",
		yrnowOk,
		yrnowOk ? undefined : errors.join("; "),
	);
	// NWS station obs (US airports, keyless GeoJSON): latest temp/wind/vis.
	for (const st of ["KJFK", "KMIA", "KLAX"] as const) {
		try {
			const url = `https://api.weather.gov/stations/${st}/observations/latest`;
			assertSafeUrl(url);
			const res = await stealthFetch(url, {
				headers: { Accept: "application/geo+json" },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} ${st}`);
			const j = (await res.json()) as {
				geometry?: { coordinates?: number[] };
				properties?: {
					timestamp?: string;
					textDescription?: string;
					temperature?: { value?: number | null };
					windSpeed?: { value?: number | null };
					visibility?: { value?: number | null };
				};
			};
			const p = j.properties ?? {};
			const t = p.temperature?.value;
			if (typeof t !== "number") throw new Error("no temp");
			const coords = j.geometry?.coordinates;
			await storeRaw("nws-obs", layer, res.status, { st });
			await storeNormalized({
				id: `nwsobs:${st}:${(p.timestamp ?? "").slice(0, 16)}`,
				ts: p.timestamp ?? new Date().toISOString(),
				source: "nws-obs",
				layer,
				title:
					`${st} ${Math.round(t)}°C ${p.textDescription || ""} wind ${p.windSpeed?.value != null ? Math.round(p.windSpeed.value) : "?"}km/h`.slice(
						0,
						280,
					),
				severity: "info",
				confidence: 0.9,
				lon: Array.isArray(coords) ? coords[0] : undefined,
				lat: Array.isArray(coords) ? coords[1] : undefined,
				entities: {},
				meta: { station: st, temp: t, vis: p.visibility?.value ?? null },
			});
			n++;
		} catch (e: unknown) {
			errors.push(`nwsobs/${st}: ${errMsg(e)}`);
		}
	}
	const nwsObsOk = !errors.some((e) => e.startsWith("nwsobs/"));
	await markHealth(
		"nws-obs",
		nwsObsOk,
		nwsObsOk ? undefined : errors.join("; "),
	);
	// FMI Helsinki obs (WFS simple features, keyless XML): latest t2m/wind/rh.
	try {
		const now = new Date();
		const start = new Date(now.getTime() - 3 * 3600e3)
			.toISOString()
			.slice(0, 19);
		const end = now.toISOString().slice(0, 19);
		const url =
			`https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature` +
			`&storedquery_id=fmi::observations::weather::simple&place=Helsinki` +
			`&starttime=${start}Z&endtime=${end}Z&timestep=60`;
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const xml = await res.text();
		const byTime = new Map<string, Map<string, number>>();
		for (const m of xml.matchAll(/<wfs:member>([\s\S]*?)<\/wfs:member>/g)) {
			const b = m[1];
			const t = b.match(/<BsWfs:Time>([^<]+)<\/BsWfs:Time>/)?.[1] ?? "";
			const k =
				b.match(/<BsWfs:ParameterName>([^<]+)<\/BsWfs:ParameterName>/)?.[1] ??
				"";
			const v = Number(
				b.match(/<BsWfs:ParameterValue>([^<]+)<\/BsWfs:ParameterValue>/)?.[1] ??
					NaN,
			);
			if (!t || !k || !Number.isFinite(v)) continue;
			if (!byTime.has(t)) byTime.set(t, new Map());
			byTime.get(t)?.set(k, v);
		}
		const latest = [...byTime.keys()].sort().slice(-1)[0];
		await storeRaw("fmi", layer, res.status, { n: byTime.size });
		const row = latest ? byTime.get(latest) : undefined;
		const t2m = row?.get("t2m");
		if (latest && typeof t2m === "number") {
			await storeNormalized({
				id: `fmi:helsinki:${latest.slice(0, 16)}`,
				ts: latest,
				source: "fmi",
				layer,
				title: `Helsinki ${Math.round(t2m)}°C wind ${Math.round(row?.get("ws_10min") ?? 0)}m/s rh ${Math.round(row?.get("rh") ?? 0)}% (FMI)`,
				severity: t2m <= -20 ? "watch" : "info",
				confidence: 0.85,
				lon: 24.94,
				lat: 60.17,
				entities: {},
				meta: { temp: t2m, wind: row?.get("ws_10min") ?? null },
			});
			n++;
		}
		await markHealth("fmi", true);
	} catch (e: unknown) {
		errors.push(`fmi: ${errMsg(e)}`);
		await markHealth("fmi", false, errors[errors.length - 1]);
	}
	// DWD warnings (JSONP, keyless): strip wrapper, per-region rows, cap 40.
	try {
		const url = "https://www.dwd.de/DWD/warnungen/warnapp/json/warnings.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const raw = (await res.text()).trim();
		const json = raw
			.replace(/^warnWetter\.loadWarnings\(/, "")
			.replace(/\);?\s*$/, "");
		const j = JSON.parse(json) as {
			warnings?: Record<
				string,
				{
					regionName?: string;
					event?: string;
					headline?: string;
					level?: number;
					start?: number;
					end?: number;
					description?: string;
				}[]
			>;
		};
		const entries = Object.entries(j.warnings ?? {});
		await storeRaw("dwd-warn", layer, res.status, { regions: entries.length });
		let m = 0;
		for (const [region, arr] of entries) {
			for (const w of arr.slice(0, 3)) {
				const lvl = w.level ?? 0;
				await storeNormalized({
					id: `dwd:${region}:${(w.event ?? "?").replace(/\s+/g, "")}`,
					ts: w.start
						? new Date(w.start).toISOString()
						: new Date().toISOString(),
					source: "dwd-warn",
					layer,
					title:
						`DWD L${lvl} ${w.event ?? "?"} — ${w.regionName ?? region}`.slice(
							0,
							300,
						),
					body: (w.headline ?? w.description ?? "").slice(0, 300) || undefined,
					severity: lvl >= 4 ? "critical" : lvl >= 2 ? "watch" : "info",
					confidence: 0.9,
					entities: {},
					meta: { region, level: lvl, event: w.event },
				});
				n++;
				if (++m >= 40) break;
			}
			if (m >= 40) break;
		}
		await markHealth("dwd-warn", true);
	} catch (e: unknown) {
		errors.push(`dwd-warn: ${errMsg(e)}`);
		await markHealth("dwd-warn", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

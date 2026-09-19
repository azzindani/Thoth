// City forecasts + coastal sea state via Open-Meteo (keyless, CC BY 4.0)
// + IPMA Portugal daily (cities carry their own lat/lon) + open-notify
// ISS-now (second live ISS fix next to wheretheiss). Complements `weather`
// (alerts polygons) with plain conditions + the marine complement
// `airquality` lacks. 3h poll; one batched request per product.

import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// [name, lat, lon, marine?] — hubs + theater-adjacent coasts. Static facts.
const CITIES: [string, number, number, boolean][] = [
	["London", 51.5074, -0.1278, true],
	["Paris", 48.8566, 2.3522, false],
	["Berlin", 52.52, 13.405, false],
	["Madrid", 40.4168, -3.7038, false],
	["Kyiv", 50.45, 30.523, false],
	["Warsaw", 52.2297, 21.0122, false],
	["Istanbul", 41.0082, 28.9784, true],
	["Moscow", 55.7558, 37.6173, false],
	["Cairo", 30.0444, 31.2357, true],
	["Lagos", 6.5244, 3.3792, true],
	["Tehran", 35.6892, 51.389, false],
	["Delhi", 28.6139, 77.209, false],
	["Mumbai", 19.076, 72.8777, true],
	["Beijing", 39.9042, 116.4074, false],
	["Shanghai", 31.2304, 121.4737, true],
	["Tokyo", 35.6762, 139.6503, true],
	["Seoul", 37.5665, 126.978, true],
	["Jakarta", -6.2088, 106.8456, true],
	["Singapore", 1.3521, 103.8198, true],
	["Sydney", -33.8688, 151.2093, true],
	["Sao Paulo", -23.5558, -46.6396, true],
	["Mexico City", 19.4326, -99.1332, false],
	["New York", 40.7128, -74.006, true],
	["Los Angeles", 34.0522, -118.2437, true],
	["Taipei", 25.033, 121.5654, true],
	["Manila", 14.5995, 120.9842, true],
	["Hanoi", 21.0285, 105.8542, false],
	["Riyadh", 24.7136, 46.6753, false],
	["Nairobi", -1.2921, 36.8219, false],
	["Lima", -12.0464, -77.0428, true],
	["Bogota", 4.711, -74.0721, false],
	["Anchorage", 61.2181, -149.9003, true],
	["Sapporo", 43.0618, 141.3545, false],
];

export function heatSeverity(
	tmax: number | undefined,
	windMax: number | undefined,
): "info" | "watch" | "critical" {
	if ((tmax ?? -99) >= 40 || (windMax ?? 0) >= 90) return "critical";
	if ((tmax ?? -99) >= 35 || (windMax ?? 0) >= 60) return "watch";
	return "info";
}

export function seaSeverity(
	wave: number | undefined,
): "info" | "watch" | "critical" {
	if ((wave ?? 0) >= 6) return "critical";
	if ((wave ?? 0) >= 4) return "watch";
	return "info";
}

interface FxRow {
	latitude?: number;
	longitude?: number;
	current?: {
		temperature_2m?: number;
		wind_speed_10m?: number;
		weather_code?: number;
	};
	daily?: {
		temperature_2m_max?: number[];
		temperature_2m_min?: number[];
		precipitation_probability_max?: number[];
		wind_speed_10m_max?: number[];
	};
}

interface MarineRow {
	latitude?: number;
	longitude?: number;
	current?: {
		wave_height?: number;
		wave_direction?: number;
		wave_period?: number;
		ocean_current_velocity?: number;
	};
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export async function collect() {
	const layer = "forecast";
	let n = 0;
	const errors: string[] = [];

	try {
		const lat = CITIES.map((c) => c[1]).join(",");
		const lon = CITIES.map((c) => c[2]).join(",");
		const url =
			`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
			`&current=temperature_2m,wind_speed_10m,weather_code` +
			`&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
			`&forecast_days=2&timezone=auto`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as unknown;
		const rows: FxRow[] = Array.isArray(json) ? json : [json as FxRow];
		await storeRaw("openmeteo-fx", layer, res.status, { n: rows.length });
		const now = new Date().toISOString();
		for (let i = 0; i < CITIES.length && i < rows.length; i++) {
			const [name, clat, clon] = CITIES[i];
			const t = rows[i]?.current?.temperature_2m;
			if (typeof t !== "number") continue;
			const tmax = rows[i]?.daily?.temperature_2m_max?.[0];
			const tmin = rows[i]?.daily?.temperature_2m_min?.[0];
			const pp = rows[i]?.daily?.precipitation_probability_max?.[0];
			const wmax = rows[i]?.daily?.wind_speed_10m_max?.[0];
			await storeNormalized({
				id: `omfx:${slug(name)}`,
				ts: now,
				source: "openmeteo-fx",
				layer,
				title: `${name} ${Math.round(t)}°C wind ${Math.round(rows[i]?.current?.wind_speed_10m ?? 0)}km/h`,
				severity: heatSeverity(tmax, wmax),
				confidence: 0.85,
				lon: clon,
				lat: clat,
				entities: {},
				meta: {
					temp: Math.round(t * 10) / 10,
					tmax: tmax ?? null,
					tmin: tmin ?? null,
					precipProb: pp ?? null,
					windMax: wmax ?? null,
					wmo: rows[i]?.current?.weather_code ?? null,
				},
			});
			n++;
		}
		await markHealth("openmeteo-fx", true);
	} catch (e: unknown) {
		errors.push(`openmeteo-fx: ${errMsg(e)}`);
		await markHealth("openmeteo-fx", false, errors[errors.length - 1]);
	}

	try {
		const sea = CITIES.filter((c) => c[3]);
		const lat = sea.map((c) => c[1]).join(",");
		const lon = sea.map((c) => c[2]).join(",");
		const url =
			`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
			`&current=wave_height,wave_direction,wave_period,ocean_current_velocity&forecast_days=1`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as unknown;
		const rows: MarineRow[] = Array.isArray(json) ? json : [json as MarineRow];
		await storeRaw("openmeteo-marine", layer, res.status, {
			n: rows.length,
		});
		const now = new Date().toISOString();
		for (let i = 0; i < sea.length && i < rows.length; i++) {
			const [name, clat, clon] = sea[i];
			const wv = rows[i]?.current?.wave_height;
			if (typeof wv !== "number") continue;
			await storeNormalized({
				id: `ommarine:${slug(name)}`,
				ts: now,
				source: "openmeteo-marine",
				layer,
				title: `Seas off ${name} ${Math.round(wv * 10) / 10}m`,
				severity: seaSeverity(wv),
				confidence: 0.8,
				lon: clon,
				lat: clat,
				entities: {},
				meta: {
					wave: Math.round(wv * 100) / 100,
					waveDir: rows[i]?.current?.wave_direction ?? null,
					wavePeriod: rows[i]?.current?.wave_period ?? null,
					current: rows[i]?.current?.ocean_current_velocity ?? null,
				},
			});
			n++;
		}
		await markHealth("openmeteo-marine", true);
	} catch (e: unknown) {
		errors.push(`openmeteo-marine: ${errMsg(e)}`);
		await markHealth("openmeteo-marine", false, errors[errors.length - 1]);
	}

	// BrightSky current weather (DWD MOSMIX, keyless): Berlin + Munich +
	// Hamburg point obs — German-model second opinion next to Open-Meteo.
	for (const [name, clat, clon] of [
		["Berlin", 52.52, 13.41],
		["Munich", 48.137, 11.575],
		["Hamburg", 53.55, 9.99],
	] as const) {
		try {
			const url = `https://api.brightsky.dev/current_weather?lat=${clat}&lon=${clon}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${name}`);
			const j = (await res.json()) as {
				weather?: {
					timestamp?: string;
					temperature?: number;
					wind_speed_10?: number;
					condition?: string;
					relative_humidity?: number;
				};
			};
			const w = j.weather;
			if (typeof w?.temperature !== "number") throw new Error("no temp");
			await storeRaw("brightsky", layer, res.status, { city: name });
			await storeNormalized({
				id: `brightsky:${slug(name)}:${(w.timestamp ?? "").slice(0, 13)}`,
				ts: w.timestamp ?? new Date().toISOString(),
				source: "brightsky",
				layer,
				title:
					`${name} ${Math.round(w.temperature)}°C ${w.condition ?? ""} wind ${Math.round(w.wind_speed_10 ?? 0)}km/h (DWD)`.slice(
						0,
						280,
					),
				severity: w.temperature >= 35 ? "watch" : "info",
				confidence: 0.85,
				lon: clon,
				lat: clat,
				entities: {},
				meta: {
					temp: w.temperature,
					wind: w.wind_speed_10 ?? null,
					rh: w.relative_humidity ?? null,
				},
			});
			n++;
		} catch (e: unknown) {
			errors.push(`brightsky/${name}: ${errMsg(e)}`);
		}
	}
	const brightOk = !errors.some((e) => e.startsWith("brightsky/"));
	await markHealth(
		"brightsky",
		brightOk,
		brightOk ? undefined : errors.join("; "),
	);

	// BOM Australia daily (short-geohash locations, keyless): Sydney +
	// Melbourne + Perth + Brisbane 7-day max/min + rain chance.
	for (const [name, hash] of [
		["Sydney", "r3gx2n9"],
		["Melbourne", "r1r0fup"],
		["Perth", "qd66hrm"],
		["Brisbane", "r7hg3vg"],
	] as const) {
		try {
			const url = `https://api.weather.bom.gov.au/v1/locations/${hash}/forecasts/daily`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${name}`);
			const j = (await res.json()) as {
				data?: {
					date?: string;
					temp_max?: number;
					temp_min?: number;
					rain?: { chance?: number };
					extended_text?: string;
				}[];
			};
			const days = j.data ?? [];
			await storeRaw("bom", layer, res.status, { city: name, n: days.length });
			for (const d of days.slice(0, 3)) {
				if (typeof d.temp_max !== "number") continue;
				await storeNormalized({
					id: `bom:${slug(name)}:${(d.date ?? "").slice(0, 10)}`,
					ts: d.date ?? new Date().toISOString(),
					source: "bom",
					layer,
					title:
						`${name} ${d.temp_min ?? "?"}/${d.temp_max}°C rain ${d.rain?.chance ?? "?"}% — ${(d.extended_text ?? "").slice(0, 120)}`.slice(
							0,
							280,
						),
					severity: d.temp_max >= 40 ? "watch" : "info",
					confidence: 0.85,
					entities: {},
					meta: {
						tmax: d.temp_max,
						tmin: d.temp_min,
						rainChance: d.rain?.chance ?? null,
					},
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`bom/${name}: ${errMsg(e)}`);
		}
	}
	const bomOk = !errors.some((e) => e.startsWith("bom/"));
	await markHealth("bom", bomOk, bomOk ? undefined : errors.join("; "));

	// NASA POWER daily point (London): satellite-era temp/wind/solar history.
	try {
		const url =
			"https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,WS2M,ALLSKY_SFC_SW_DWN&community=RE&longitude=-0.12&latitude=51.5&start=20260910&end=20260915&format=JSON";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			properties?: {
				parameter?: Record<string, Record<string, number>>;
			};
		};
		const t2m = j.properties?.parameter?.T2M ?? {};
		const days = Object.keys(t2m).filter((d) => t2m[d] !== -999);
		await storeRaw("nasa-power", layer, res.status, { n: days.length });
		const last = days.sort().slice(-1)[0];
		if (last) {
			const t = t2m[last] ?? 0;
			const ws = j.properties?.parameter?.WS2M?.[last] ?? null;
			await storeNormalized({
				id: `nasapower:london:${last}`,
				ts: `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}T12:00:00Z`,
				source: "nasa-power",
				layer,
				title: `London NASA-POWER ${last.slice(4, 6)}/${last.slice(6, 8)}: ${Math.round(t)}°C wind ${ws !== null && ws !== -999 ? Math.round(ws) : "?"}m/s`,
				severity: t >= 35 ? "watch" : "info",
				confidence: 0.8,
				lon: -0.12,
				lat: 51.5,
				entities: {},
				meta: { temp: t, wind: ws },
			});
			n++;
		}
		await markHealth("nasa-power", true);
	} catch (e: unknown) {
		errors.push(`nasa-power: ${errMsg(e)}`);
		await markHealth("nasa-power", false, errors[errors.length - 1]);
	}

	// IPMA Portugal daily (keyless, lat/lon in-row): Lisbon + Porto +
	// Faro day-0 max/min + rain chance.
	for (const [name, gid] of [
		["Lisbon", "1110600"],
		["Porto", "1131200"],
		["Faro", "1080500"],
	] as const) {
		try {
			const url = `https://api.ipma.pt/open-data/forecast/meteorology/cities/daily/${gid}.json`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${name}`);
			const j = (await res.json()) as {
				data?: {
					forecastDate?: string;
					tMin?: string;
					tMax?: string;
					precipitaProb?: string;
					predWindDir?: string;
					latitude?: string;
					longitude?: string;
				}[];
			};
			const days = j.data ?? [];
			await storeRaw("ipma", layer, res.status, { city: name, n: days.length });
			const d = days[0];
			const tmax = Number(d?.tMax ?? NaN);
			if (d && Number.isFinite(tmax)) {
				const lat = Number(d.latitude ?? NaN);
				const lon = Number(d.longitude ?? NaN);
				await storeNormalized({
					id: `ipma:${slug(name)}:${(d.forecastDate ?? "").slice(0, 10)}`,
					ts: d.forecastDate ?? new Date().toISOString(),
					source: "ipma",
					layer,
					title:
						`${name} ${d.tMin ?? "?"}/${d.tMax}°C rain ${d.precipitaProb ?? "?"}% wind ${d.predWindDir ?? "?"}`.slice(
							0,
							280,
						),
					severity: tmax >= 40 ? "watch" : "info",
					confidence: 0.85,
					lon: Number.isFinite(lon) ? lon : undefined,
					lat: Number.isFinite(lat) ? lat : undefined,
					entities: {},
					meta: { tmax, tmin: d.tMin, rainChance: d.precipitaProb },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`ipma/${name}: ${errMsg(e)}`);
		}
	}
	const ipmaOk = !errors.some((e) => e.startsWith("ipma/"));
	await markHealth("ipma", ipmaOk, ipmaOk ? undefined : errors.join("; "));

	// open-notify ISS-now (keyless): second live ISS fix next to
	// wheretheiss.at in the satellites collector (different provider).
	try {
		const url = "http://api.open-notify.org/iss-now.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			iss_position?: { latitude?: string; longitude?: string };
			timestamp?: number;
			message?: string;
		};
		const lat = Number(j.iss_position?.latitude ?? NaN);
		const lon = Number(j.iss_position?.longitude ?? NaN);
		if (!Number.isFinite(lat) || !Number.isFinite(lon))
			throw new Error("no fix");
		await storeRaw("iss-now", layer, res.status, { lat, lon });
		await storeNormalized({
			id: `issnow:${j.timestamp ?? Date.now()}`,
			ts:
				typeof j.timestamp === "number"
					? new Date(j.timestamp * 1000).toISOString()
					: new Date().toISOString(),
			source: "iss-now",
			layer,
			title: `ISS (open-notify) — ${lat.toFixed(1)}°,${lon.toFixed(1)}°`,
			severity: "info",
			confidence: 0.85,
			lon,
			lat,
			entities: {},
			meta: { norad: "25544" },
		});
		n++;
		await markHealth("iss-now", true);
	} catch (e: unknown) {
		errors.push(`iss-now: ${errMsg(e)}`);
		await markHealth("iss-now", false, errors[errors.length - 1]);
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

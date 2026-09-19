// City air quality via Open-Meteo (keyless, hourly CAMS model). One batched
// request for ~28 world cities → `airquality` layer, severity by US AQI band.

import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// [name, country, lat, lon] — stable facts, documented constants.
const CITIES: [string, string, number, number][] = [
	["London", "UK", 51.5074, -0.1278],
	["Paris", "France", 48.8566, 2.3522],
	["Berlin", "Germany", 52.52, 13.405],
	["Madrid", "Spain", 40.4168, -3.7038],
	["Rome", "Italy", 41.9028, 12.4964],
	["Kyiv", "Ukraine", 50.45, 30.523],
	["Warsaw", "Poland", 52.2297, 21.0122],
	["Istanbul", "Turkey", 41.0082, 28.9784],
	["Moscow", "Russia", 55.7558, 37.6173],
	["Cairo", "Egypt", 30.0444, 31.2357],
	["Lagos", "Nigeria", 6.5244, 3.3792],
	["Nairobi", "Kenya", -1.2921, 36.8219],
	["Johannesburg", "South Africa", -26.2041, 28.0473],
	["Dubai", "UAE", 25.2048, 55.2708],
	["Tehran", "Iran", 35.6892, 51.389],
	["Delhi", "India", 28.6139, 77.209],
	["Mumbai", "India", 19.076, 72.8777],
	["Dhaka", "Bangladesh", 23.8103, 90.4125],
	["Beijing", "China", 39.9042, 116.4074],
	["Shanghai", "China", 31.2304, 121.4737],
	["Tokyo", "Japan", 35.6762, 139.6503],
	["Seoul", "South Korea", 37.5665, 126.978],
	["Jakarta", "Indonesia", -6.2088, 106.8456],
	["Bangkok", "Thailand", 13.7563, 100.5018],
	["Singapore", "Singapore", 1.3521, 103.8198],
	["Sydney", "Australia", -33.8688, 151.2093],
	["Sao Paulo", "Brazil", -23.5558, -46.6396],
	["Mexico City", "Mexico", 19.4326, -99.1332],
	["New York", "USA", 40.7128, -74.006],
	["Los Angeles", "USA", 34.0522, -118.2437],
];

export function aqiSeverity(aqi: number): "info" | "watch" | "critical" {
	if (aqi > 200) return "critical";
	if (aqi > 100) return "watch";
	return "info";
}

interface AqRow {
	current?: { us_aqi?: number; pm2_5?: number; time?: string };
}

export async function collect() {
	const source = "open-meteo";
	const layer = "airquality";
	try {
		const lat = CITIES.map((c) => c[2]).join(",");
		const lon = CITIES.map((c) => c[3]).join(",");
		const url =
			`https://air-quality-api.open-meteo.com/v1/air-quality` +
			`?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5&forecast_days=1`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as unknown;
		const rows: AqRow[] = Array.isArray(json) ? json : [json as AqRow];
		await storeRaw(source, layer, res.status, { n: rows.length });
		let n = 0;
		for (let i = 0; i < CITIES.length && i < rows.length; i++) {
			const aqi = rows[i]?.current?.us_aqi;
			if (typeof aqi !== "number") continue;
			const [name, country, clat, clon] = CITIES[i];
			const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			await storeNormalized({
				id: `aq:${slug}`,
				ts: new Date().toISOString(),
				source,
				layer,
				title: `${name} AQI ${Math.round(aqi)}`,
				severity: aqiSeverity(aqi),
				confidence: 0.85,
				lon: clon,
				lat: clat,
				entities: {},
				meta: {
					aqi: Math.round(aqi),
					pm25: rows[i]?.current?.pm2_5 ?? null,
					country,
				},
			});
			n++;
		}
		await markHealth(source, true);
		const extra = await collectLuft();
		const psi = await collectSgPsi();
		return { ok: true, count: n + extra + psi };
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		const extra = (await collectLuft()) + (await collectSgPsi());
		if (extra > 0) return { ok: true, count: extra };
		return { ok: false, error: errMsg(e) };
	}
}

// Sensor.Community Luftdaten (keyless): citizen temp/humidity/pressure sample
// around Munich — ground-truth complement to the CAMS model grid.
async function collectLuft(): Promise<number> {
	try {
		const url =
			"https://data.sensor.community/airrohr/v1/filter/area=48.1,11.5,50";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			id?: number;
			timestamp?: string;
			location?: { latitude?: string; longitude?: string };
			sensordatavalues?: { value?: string; value_type?: string }[];
		}[];
		await storeRaw("luftdaten", "airquality", res.status, { n: rows.length });
		let n = 0;
		for (const s of rows.slice(0, 20)) {
			const vals = new Map(
				(s.sensordatavalues ?? []).map((v) => [v.value_type, Number(v.value)]),
			);
			const t = vals.get("temperature");
			if (!Number.isFinite(t)) continue;
			const lat = Number(s.location?.latitude ?? NaN);
			const lon = Number(s.location?.longitude ?? NaN);
			await storeNormalized({
				id: `luft:${s.id ?? `${lat},${lon}`}`,
				ts: s.timestamp
					? `${s.timestamp.replace(" ", "T")}Z`
					: new Date().toISOString(),
				source: "luftdaten",
				layer: "airquality",
				title:
					`Luftdaten sensor ${Math.round(t as number)}°C rh ${Math.round(vals.get("humidity") ?? 0)}%`.slice(
						0,
						280,
					),
				severity: "info",
				confidence: 0.7,
				lon: Number.isFinite(lon) ? lon : undefined,
				lat: Number.isFinite(lat) ? lat : undefined,
				entities: {},
				meta: { temp: t, sensor: s.id ?? null },
			});
			n++;
		}
		await markHealth("luftdaten", true);
		return n;
	} catch (e: unknown) {
		await markHealth("luftdaten", false, errMsg(e));
		return 0;
	}
}

// Singapore PSI (NEA data.gov.sg, keyless): 5-region sub-index readings +
// region centroids (region_metadata carries lat/lon) — SE-Asia haze leg.
export async function collectSgPsi(): Promise<number> {
	const layer = "airquality";
	try {
		const url = "https://api.data.gov.sg/v1/environment/psi";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			region_metadata?: {
				name?: string;
				label_location?: { latitude?: number; longitude?: number };
			}[];
			items?: {
				timestamp?: string;
				update_timestamp?: string;
				readings?: { psi_twenty_four_hourly?: Record<string, number> };
			}[];
		};
		const item = (j.items ?? [])[0];
		const psi = item?.readings?.psi_twenty_four_hourly ?? {};
		const regions = j.region_metadata ?? [];
		await storeRaw("sg-psi", layer, res.status, {
			n: Object.keys(psi).length,
		});
		let n = 0;
		for (const r of regions) {
			const name = r.name ?? "?";
			const v = psi[name];
			if (typeof v !== "number") continue;
			const lat = r.label_location?.latitude;
			const lon = r.label_location?.longitude;
			await storeNormalized({
				id: `sgpsi:${name}:${(item?.timestamp ?? "").slice(0, 13)}`,
				ts: item?.timestamp ?? new Date().toISOString(),
				source: "sg-psi",
				layer,
				title: `Singapore PSI ${name}: ${v} (${v > 100 ? "unhealthy" : v > 50 ? "moderate" : "good"})`,
				severity: aqiSeverity(v),
				confidence: 0.85,
				lon: typeof lon === "number" ? lon : undefined,
				lat: typeof lat === "number" ? lat : undefined,
				entities: {},
				meta: { region: name, psi: v },
			});
			n++;
		}
		await markHealth("sg-psi", true);
		return n;
	} catch (e: unknown) {
		await markHealth("sg-psi", false, errMsg(e));
		return 0;
	}
}

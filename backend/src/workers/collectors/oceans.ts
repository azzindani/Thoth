import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// NOAA NDBC latest obs: global buoys, fixed text table, keyless.
// Columns: STN LAT LON YYYY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE
const URL = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt";
// NOAA CO-OPS tide gauges: US coastal water levels, keyless JSON.
// Major hurricane/storm-surge exposed stations (MDAPI-verified IDs) +
// batch58 second ring (Providence, Springmaid Pier, Pilots Station, San
// Diego, Astoria, Seattle, Nawiliwili — all probe-verified 2026-09-17 with
// 241 obs each; 9759114 answers 400 and stays out).
const COOPS_STATIONS = [
	{ id: "8720218", name: "Mayport FL" },
	{ id: "8761724", name: "Grand Isle LA" },
	{ id: "8534720", name: "Atlantic City NJ" },
	{ id: "8443970", name: "Boston MA" },
	{ id: "9414290", name: "San Francisco CA" },
	{ id: "1612340", name: "Honolulu HI" },
	{ id: "9751364", name: "Christiansted VI" },
	{ id: "8545240", name: "Philadelphia PA" },
	{ id: "8454000", name: "Providence RI" },
	{ id: "8661070", name: "Springmaid Pier SC" },
	{ id: "8760922", name: "Pilots Station LA" },
	{ id: "9410170", name: "San Diego CA" },
	{ id: "9439040", name: "Astoria OR" },
	{ id: "9447130", name: "Seattle WA" },
	{ id: "1611400", name: "Nawiliwili HI" },
] as const;

export interface Buoy {
	stn: string;
	lat: number;
	lon: number;
	ts: string;
	wspd: number | null;
	wvht: number | null;
	atmp: number | null;
	wtmp: number | null;
}

function num(s: string | undefined): number | null {
	if (s === undefined || s === "MM") return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

export function parseLatestObs(text: string, cap = 150): Buoy[] {
	const out: Buoy[] = [];
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		const c = t.split(/\s+/);
		if (c.length < 19) continue;
		const lat = num(c[1]);
		const lon = num(c[2]);
		if (lat === null || lon === null) continue;
		const ts = Date.parse(`${c[3]}-${c[4]}-${c[5]}T${c[6]}:${c[7]}:00Z`);
		out.push({
			stn: c[0],
			lat,
			lon,
			ts: Number.isNaN(ts)
				? new Date().toISOString()
				: new Date(ts).toISOString(),
			wspd: num(c[9]),
			wvht: num(c[11]),
			atmp: num(c[17]),
			wtmp: num(c[18]),
		});
		if (out.length >= cap) break;
	}
	return out;
}

export async function collect() {
	const source = "ndbc";
	const layer = "oceans";
	let n = 0;
	const errors: string[] = [];
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const buoys = parseLatestObs(await res.text());
		await storeRaw(source, layer, res.status, { n: buoys.length });
		for (const b of buoys) {
			const rough =
				(b.wvht !== null && b.wvht >= 6) || (b.wspd !== null && b.wspd >= 20);
			await storeNormalized({
				id: `ndbc:${b.stn}`,
				ts: b.ts,
				source,
				layer,
				title: `buoy ${b.stn} — waves ${b.wvht ?? "?"}m · wind ${b.wspd ?? "?"}m/s`,
				severity: rough ? "watch" : "info",
				confidence: 0.95,
				lon: b.lon,
				lat: b.lat,
				entities: {},
				meta: {
					stn: b.stn,
					wspd: b.wspd,
					wvht: b.wvht,
					atmp: b.atmp,
					wtmp: b.wtmp,
				},
			});
			n++;
		}
		await markHealth(source, true);
	} catch (e: unknown) {
		errors.push(`ndbc: ${errMsg(e)}`);
		await markHealth(source, false, errors[errors.length - 1]);
	}
	// CO-OPS tide gauges: latest observed water level per station (last 6h
	// window, take newest). No datum anomaly math in v0 — raw level + station
	// context; surge interpretation lives in the brief/dossier, not here.
	try {
		const end = new Date();
		const begin = new Date(end.getTime() - 6 * 3600e3);
		const fmt = (d: Date) =>
			`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}%20${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
		let m = 0;
		for (const st of COOPS_STATIONS) {
			const u = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&application=Thoth&begin_date=${fmt(begin)}&end_date=${fmt(end)}&station=${st.id}&datum=MSL&time_zone=gmt&units=metric&format=json`;
			assertSafeUrl(u);
			const res = await stealthFetch(u);
			if (!res.ok) throw new Error(`CO-OPS ${st.id}: HTTP ${res.status}`);
			const j = (await res.json()) as {
				data?: { t?: string; v?: string; s?: string }[];
				metadata?: { lat?: string; lon?: string };
			};
			const rows = Array.isArray(j.data) ? j.data : [];
			const last = rows[rows.length - 1];
			if (!last?.v) continue;
			const lat = Number(j.metadata?.lat);
			const lon = Number(j.metadata?.lon);
			await storeNormalized({
				id: `coops:${st.id}`,
				ts: last.t
					? `${last.t}:00Z`.replace(" ", "T")
					: new Date().toISOString(),
				source: "coops",
				layer,
				title: `tide ${st.name} — water level ${last.v}m`,
				severity: "info",
				confidence: 0.95,
				lon: Number.isFinite(lon) ? lon : undefined,
				lat: Number.isFinite(lat) ? lat : undefined,
				entities: {},
				meta: { stn: st.id, station: st.name, level_m: last.v, sigma: last.s },
			});
			m++;
		}
		await storeRaw("coops", layer, 200, { n: m });
		await markHealth("coops", true);
		n += m;
	} catch (e: unknown) {
		errors.push(`coops: ${errMsg(e)}`);
		await markHealth("coops", false, errors[errors.length - 1]);
	}
	// CO-OPS water temperature (same datagetter, product=water_temperature):
	// thermal leg next to water levels — The Battery + SF + Mayport.
	for (const st of [
		{ id: "8518750", name: "The Battery NY" },
		{ id: "8720218", name: "Mayport FL" },
		{ id: "8534720", name: "Atlantic City NJ" },
	] as const) {
		try {
			const u = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=${st.id}&product=water_temperature&units=metric&time_zone=gmt&format=json`;
			assertSafeUrl(u);
			const res = await stealthFetch(u);
			if (!res.ok) throw new Error(`CO-OPS-temp ${st.id}: HTTP ${res.status}`);
			const j = (await res.json()) as {
				data?: { t?: string; v?: string }[];
				metadata?: { lat?: string; lon?: string };
			};
			const row = (j.data ?? [])[0];
			const t = Number(row?.v ?? NaN);
			if (!row?.v || !Number.isFinite(t)) throw new Error(`no temp ${st.id}`);
			await storeRaw("coops-temp", layer, res.status, { stn: st.id });
			const lat = Number(j.metadata?.lat);
			const lon = Number(j.metadata?.lon);
			await storeNormalized({
				id: `coopstemp:${st.id}:${(row.t ?? "").slice(0, 10)}`,
				ts: row.t ? `${row.t}:00Z`.replace(" ", "T") : new Date().toISOString(),
				source: "coops-temp",
				layer,
				title: `water temp ${st.name} — ${t}°C`,
				severity: t >= 30 ? "watch" : "info",
				confidence: 0.95,
				lon: Number.isFinite(lon) ? lon : undefined,
				lat: Number.isFinite(lat) ? lat : undefined,
				entities: {},
				meta: { stn: st.id, station: st.name, temp_c: t },
			});
			n++;
		} catch (e: unknown) {
			errors.push(`coopstemp/${st.id}: ${errMsg(e)}`);
		}
	}
	const coopstempOk = !errors.some((e) => e.startsWith("coopstemp/"));
	await markHealth(
		"coops-temp",
		coopstempOk,
		coopstempOk ? undefined : errors.join("; "),
	);
	// CO-OPS wind (same datagetter, product=wind): storm-context leg next
	// to water levels + temperature. Only met-equipped stations offer it
	// (Mayport/Grand Isle/SF/Honolulu/St Croix live; Atlantic City/Boston/
	// Philly answer "No data" and honestly skip).
	for (const st of COOPS_STATIONS) {
		try {
			const u = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=${st.id}&product=wind&units=metric&time_zone=gmt&format=json`;
			assertSafeUrl(u);
			const res = await stealthFetch(u);
			if (!res.ok) throw new Error(`CO-OPS-wind ${st.id}: HTTP ${res.status}`);
			const j = (await res.json()) as {
				data?: { t?: string; s?: string; dr?: string; g?: string }[];
				metadata?: { lat?: string; lon?: string };
			};
			const row = (j.data ?? [])[0];
			const spd = Number(row?.s ?? NaN);
			if (!row?.s || !Number.isFinite(spd)) throw new Error(`no wind ${st.id}`);
			await storeRaw("coops-wind", layer, res.status, { stn: st.id });
			const lat = Number(j.metadata?.lat);
			const lon = Number(j.metadata?.lon);
			const gust = Number(row.g ?? NaN);
			const peak = Number.isFinite(gust) ? gust : spd;
			await storeNormalized({
				id: `coopswind:${st.id}:${(row.t ?? "").slice(0, 10)}`,
				ts: row.t ? `${row.t}:00Z`.replace(" ", "T") : new Date().toISOString(),
				source: "coops-wind",
				layer,
				title: `wind ${st.name} — ${row.dr ?? "?"} ${spd} m/s${Number.isFinite(gust) ? ` gust ${gust}` : ""}`,
				severity: peak >= 25 ? "watch" : "info",
				confidence: 0.95,
				lon: Number.isFinite(lon) ? lon : undefined,
				lat: Number.isFinite(lat) ? lat : undefined,
				entities: {},
				meta: {
					stn: st.id,
					station: st.name,
					wind_ms: spd,
					gust_ms: Number.isFinite(gust) ? gust : null,
					dir: row.dr ?? null,
				},
			});
			n++;
		} catch (e: unknown) {
			errors.push(`coopswind/${st.id}: ${errMsg(e)}`);
		}
	}
	// Wind is sparse-by-design (met-less stations answer "No data" and
	// honestly skip) — green when ≥1 station reports, skips kept as notes.
	const windSkips = errors.filter((e) => e.startsWith("coopswind/"));
	for (const s of windSkips) errors.splice(errors.indexOf(s), 1);
	const windHits = COOPS_STATIONS.length - windSkips.length;
	const coopswindOk = windHits >= 1;
	errors.push(
		...windSkips.map((s) => s.replace("coopswind/", "coopswind-skip/")),
	);
	await markHealth(
		"coops-wind",
		coopswindOk,
		coopswindOk
			? `${windHits}/${COOPS_STATIONS.length} stations; skips: ${windSkips.join("; ").slice(0, 300)}`
			: errors.join("; "),
	);
	// CO-OPS air pressure (same datagetter, product=air_pressure, hPa):
	// barometer leg next to wind — offered at all 8 surge stations.
	for (const st of COOPS_STATIONS) {
		try {
			const u = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=${st.id}&product=air_pressure&units=metric&time_zone=gmt&format=json`;
			assertSafeUrl(u);
			const res = await stealthFetch(u);
			if (!res.ok)
				throw new Error(`CO-OPS-pressure ${st.id}: HTTP ${res.status}`);
			const j = (await res.json()) as {
				data?: { t?: string; v?: string }[];
				metadata?: { lat?: string; lon?: string };
			};
			const row = (j.data ?? [])[0];
			const p = Number(row?.v ?? NaN);
			if (!row?.v || !Number.isFinite(p))
				throw new Error(`no pressure ${st.id}`);
			await storeRaw("coops-pressure", layer, res.status, { stn: st.id });
			const lat = Number(j.metadata?.lat);
			const lon = Number(j.metadata?.lon);
			await storeNormalized({
				id: `coopspres:${st.id}:${(row.t ?? "").slice(0, 10)}`,
				ts: row.t ? `${row.t}:00Z`.replace(" ", "T") : new Date().toISOString(),
				source: "coops-pressure",
				layer,
				title: `pressure ${st.name} — ${p} hPa`,
				severity: "info",
				confidence: 0.95,
				lon: Number.isFinite(lon) ? lon : undefined,
				lat: Number.isFinite(lat) ? lat : undefined,
				entities: {},
				meta: { stn: st.id, station: st.name, hpa: p },
			});
			n++;
		} catch (e: unknown) {
			errors.push(`coopspres/${st.id}: ${errMsg(e)}`);
		}
	}
	// Pressure is sparse-by-design like wind: only met-equipped stations carry a
	// barometer. Green when ≥1 reports; the error names pressure misses only
	// (it used to dump every earlier leg's notes and fail on one bare station).
	const presSkips = errors.filter((e) => e.startsWith("coopspres/"));
	for (const s of presSkips) errors.splice(errors.indexOf(s), 1);
	const presHits = COOPS_STATIONS.length - presSkips.length;
	await markHealth(
		"coops-pressure",
		presHits >= 1,
		presSkips.length
			? `${presHits}/${COOPS_STATIONS.length} stations; skips: ${presSkips.join("; ").slice(0, 300)}`
			: undefined,
	);
	// CO-OPS tide predictions hilo (same datagetter, product=predictions):
	// next high/low waters at The Battery — the forecast leg next to
	// observed levels + temperature.
	try {
		const u =
			"https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=today&station=8518750&product=predictions&datum=MSL&units=metric&time_zone=gmt&format=json&interval=hilo";
		assertSafeUrl(u);
		const res = await stealthFetch(u);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			predictions?: { t?: string; v?: string; type?: string }[];
		};
		const rows = j.predictions ?? [];
		await storeRaw("coops-pred", layer, res.status, { n: rows.length });
		for (const r of rows.slice(0, 4)) {
			if (!r.t || !r.v) continue;
			await storeNormalized({
				id: `coopspred:8518750:${r.t.replace(/[^0-9]+/g, "").slice(0, 12)}`,
				ts: `${r.t}:00Z`.replace(" ", "T"),
				source: "coops-pred",
				layer,
				title: `tide prediction The Battery NY — ${r.type === "H" ? "HIGH" : "LOW"} ${r.v}m @ ${r.t.slice(11, 16)}`,
				severity: "info",
				confidence: 0.95,
				lon: -74.0142,
				lat: 40.7006,
				entities: {},
				meta: { stn: "8518750", level_m: r.v, kind: r.type },
			});
			n++;
		}
		await markHealth("coops-pred", true);
	} catch (e: unknown) {
		errors.push(`coops-pred: ${errMsg(e)}`);
		await markHealth("coops-pred", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

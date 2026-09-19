import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { parseTLE3, propagate } from "../lib/orbit.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// CelesTrak stations group (ISS, Tiangong, HST…), keyless TLE + vendored
// Keplerian propagator (lib/orbit.ts — two-body, documented tens-of-km limit).
// CelesTrak 403s some egress IPs (seen 2026-09-09) → fallback to the public
// TLE mirror (tle.ivanstanojevic.me, Hydra API, keyless) for curated NORAD IDs.
const URL =
	"https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle";
// Stable catalog numbers, not guesses: ISS, CSS, HST, NOAA 15/18/19, GOES 16/18.
const MIRROR_IDS = [25544, 48274, 20580, 25338, 28654, 33591, 41866, 51850];
// Live ISS fix (wheretheiss.at, keyless, 1000/hr): ground truth alongside the
// propagated TLE row — propagation drifts tens of km, this doesn't.
const ISSLIVE_URL = "https://api.wheretheiss.at/v1/satellites/25544";
// AMSAT bare TLEs (Look4Sat uses nasabare.txt as an amateur-sat source):
// 3-line groups, "NAME\n1 ...\n2 ...", fresh daily (epoch 2026-09-15).
const AMSAT_TLE_URL = "https://www.amsat.org/tle/current/nasabare.txt";
// AMSAT live status board (Look4Sat RemoteSource): operator "Heard / Not
// Heard" reports with Maidenhead grids — geocodable activity pulse.
const AMSAT_REPORTS_URL =
	"https://www.amsat.org/status/api/v1/reports.php?hours=24&limit=25";

/** Maidenhead grid (JN77sn / FN21) → [lat, lon] center. Null when malformed. */
export function maidenheadToLatLon(grid: string): [number, number] | null {
	const g = grid.trim().toUpperCase();
	if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(g)) return null;
	const sub = g.length === 6;
	const lon =
		(g.charCodeAt(0) - 65) * 20 -
		180 +
		Number(g[2]) * 2 +
		(sub ? (g.charCodeAt(4) - 65) * (5 / 60) + 5 / 120 : 1);
	const lat =
		(g.charCodeAt(1) - 65) * 10 -
		90 +
		Number(g[3]) * 1 +
		(sub ? (g.charCodeAt(5) - 65) * (2.5 / 60) + 2.5 / 120 : 0.5);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
	return [lat, lon];
}

async function fetchMirror(): Promise<{ lines: string[]; source: string }> {
	const lines: string[] = [];
	let errors = 0;
	for (const id of MIRROR_IDS) {
		try {
			const url = `https://tle.ivanstanojevic.me/api/tle/${id}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url, {}, 15000);
			if (!res.ok) throw new Error(`mirror HTTP ${res.status} for ${id}`);
			const j = (await res.json()) as {
				name?: string;
				line1?: string;
				line2?: string;
			};
			if (!j.line1 || !j.line2) throw new Error(`mirror short row for ${id}`);
			lines.push(
				String(j.name ?? `NORAD ${id}`),
				j.line1.trim(),
				j.line2.trim(),
			);
		} catch {
			errors++;
		}
	}
	if (!lines.length) throw new Error(`mirror failed for all ${errors} ids`);
	return { lines, source: "tle-mirror" };
}

export async function collect() {
	const layer = "satellites";
	let n = 0;
	const errors: string[] = [];
	let source = "celestrak";
	try {
		// Primary may 403 (egress block) OR hang/refuse (this sandbox) — either
		// way we fall through to the mirror; a throw must never skip fallback.
		let lines: string[] | null = null;
		let status = 0;
		try {
			assertSafeUrl(URL);
			const res = await stealthFetch(URL);
			status = res.status;
			if (res.ok)
				lines = (await res.text()).split("\n").map((l) => l.trimEnd());
		} catch {
			lines = null;
		}
		if (!lines) {
			const m = await fetchMirror();
			lines = m.lines;
			source = m.source;
		}
		await storeRaw(source, layer, status, { lines: lines.length });
		const now = Date.now();
		for (let i = 0; i + 2 < lines.length && n < 40; i += 3) {
			const tle = parseTLE3(lines[i], lines[i + 1], lines[i + 2]);
			if (!tle) continue;
			// skip stale elements (>3d from epoch — propagator degrades)
			if (Math.abs(now - tle.epochMs) > 3 * 864e5) continue;
			const p = propagate(tle, now);
			await storeNormalized({
				id: `sat:${tle.norad}`,
				ts: new Date(now).toISOString(),
				source,
				layer,
				title: `${tle.name} — ${p.lat.toFixed(1)}°,${p.lon.toFixed(1)}° @${Math.round(p.altKm)}km`,
				severity: "info",
				confidence: 0.8,
				lon: p.lon,
				lat: p.lat,
				entities: {},
				meta: { norad: tle.norad, altKm: Math.round(p.altKm), name: tle.name },
			});
			n++;
		}
		await markHealth(source, true);
	} catch (e: unknown) {
		errors.push(`${source}: ${errMsg(e)}`);
		await markHealth(source, false, errors[errors.length - 1]);
	}
	try {
		assertSafeUrl(ISSLIVE_URL);
		const res = await stealthFetch(ISSLIVE_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			latitude?: number;
			longitude?: number;
			altitude?: number;
			velocity?: number;
			visibility?: string;
			timestamp?: number;
		};
		const lat = Number(j.latitude);
		const lon = Number(j.longitude);
		if (!Number.isFinite(lat) || !Number.isFinite(lon))
			throw new Error("no fix");
		const ts =
			typeof j.timestamp === "number"
				? new Date(j.timestamp * 1000).toISOString()
				: new Date().toISOString();
		await storeRaw("iss-live", layer, res.status, {
			lat,
			lon,
			alt: j.altitude,
		});
		await storeNormalized({
			id: "sat:25544:live",
			ts,
			source: "iss-live",
			layer,
			title: `ISS (live) — ${lat.toFixed(1)}°,${lon.toFixed(1)} @${Math.round(Number(j.altitude) || 0)}km · ${j.visibility ?? "?"}`,
			severity: "info",
			confidence: 0.95,
			lon,
			lat,
			entities: {},
			meta: { norad: "25544", altKm: j.altitude, velocity: j.velocity },
		});
		n++;
		await markHealth("iss-live", true);
	} catch (e: unknown) {
		errors.push(`iss-live: ${errMsg(e)}`);
		await markHealth("iss-live", false, errors[errors.length - 1]);
	}
	try {
		assertSafeUrl(
			"https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10",
		);
		const res = await stealthFetch(
			"https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10",
		);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			results?: {
				id?: string;
				name?: string;
				net?: string;
				status?: { abbrev?: string; name?: string };
				launch_service_provider?: { name?: string };
				pad?: { name?: string; location?: { name?: string } };
			}[];
		};
		const launches = j.results ?? [];
		await storeRaw("spacedevs", layer, res.status, { n: launches.length });
		for (const l of launches) {
			if (!l.id || !l.name) continue;
			await storeNormalized({
				id: `spacedevs:${l.id}`,
				ts: l.net ?? new Date().toISOString(),
				source: "spacedevs",
				layer,
				title:
					`${l.name} — NET ${String(l.net ?? "?").slice(0, 16)}Z [${l.status?.abbrev ?? "?"}]`.slice(
						0,
						280,
					),
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: {
					provider: l.launch_service_provider?.name,
					pad: l.pad?.name,
					site: l.pad?.location?.name,
					status: l.status?.name,
				},
			});
			n++;
		}
		await markHealth("spacedevs", true);
	} catch (e: unknown) {
		errors.push(`spacedevs: ${errMsg(e)}`);
		await markHealth("spacedevs", false, errors[errors.length - 1]);
	}
	try {
		assertSafeUrl("https://db.satnogs.org/api/transmitters/?format=json");
		const res = await stealthFetch(
			"https://db.satnogs.org/api/transmitters/?format=json",
		);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			uuid?: string;
			description?: string;
			mode?: string;
			downlink_low?: number;
			sat_id?: string;
			norad_cat_id?: number;
			status?: string;
		}[];
		const active = rows.filter((r) => r.status === "active").slice(0, 30);
		await storeRaw("satnogs", layer, res.status, { n: active.length });
		for (const t of active) {
			if (!t.uuid) continue;
			const mhz =
				typeof t.downlink_low === "number"
					? `${Math.round(t.downlink_low / 1e5) / 10} MHz`
					: "?";
			await storeNormalized({
				id: `satnogs:${t.uuid}`,
				ts: new Date().toISOString(),
				source: "satnogs",
				layer,
				title:
					`${t.description ?? "transmitter"} ${t.mode ?? ""} ${mhz} (NORAD ${t.norad_cat_id ?? "?"})`.slice(
						0,
						280,
					),
				severity: "info",
				confidence: 0.7,
				entities: {},
				meta: {
					mode: t.mode,
					downlink: t.downlink_low,
					norad: t.norad_cat_id,
					sat: t.sat_id,
				},
			});
			n++;
		}
		await markHealth("satnogs", true);
	} catch (e: unknown) {
		errors.push(`satnogs: ${errMsg(e)}`);
		await markHealth("satnogs", false, errors[errors.length - 1]);
	}
	// RocketLaunch.live next launches (keyless, live JSON count/total):
	// second launch board next to SpaceDevs (different provider set).
	try {
		const url = "https://fdo.rocketlaunch.live/json/launches/next/5";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			result?: {
				id?: number;
				name?: string;
				t0?: string;
				slug?: string;
				provider?: { name?: string };
				vehicle?: { name?: string };
				pad?: { location?: { country?: string } };
			}[];
		};
		const launches = j.result ?? [];
		await storeRaw("rocketlive", layer, res.status, { n: launches.length });
		for (const l of launches) {
			if (!l.id || !l.name) continue;
			await storeNormalized({
				id: `rocketlive:${l.id}`,
				ts: l.t0 ?? new Date().toISOString(),
				source: "rocketlive",
				layer,
				title:
					`${l.name} — ${l.vehicle?.name ?? "?"} NET ${String(l.t0 ?? "?").slice(0, 16)}Z`.slice(
						0,
						280,
					),
				severity: "info",
				confidence: 0.8,
				entities: {},
				meta: {
					provider: l.provider?.name,
					vehicle: l.vehicle?.name,
					country: l.pad?.location?.country,
				},
			});
			n++;
		}
		await markHealth("rocketlive", true);
	} catch (e: unknown) {
		errors.push(`rocketlive: ${errMsg(e)}`);
		await markHealth("rocketlive", false, errors[errors.length - 1]);
	}
	// AMSAT bare TLEs: amateur sats (AO-07, UO-11, …) not in the stations
	// group. Same 3-line parse/propagate path, distinct ids + source.
	try {
		assertSafeUrl(AMSAT_TLE_URL);
		const res = await stealthFetch(AMSAT_TLE_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const lines = (await res.text()).split("\n").map((l) => l.trimEnd());
		await storeRaw("amsat-tle", layer, res.status, { lines: lines.length });
		const now = Date.now();
		for (let i = 0; i + 2 < lines.length && n < 80; i += 3) {
			if (/^1 /.test(lines[i] ?? "")) continue; // no name line — skip
			const tle = parseTLE3(lines[i], lines[i + 1], lines[i + 2]);
			if (!tle) continue;
			if (Math.abs(now - tle.epochMs) > 3 * 864e5) continue;
			const p = propagate(tle, now);
			await storeNormalized({
				id: `amsat-tle:${tle.norad}`,
				ts: new Date(now).toISOString(),
				source: "amsat-tle",
				layer,
				title: `${tle.name} (ham) — ${p.lat.toFixed(1)}°,${p.lon.toFixed(1)}° @${Math.round(p.altKm)}km`,
				severity: "info",
				confidence: 0.75,
				lon: p.lon,
				lat: p.lat,
				entities: {},
				meta: { norad: tle.norad, altKm: Math.round(p.altKm), name: tle.name },
			});
			n++;
		}
		await markHealth("amsat-tle", true);
	} catch (e: unknown) {
		errors.push(`amsat-tle: ${errMsg(e)}`);
		await markHealth("amsat-tle", false, errors[errors.length - 1]);
	}
	// AMSAT live status reports: "Heard" = fresh human reception confirmations
	// with Maidenhead grids → geo rows; "Not Heard" rows count as misses
	// (skipped — silence isn't a signal on the map).
	try {
		assertSafeUrl(AMSAT_REPORTS_URL);
		const res = await stealthFetch(AMSAT_REPORTS_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			data?: {
				id?: number;
				name?: string;
				satellite_display_name?: string;
				reported_time?: string;
				callsign?: string;
				report?: string;
				grid_square?: string;
			}[];
		};
		const rows = j.data ?? [];
		await storeRaw("amsat-status", layer, res.status, { n: rows.length });
		for (const r of rows) {
			if (!r.id || !r.reported_time) continue;
			if (r.report?.toLowerCase() !== "heard") continue;
			const ll = r.grid_square ? maidenheadToLatLon(r.grid_square) : null;
			if (!ll) continue;
			await storeNormalized({
				id: `amsat-status:${r.id}`,
				ts: r.reported_time,
				source: "amsat-status",
				layer,
				title:
					`${r.satellite_display_name ?? r.name ?? "?"} heard by ${r.callsign ?? "?"} (${r.grid_square})`.slice(
						0,
						280,
					),
				severity: "info",
				confidence: 0.7,
				lon: ll[1],
				lat: ll[0],
				entities: {},
				meta: { sat: r.name, callsign: r.callsign, grid: r.grid_square },
			});
			n++;
		}
		await markHealth("amsat-status", true);
	} catch (e: unknown) {
		errors.push(`amsat-status: ${errMsg(e)}`);
		await markHealth("amsat-status", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// Aviation Weather Center active SIGMETs as GeoJSON (keyless). Replaces the dead
// FAA ASWS plan (soa.smext.faa.gov is NXDOMAIN globally).
const URL = "https://aviationweather.gov/api/data/airsigmet?format=geojson";

interface SigFeature {
	properties?: {
		seriesId?: string;
		hazard?: string;
		airSigmetType?: string;
		severity?: number;
		validTimeFrom?: string;
		validTimeTo?: string;
		rawAirSigmet?: string;
	};
	geometry?: { type?: string; coordinates?: unknown };
}

export async function collect() {
	const source = "awc";
	const layer = "airwx";
	let n = 0;
	const errors: string[] = [];
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { features?: SigFeature[] };
		const feats = (json.features ?? []).filter((f) => f.geometry?.coordinates);
		if (!feats.length) throw new Error("empty feature set");
		await storeRaw(source, layer, res.status, { n: feats.length });
		for (const f of feats.slice(0, 200)) {
			const p = f.properties ?? {};
			const sev = Number(p.severity ?? 0);
			await storeNormalized({
				id: `awc:${String(p.seriesId ?? `${p.hazard}-${n}`)}`,
				ts: new Date().toISOString(),
				source,
				layer,
				title:
					`${p.airSigmetType ?? "SIGMET"} ${p.seriesId ?? ""} · ${p.hazard ?? "HAZARD"}`.trim(),
				body: `valid ${(p.validTimeFrom ?? "?").slice(0, 16)} → ${(p.validTimeTo ?? "?").slice(0, 16)}`,
				severity: sev >= 5 ? "critical" : sev >= 3 ? "watch" : "info",
				confidence: 0.95,
				geomJson: {
					type: f.geometry?.type ?? "Polygon",
					coordinates: f.geometry?.coordinates,
				},
				entities: {},
				meta: {
					hazard: p.hazard,
					severity_n: p.severity,
					valid_from: p.validTimeFrom,
					valid_to: p.validTimeTo,
				},
			});
			n++;
		}
		await markHealth(source, true);
	} catch (e: unknown) {
		errors.push(`${source}: ${errMsg(e)}`);
		await markHealth(source, false, errors[errors.length - 1]);
	}
	// AWC G-AIRMETs (keyless, same host): freezing-level/icing/turbulence
	// outlook lines — the area-forecast leg next to convective SIGMETs.
	// Probe-verified 2026-09-17 (29 features, LineString geometry).
	try {
		const url = "https://aviationweather.gov/api/data/gairmet?format=geojson";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as {
			features?: {
				properties?: {
					hazard?: string;
					tag?: string;
					level?: string;
					validTime?: string;
				};
				geometry?: { type?: string; coordinates?: unknown };
			}[];
		};
		const feats = (json.features ?? []).filter((f) => f.geometry?.coordinates);
		await storeRaw("awc-gairmet", layer, res.status, { n: feats.length });
		for (const f of feats.slice(0, 50)) {
			const p = f.properties ?? {};
			await storeNormalized({
				id: `awcgm:${String(p.hazard ?? "?")}:${String(p.tag ?? "?")}:${n}`,
				ts: `${(p.validTime ?? new Date().toISOString()).slice(0, 19)}Z`,
				source: "awc-gairmet",
				layer,
				title:
					`G-AIRMET ${p.hazard ?? "?"} ${p.tag ?? ""} lvl ${p.level ?? "?"}`.trim(),
				severity: /ICE|TURB|LLWS/i.test(p.hazard ?? "") ? "watch" : "info",
				confidence: 0.85,
				geomJson: {
					type: f.geometry?.type ?? "LineString",
					coordinates: f.geometry?.coordinates,
				},
				entities: {},
				meta: { hazard: p.hazard, tag: p.tag, level: p.level },
			});
			n++;
		}
		await markHealth("awc-gairmet", true);
	} catch (e: unknown) {
		errors.push(`awc-gairmet: ${errMsg(e)}`);
		await markHealth("awc-gairmet", false, errors[errors.length - 1]);
	}
	// AWC international SIGMETs (keyless, same host): FIR-level convection/
	// turbulence/volcanic-ash polygons outside CONUS — the global leg.
	// Probe-verified 2026-09-17 (132 features, Mexico FIR TS EMBD sample).
	try {
		const url = "https://aviationweather.gov/api/data/isigmet?format=geojson";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as {
			features?: {
				properties?: {
					seriesId?: string;
					hazard?: string;
					firId?: string;
					firName?: string;
					validTimeFrom?: string;
					validTimeTo?: string;
					top?: number;
				};
				geometry?: { type?: string; coordinates?: unknown };
			}[];
		};
		const feats = (json.features ?? []).filter((f) => f.geometry?.coordinates);
		await storeRaw("awc-isigmet", layer, res.status, { n: feats.length });
		for (const f of feats.slice(0, 100)) {
			const p = f.properties ?? {};
			await storeNormalized({
				id: `awcint:${String(p.seriesId ?? "?")}:${String(p.firId ?? "?")}:${n}`,
				ts: p.validTimeFrom ?? new Date().toISOString(),
				source: "awc-isigmet",
				layer,
				title:
					`Intl SIGMET ${p.seriesId ?? "?"} ${p.firName ?? p.firId ?? "?"} · ${p.hazard ?? "?"}`.trim(),
				severity: /VA|TS|SEV/i.test(p.hazard ?? "") ? "watch" : "info",
				confidence: 0.85,
				geomJson: {
					type: f.geometry?.type ?? "Polygon",
					coordinates: f.geometry?.coordinates,
				},
				entities: {},
				meta: {
					hazard: p.hazard,
					fir: p.firId,
					top: p.top ?? null,
					valid_to: p.validTimeTo,
				},
			});
			n++;
		}
		await markHealth("awc-isigmet", true);
	} catch (e: unknown) {
		errors.push(`awc-isigmet: ${errMsg(e)}`);
		await markHealth("awc-isigmet", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

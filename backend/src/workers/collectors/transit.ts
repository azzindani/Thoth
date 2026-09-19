// Live rail pulse (all keyless): Swiss opendata.ch stationboards (Zurich HB,
// Bern, Geneva, Basel) + SNCF station catalog heartbeat + Minneapolis
// MetroTransit routes + OBB stationboard. Geo rows → `flights` layer is
// wrong — transit gets its own `transit` layer (point stations).
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// [label, station query, lat, lon] — major European hubs. Static facts.
const STATIONS: [string, string, number, number][] = [
	["Zurich HB", "Zurich", 47.378, 8.54],
	["Bern", "Bern", 46.949, 7.447],
	["Geneva", "Geneve", 46.21, 6.142],
	["Basel SBB", "Basel", 47.548, 7.589],
	["Munich Hbf", "München", 48.14, 11.558],
	["Vienna Hbf", "Wien", 48.185, 16.377],
];

const Board = z.object({
	name: z.string().optional(),
	to: z.string().optional(),
	stop: z
		.object({
			departure: z.string().nullable().optional(),
			departureTimestamp: z.number().nullable().optional(),
			delay: z.number().nullable().optional(),
			platform: z.string().nullable().optional(),
		})
		.passthrough()
		.nullable()
		.optional(),
});

const SncfHit = z.object({
	nom: z.string().optional(),
	libellecourt: z.string().optional(),
	position_geographique: z
		.object({ lat: z.number().optional(), lon: z.number().optional() })
		.passthrough()
		.optional(),
});

export async function collect() {
	const layer = "transit";
	let n = 0;
	const errors: string[] = [];

	// Swiss stationboards: next departures per hub (delay = disruption tell).
	for (const [label, query, lat, lon] of STATIONS) {
		try {
			const url = `https://transport.opendata.ch/v1/stationboard?station=${encodeURIComponent(query)}&limit=5`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${label}`);
			const j = (await res.json()) as {
				stationboard?: unknown[];
				station?: { name?: string };
			};
			const board = z.array(Board).parse(j.stationboard ?? []);
			await storeRaw("swiss-rail", layer, res.status, {
				label,
				n: board.length,
			});
			let delayed = 0;
			for (const d of board) {
				const delay = d.stop?.delay ?? 0;
				if (delay > 0) delayed++;
				const dep = d.stop?.departure ?? "";
				await storeNormalized({
					id: `swiss:${label.replace(/[^A-Za-z]+/g, "-")}:${(d.name ?? "?").replace(/\s+/g, "")}:${dep.slice(11, 16)}`,
					ts: new Date().toISOString(),
					source: "swiss-rail",
					layer,
					title: `${label}: ${d.name ?? "?"} → ${d.to ?? "?"} ${dep.slice(11, 16)}${delay > 0 ? ` +${delay}min` : ""}`,
					severity: delay >= 15 ? "watch" : "info",
					confidence: 0.85,
					lon,
					lat,
					entities: {},
					meta: { station: label, line: d.name, to: d.to, delayMin: delay },
				});
				n++;
			}
			if (delayed >= 3)
				await storeNormalized({
					id: `swiss:disruption:${label.replace(/[^A-Za-z]+/g, "-")}:${new Date().toISOString().slice(0, 13)}`,
					ts: new Date().toISOString(),
					source: "swiss-rail",
					layer,
					title: `${label}: ${delayed} delayed departures — disruption`,
					severity: "watch",
					confidence: 0.8,
					lon,
					lat,
					entities: {},
					meta: { station: label, delayed },
				});
		} catch (e: unknown) {
			errors.push(`swiss/${label}: ${errMsg(e)}`);
		}
	}
	const swissOk = !errors.some((e) => e.startsWith("swiss/"));
	await markHealth(
		"swiss-rail",
		swissOk,
		swissOk ? undefined : errors.join("; "),
	);
	n += 0;

	// SNCF stations catalog (heartbeat: catalog alive + sample geo).
	try {
		const url =
			"https://data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/records?limit=5";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as { results?: unknown[] };
		const rows = z.array(SncfHit).parse(j.results ?? []);
		await storeRaw("sncf", layer, res.status, { n: rows.length });
		for (const s of rows) {
			const la = s.position_geographique?.lat;
			const lo = s.position_geographique?.lon;
			if (typeof la !== "number" || typeof lo !== "number") continue;
			await storeNormalized({
				id: `sncf:${(s.libellecourt ?? s.nom ?? "?").replace(/\s+/g, "")}`,
				ts: new Date().toISOString(),
				source: "sncf",
				layer,
				title: `SNCF station ${s.nom ?? "?"} (${s.libellecourt ?? "?"})`,
				severity: "info",
				confidence: 0.7,
				lon: lo,
				lat: la,
				entities: {},
				meta: { station: s.nom },
			});
			n++;
		}
		await markHealth("sncf", true);
	} catch (e: unknown) {
		errors.push(`sncf: ${errMsg(e)}`);
		await markHealth("sncf", false, errors[errors.length - 1]);
	}

	// MetroTransit routes heartbeat (Minneapolis): network list alive.
	try {
		const url = "https://svc.metrotransit.org/nextripv2/routes";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			route_id?: string;
			route_label?: string;
		}[];
		await storeRaw("metrotransit", layer, res.status, { n: rows.length });
		await storeNormalized({
			id: `metrotransit:network:${new Date().toISOString().slice(0, 13)}`,
			ts: new Date().toISOString(),
			source: "metrotransit",
			layer,
			title: `Minneapolis MetroTransit: ${rows.length} routes live`,
			severity: "info",
			confidence: 0.7,
			lon: -93.265,
			lat: 44.978,
			entities: {},
			meta: { routes: rows.length },
		});
		n++;
		await markHealth("metrotransit", true);
	} catch (e: unknown) {
		errors.push(`metrotransit: ${errMsg(e)}`);
		await markHealth("metrotransit", false, errors[errors.length - 1]);
	}

	function st0lat(stations: { lat?: number }[]): number | undefined {
		const v = stations[0]?.lat;
		return typeof v === "number" ? v : undefined;
	}
	function st0lon(stations: { lon?: number }[]): number | undefined {
		const v = stations[0]?.lon;
		return typeof v === "number" ? v : undefined;
	}

	// GBFS bike-share (keyless): CitiBike NYC + Divvy Chicago + CaBi DC
	// + Bluebikes Boston + BikeShare Toronto — sampled station status per
	// system, empty-dock strain rows.
	for (const [sys, label, infoUrl, statusUrl, step] of [
		[
			"gbfs",
			"CitiBike",
			"https://gbfs.citibikenyc.com/gbfs/en/station_information.json",
			"https://gbfs.citibikenyc.com/gbfs/en/station_status.json",
			83,
		],
		[
			"gbfs-divvy",
			"Divvy",
			"https://gbfs.divvybikes.com/gbfs/en/station_information.json",
			"https://gbfs.divvybikes.com/gbfs/en/station_status.json",
			211,
		],
		[
			"gbfs-cabi",
			"CaBi",
			"https://gbfs.capitalbikeshare.com/gbfs/en/station_information.json",
			"https://gbfs.capitalbikeshare.com/gbfs/en/station_status.json",
			149,
		],
		[
			"gbfs-blue",
			"Bluebikes",
			"https://gbfs.bluebikes.com/gbfs/en/station_information.json",
			"https://gbfs.bluebikes.com/gbfs/en/station_status.json",
			167,
		],
		[
			"gbfs-toronto",
			"BikeShareTO",
			"https://tor.publicbikesystem.net/ube/gbfs/v1/en/station_information.json",
			"https://tor.publicbikesystem.net/ube/gbfs/v1/en/station_status.json",
			131,
		],
	] as const) {
		try {
			assertSafeUrl(infoUrl);
			const [infoRes, statusRes] = await Promise.all([
				stealthFetch(infoUrl),
				stealthFetch(statusUrl),
			]);
			if (!infoRes.ok) throw new Error(`HTTP ${infoRes.status} ${sys} info`);
			if (!statusRes.ok)
				throw new Error(`HTTP ${statusRes.status} ${sys} status`);
			const info = (await infoRes.json()) as {
				data?: {
					stations?: {
						station_id?: string;
						name?: string;
						lat?: number;
						lon?: number;
						capacity?: number;
					}[];
				};
			};
			const status = (await statusRes.json()) as {
				data?: {
					stations?: {
						station_id?: string;
						num_bikes_available?: number;
						num_docks_available?: number;
					}[];
				};
			};
			const byId = new Map(
				(status.data?.stations ?? []).map((s) => [s.station_id, s]),
			);
			const stations = info.data?.stations ?? [];
			await storeRaw(sys, layer, 200, { n: stations.length });
			let empty = 0;
			for (const st of stations.filter((_, i) => i % step === 0).slice(0, 15)) {
				if (!st.station_id) continue;
				const s = byId.get(st.station_id);
				const bikes = s?.num_bikes_available ?? 0;
				if (bikes === 0) empty++;
				await storeNormalized({
					id: `${sys}:${st.station_id}`,
					ts: new Date().toISOString(),
					source: sys,
					layer,
					title: `${label} ${st.name ?? "?"}: ${bikes} bikes / ${s?.num_docks_available ?? "?"} docks`,
					severity: bikes === 0 ? "watch" : "info",
					confidence: 0.8,
					lon: st.lon,
					lat: st.lat,
					entities: {},
					meta: {
						bikes,
						docks: s?.num_docks_available ?? null,
						capacity: st.capacity ?? null,
					},
				});
				n++;
			}
			if (empty >= 5)
				await storeNormalized({
					id: `${sys}:shortage:${new Date().toISOString().slice(0, 13)}`,
					ts: new Date().toISOString(),
					source: sys,
					layer,
					title: `${label}: ${empty} sampled stations empty — rebalancing strain`,
					severity: "watch",
					confidence: 0.75,
					lon: st0lon(stations),
					lat: st0lat(stations),
					entities: {},
					meta: { empty },
				});
			await markHealth(sys, true);
		} catch (e: unknown) {
			errors.push(`${sys}: ${errMsg(e)}`);
			await markHealth(sys, false, errors[errors.length - 1]);
		}
	}
	// TfL air quality + tube disruptions (keyless, London pair).
	try {
		const aqUrl = "https://api.tfl.gov.uk/AirQuality";
		assertSafeUrl(aqUrl);
		const aqRes = await stealthFetch(aqUrl);
		if (!aqRes.ok) throw new Error(`HTTP ${aqRes.status} aq`);
		const aq = (await aqRes.json()) as {
			currentForecast?: { forecastBand?: string; forecastSummary?: string }[];
		};
		const f = aq.currentForecast?.[0];
		await storeRaw("tfl-aq", layer, aqRes.status, { band: f?.forecastBand });
		await storeNormalized({
			id: `tflaq:${new Date().toISOString().slice(0, 13)}`,
			ts: new Date().toISOString(),
			source: "tfl-aq",
			layer,
			title:
				`London air: ${f?.forecastBand ?? "?"} — ${(f?.forecastSummary ?? "").slice(0, 150)}`.slice(
					0,
					300,
				),
			severity: /high|very high/i.test(f?.forecastBand ?? "")
				? "watch"
				: "info",
			confidence: 0.85,
			lon: -0.12,
			lat: 51.5,
			entities: {},
			meta: { band: f?.forecastBand ?? null },
		});
		n++;
		await markHealth("tfl-aq", true);
	} catch (e: unknown) {
		errors.push(`tfl-aq: ${errMsg(e)}`);
		await markHealth("tfl-aq", false, errors[errors.length - 1]);
	}
	try {
		const tubeUrl = "https://api.tfl.gov.uk/Line/Mode/tube/Disruption";
		assertSafeUrl(tubeUrl);
		const tubeRes = await stealthFetch(tubeUrl);
		if (!tubeRes.ok) throw new Error(`HTTP ${tubeRes.status} tube`);
		const rows = (await tubeRes.json()) as {
			description?: string;
			closureText?: string;
		}[];
		await storeRaw("tfl-tube", layer, tubeRes.status, { n: rows.length });
		for (const r of rows.slice(0, 10)) {
			if (!r.description) continue;
			await storeNormalized({
				id: `tfltube:${createHash("md5").update(r.description).digest("hex").slice(0, 16)}`,
				ts: new Date().toISOString(),
				source: "tfl-tube",
				layer,
				title: r.description.slice(0, 280),
				severity: /suspended|part suspended|severe/i.test(r.description)
					? "watch"
					: "info",
				confidence: 0.85,
				lon: -0.12,
				lat: 51.5,
				entities: {},
				meta: { closure: r.closureText ?? null },
			});
			n++;
		}
		await markHealth("tfl-tube", true);
	} catch (e: unknown) {
		errors.push(`tfl-tube: ${errMsg(e)}`);
		await markHealth("tfl-tube", false, errors[errors.length - 1]);
	}

	// TfL line status (keyless, victoria+central+jubilee+piccadilly+
	// northern+bakerloo): per-line severity rows — the line-health leg next
	// to mode-wide disruptions. Second trio probe-verified 2026-09-17.
	try {
		const url =
			"https://api.tfl.gov.uk/Line/victoria,central,jubilee,piccadilly,northern,bakerloo/Status";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			id?: string;
			name?: string;
			lineStatuses?: { statusSeverityDescription?: string }[];
		}[];
		await storeRaw("tfl-status", layer, res.status, { n: rows.length });
		for (const l of rows) {
			if (!l.id) continue;
			const desc = l.lineStatuses?.[0]?.statusSeverityDescription ?? "?";
			await storeNormalized({
				id: `tflstatus:${l.id}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "tfl-status",
				layer,
				title: `${l.name ?? l.id}: ${desc}`,
				severity: /severe|suspended|part suspended|disrupted/i.test(desc)
					? "watch"
					: "info",
				confidence: 0.9,
				lon: -0.12,
				lat: 51.5,
				entities: {},
				meta: { line: l.id, status: desc },
			});
			n++;
		}
		await markHealth("tfl-status", true);
	} catch (e: unknown) {
		errors.push(`tfl-status: ${errMsg(e)}`);
		await markHealth("tfl-status", false, errors[errors.length - 1]);
	}

	// iRail Brussels→Antwerp connections (keyless, -L redirect): journey
	// rows with departure epoch + delay + platform — the cross-city leg
	// next to the Brussels liveboard.
	try {
		const url =
			"https://api.irail.be/connections/?from=Brussels&to=Antwerp&format=json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			connection?: {
				departure?: {
					time?: string;
					delay?: string;
					platform?: string;
					vehicle?: string;
				};
				arrival?: { time?: string };
				duration?: string | number;
			}[];
		};
		const conns = j.connection ?? [];
		await storeRaw("irail-conn", layer, res.status, { n: conns.length });
		for (const c of conns.slice(0, 3)) {
			const dep = c.departure;
			if (!dep?.time || !dep.vehicle) continue;
			const delayMin = Math.round(Number(dep.delay ?? 0) / 60);
			await storeNormalized({
				id: `irailconn:${dep.vehicle.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}:${dep.time}`,
				ts: new Date(Number(dep.time) * 1000).toISOString(),
				source: "irail-conn",
				layer,
				title:
					`Brussels→Antwerp ${dep.vehicle} ${new Date(Number(dep.time) * 1000).toISOString().slice(11, 16)} pl.${dep.platform ?? "?"}${delayMin > 0 ? ` +${delayMin}min` : ""}`.slice(
						0,
						280,
					),
				severity: delayMin >= 15 ? "watch" : "info",
				confidence: 0.8,
				lon: 4.3365,
				lat: 50.8365,
				entities: {},
				meta: { vehicle: dep.vehicle, delayMin, duration: c.duration ?? null },
			});
			n++;
		}
		await markHealth("irail-conn", true);
	} catch (e: unknown) {
		errors.push(`irail-conn: ${errMsg(e)}`);
		await markHealth("irail-conn", false, errors[errors.length - 1]);
	}

	// TfL Santander Cycles BikePoints (keyless, 800 docks): empty/full
	// station sample — London bike-share strain leg next to CitiBike GBFS.
	try {
		const url = "https://api.tfl.gov.uk/BikePoint";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			id?: string;
			commonName?: string;
			lat?: number;
			lon?: number;
			additionalProperties?: { key?: string; value?: string }[];
		}[];
		await storeRaw("tfl-bike", layer, res.status, { n: rows.length });
		let empty = 0;
		for (const st of rows.filter((_, i) => i % 53 === 0).slice(0, 15)) {
			const props = new Map(
				(st.additionalProperties ?? []).map((x) => [x.key, x.value]),
			);
			const bikes = Number(props.get("NbBikes") ?? NaN);
			const docks = Number(props.get("NbDocks") ?? NaN);
			if (!Number.isFinite(bikes)) continue;
			if (bikes === 0) empty++;
			if (typeof st.lat !== "number" || typeof st.lon !== "number") continue;
			await storeNormalized({
				id: `tflbike:${(st.id ?? "?").replace(/[^A-Za-z0-9]+/g, "-")}`,
				ts: new Date().toISOString(),
				source: "tfl-bike",
				layer,
				title: `Santander ${(st.commonName ?? "?").slice(0, 50)}: ${bikes} bikes / ${Number.isFinite(docks) ? docks : "?"} docks`,
				severity: bikes === 0 ? "watch" : "info",
				confidence: 0.8,
				lon: st.lon,
				lat: st.lat,
				entities: {},
				meta: { bikes, docks: Number.isFinite(docks) ? docks : null },
			});
			n++;
		}
		if (empty >= 5)
			await storeNormalized({
				id: `tflbike:shortage:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "tfl-bike",
				layer,
				title: `Santander Cycles: ${empty} sampled docks empty — rebalancing strain`,
				severity: "watch",
				confidence: 0.75,
				lon: -0.12,
				lat: 51.5,
				entities: {},
				meta: { empty },
			});
		await markHealth("tfl-bike", true);
	} catch (e: unknown) {
		errors.push(`tfl-bike: ${errMsg(e)}`);
		await markHealth("tfl-bike", false, errors[errors.length - 1]);
	}

	// TfL road disruptions A2/A3/A4/A1/A10/A13/A40 corridors (keyless):
	// closure/severity rows with point coords — London roadworks leg next
	// to tube. A1/A10/A13/A40 probe-verified 2026-09-17 (A10 single row).
	for (const road of ["A2", "A3", "A4", "A1", "A10", "A13", "A40"] as const) {
		try {
			const url = `https://api.tfl.gov.uk/Road/${road}/Disruption`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${road}`);
			const rows = (await res.json()) as {
				id?: string;
				comments?: string;
				severity?: string;
				point?: string;
				hasClosures?: boolean;
				startDateTime?: string;
			}[];
			await storeRaw("tfl-road", layer, res.status, { road, n: rows.length });
			for (const r of rows.slice(0, 5)) {
				if (!r.id) continue;
				const m = (r.point ?? "").match(/\[(-?[\d.]+),(-?[\d.]+)\]/);
				const lon = m?.[1] ? Number(m[1]) : NaN;
				const lat = m?.[2] ? Number(m[2]) : NaN;
				if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
				await storeNormalized({
					id: `tflroad:${r.id}`,
					ts: r.startDateTime ?? new Date().toISOString(),
					source: "tfl-road",
					layer,
					title: `${road}: ${(r.comments ?? "?").slice(0, 200)} [${r.severity ?? "?"}]`,
					severity:
						r.hasClosures || /serious|severe/i.test(r.severity ?? "")
							? "watch"
							: "info",
					confidence: 0.8,
					lon,
					lat,
					entities: {},
					meta: { road, severity: r.severity, closures: !!r.hasClosures },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`tflroad/${road}: ${errMsg(e)}`);
		}
	}
	const tflroadOk = !errors.some((e) => e.startsWith("tflroad/"));
	await markHealth(
		"tfl-road",
		tflroadOk,
		tflroadOk ? undefined : errors.join("; "),
	);

	// Swiss connections (keyless opendata.ch): Zurich→Bern + Bern→Geneva
	// journey legs — the intercity legs next to stationboards. Return legs
	// Bern→Zurich + Geneva→Bern probe-verified 2026-09-17 (both live, 2 each).
	for (const [from, to, tag, clon, clat] of [
		["Zurich", "Bern", "ZH-BE", 8.54, 47.378],
		["Bern", "Geneva", "BE-GE", 7.439, 46.949],
		["Geneva", "Lausanne", "GE-LS", 6.142, 46.21],
		["Lausanne", "Geneva", "LS-GE", 6.629, 46.517],
		["Lausanne", "Bern", "LS-BE", 6.629, 46.517],
		["Lausanne", "Fribourg", "LS-FR", 6.629, 46.517],
		["Fribourg", "Bern", "FR-BE", 7.151, 46.803],
		["Bern", "Zurich", "BE-ZH", 7.439, 46.949],
		["Geneva", "Bern", "GE-BE", 6.142, 46.21],
	] as const) {
		try {
			const url = `https://transport.opendata.ch/v1/connections?from=${from}&to=${to}&limit=2`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const j = (await res.json()) as {
				connections?: {
					from?: { departure?: string };
					to?: { arrival?: string };
					duration?: string;
					transfers?: number;
					sections?: {
						journey?: { name?: string; category?: string } | null;
					}[];
				}[];
			};
			const conns = j.connections ?? [];
			await storeRaw("swiss-conn", layer, res.status, {
				route: tag,
				n: conns.length,
			});
			for (const c of conns) {
				const legs = (c.sections ?? [])
					.map((x) => x.journey)
					.filter((x): x is { name?: string; category?: string } => !!x?.name);
				if (!c.from?.departure) continue;
				await storeNormalized({
					id: `swissconn:${tag}:${(c.from.departure ?? "").slice(0, 16)}`,
					ts: c.from.departure,
					source: "swiss-conn",
					layer,
					title:
						`${from}→${to} ${c.from.departure.slice(11, 16)}→${(c.to?.arrival ?? "?").slice(11, 16)} ${legs.map((l) => l.name).join("+") || "?"} (${c.transfers ?? "?"} transfers)`.slice(
							0,
							280,
						),
					severity: "info",
					confidence: 0.85,
					lon: clon,
					lat: clat,
					entities: {},
					meta: {
						duration: c.duration ?? null,
						transfers: c.transfers ?? null,
						trains: legs.map((l) => l.name),
					},
				});
				n++;
			}
			await markHealth("swiss-conn", true);
		} catch (e: unknown) {
			errors.push(`swissconn/${tag}: ${errMsg(e)}`);
			await markHealth("swiss-conn", false, errors[errors.length - 1]);
		}
	}

	// MBTA Boston vehicles (keyless v3): live bus/rail positions sample.
	try {
		const url = "https://api-v3.mbta.com/vehicles?page%5Blimit%5D=5";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			data?: {
				id?: string;
				attributes?: {
					latitude?: number | null;
					longitude?: number | null;
					label?: string | null;
					current_status?: string | null;
					speed?: number | null;
				};
			}[];
		};
		const rows = j.data ?? [];
		await storeRaw("mbta", layer, res.status, { n: rows.length });
		for (const v of rows) {
			const a = v.attributes;
			if (
				!v.id ||
				typeof a?.latitude !== "number" ||
				typeof a?.longitude !== "number"
			)
				continue;
			await storeNormalized({
				id: `mbta:${v.id}`,
				ts: new Date().toISOString(),
				source: "mbta",
				layer,
				title:
					`MBTA ${a.label ?? v.id} — ${a.current_status ?? "?"}${a.speed != null ? ` @${Math.round(a.speed)}m/s` : ""}`.slice(
						0,
						280,
					),
				severity: "info",
				confidence: 0.8,
				lon: a.longitude,
				lat: a.latitude,
				entities: {},
				meta: { vehicle: v.id, status: a.current_status ?? null },
			});
			n++;
		}
		await markHealth("mbta", true);
	} catch (e: unknown) {
		errors.push(`mbta: ${errMsg(e)}`);
		await markHealth("mbta", false, errors[errors.length - 1]);
	}

	// SEPTA TransitView (keyless, Philadelphia): live bus fleet sample
	// (lat/lng + route + destination + lateness) — East-Coast fleet leg.
	try {
		const url = "https://www3.septa.org/api/TransitView/index.php";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			bus?: {
				lat?: string;
				lng?: string;
				label?: string;
				route_id?: string;
				Direction?: string;
				destination?: string;
				late?: number;
				VehicleID?: string;
			}[];
		};
		const buses = j.bus ?? [];
		await storeRaw("septa", layer, res.status, { n: buses.length });
		for (const b of buses.slice(0, 15)) {
			const lat = Number(b.lat ?? NaN);
			const lon = Number(b.lng ?? NaN);
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
			await storeNormalized({
				id: `septa:${b.VehicleID ?? b.label ?? `${lat},${lon}`}`,
				ts: new Date().toISOString(),
				source: "septa",
				layer,
				title:
					`SEPTA ${b.route_id ?? "?"} ${b.label ?? "?"} → ${(b.destination ?? "?").slice(0, 60)}${(b.late ?? 0) !== 0 ? ` (${b.late}min)` : ""}`.slice(
						0,
						280,
					),
				severity: (b.late ?? 0) >= 15 ? "watch" : "info",
				confidence: 0.8,
				lon,
				lat,
				entities: {},
				meta: { route: b.route_id, vehicle: b.VehicleID, late: b.late ?? 0 },
			});
			n++;
		}
		await markHealth("septa", true);
	} catch (e: unknown) {
		errors.push(`septa: ${errMsg(e)}`);
		await markHealth("septa", false, errors[errors.length - 1]);
	}

	// SEPTA TrainView (keyless, Philadelphia regional rail): live train
	// positions + line + destination + lateness — rail leg next to buses.
	try {
		const url = "https://www3.septa.org/api/TrainView/";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			lat?: string;
			lon?: string;
			trainno?: string;
			line?: string;
			dest?: string;
			currentstop?: string;
			nextstop?: string;
			late?: number;
		}[];
		await storeRaw("septa-rail", layer, res.status, { n: rows.length });
		for (const t of rows.slice(0, 15)) {
			const lat = Number(t.lat ?? NaN);
			const lon = Number(t.lon ?? NaN);
			if (!t.trainno || !Number.isFinite(lat) || !Number.isFinite(lon))
				continue;
			await storeNormalized({
				id: `septarail:${t.trainno}`,
				ts: new Date().toISOString(),
				source: "septa-rail",
				layer,
				title:
					`SEPTA ${t.line ?? "?"} #${t.trainno} → ${(t.dest ?? "?").slice(0, 60)} @ ${t.currentstop ?? "?"}${(t.late ?? 0) !== 0 ? ` (${t.late}min late)` : ""}`.slice(
						0,
						280,
					),
				severity: (t.late ?? 0) >= 15 ? "watch" : "info",
				confidence: 0.8,
				lon,
				lat,
				entities: {},
				meta: {
					line: t.line,
					train: t.trainno,
					late: t.late ?? 0,
					next: t.nextstop ?? null,
				},
			});
			n++;
		}
		await markHealth("septa-rail", true);
	} catch (e: unknown) {
		errors.push(`septa-rail: ${errMsg(e)}`);
		await markHealth("septa-rail", false, errors[errors.length - 1]);
	}

	// Digitraffic Finnish rail (keyless, gzip required): Helsinki live
	// trains — departureDate+trainNumber ids, running/cancelled flags.
	try {
		const url =
			"https://rata.digitraffic.fi/api/v1/live-trains/station/HKI?departed_trains=0&arrived_trains=0&arriving_trains=5&departing_trains=5&include_nonstopping=false";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {
			headers: { "Accept-Encoding": "gzip" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			departureDate?: string;
			trainNumber?: number;
			trainType?: string;
			trainCategory?: string;
			commuterLineID?: string;
			cancelled?: boolean;
			runningCurrently?: boolean;
		}[];
		await storeRaw("digitraffic", layer, res.status, { n: rows.length });
		await storeNormalized({
			id: `digitraffic:HKI:${new Date().toISOString().slice(0, 13)}`,
			ts: new Date().toISOString(),
			source: "digitraffic",
			layer,
			title: `Helsinki live trains: ${rows.length} arriving/departing (${rows.filter((t) => t.cancelled).length} cancelled)`,
			severity: rows.some((t) => t.cancelled) ? "watch" : "info",
			confidence: 0.8,
			lon: 24.941,
			lat: 60.171,
			entities: {},
			meta: {
				trains: rows.length,
				cancelled: rows.filter((t) => t.cancelled).length,
				lines: [
					...new Set(rows.map((t) => t.commuterLineID).filter(Boolean)),
				].slice(0, 8),
			},
		});
		n++;
		for (const t of rows.slice(0, 10)) {
			if (!t.trainNumber || !t.departureDate) continue;
			await storeNormalized({
				id: `digitraffic:${t.departureDate}:${t.trainNumber}`,
				ts: new Date().toISOString(),
				source: "digitraffic",
				layer,
				title:
					`${t.trainType ?? ""} ${t.trainNumber}${t.commuterLineID ? ` (${t.commuterLineID})` : ""} ${t.departureDate}${t.cancelled ? " CANCELLED" : ""}`.slice(
						0,
						280,
					),
				severity: t.cancelled ? "watch" : "info",
				confidence: 0.8,
				lon: 24.941,
				lat: 60.171,
				entities: {},
				meta: {
					train: t.trainNumber,
					line: t.commuterLineID ?? null,
					cancelled: !!t.cancelled,
					running: !!t.runningCurrently,
				},
			});
			n++;
		}
		await markHealth("digitraffic", true);
	} catch (e: unknown) {
		errors.push(`digitraffic: ${errMsg(e)}`);
		await markHealth("digitraffic", false, errors[errors.length - 1]);
	}

	// iRail Belgian liveboard (keyless, 200 with -L): Brussels-South
	// departures with delay seconds + platform — Benelux rail leg.
	try {
		const url =
			"https://api.irail.be/liveboard/?station=Brussels&format=json&fast=true";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			station?: string;
			departures?: {
				departure?: {
					station?: string;
					time?: string | number;
					delay?: string | number;
					platform?: string;
					vehicle?: string;
					canceled?: string | number;
				}[];
			};
		};
		const deps = j.departures?.departure ?? [];
		await storeRaw("irail", layer, res.status, {
			station: j.station,
			n: deps.length,
		});
		for (const d of deps.slice(0, 12)) {
			if (!d.station) continue;
			const delayMin = Math.round(Number(d.delay ?? 0) / 60);
			await storeNormalized({
				id: `irail:${String(d.vehicle ?? d.station)
					.replace(/[^A-Za-z0-9]+/g, "-")
					.slice(0, 40)}:${String(d.time ?? "").slice(0, 10)}`,
				ts: new Date(Number(d.time ?? Date.now() / 1000) * 1000).toISOString(),
				source: "irail",
				layer,
				title:
					`Brussels→${d.station} ${d.vehicle ?? "?"} pl.${d.platform ?? "?"}${delayMin > 0 ? ` +${delayMin}min` : ""}${String(d.canceled ?? "0") === "1" ? " CANCELLED" : ""}`.slice(
						0,
						280,
					),
				severity:
					String(d.canceled ?? "0") === "1" || delayMin >= 15
						? "watch"
						: "info",
				confidence: 0.8,
				lon: 4.3365,
				lat: 50.8365,
				entities: {},
				meta: { to: d.station, vehicle: d.vehicle ?? null, delayMin },
			});
			n++;
		}
		await markHealth("irail", true);
	} catch (e: unknown) {
		errors.push(`irail: ${errMsg(e)}`);
		await markHealth("irail", false, errors[errors.length - 1]);
	}

	// TfL arrivals boards (keyless StopPoint): 16 London stations live
	// tube arrivals with line + platform + countdown. Second batch (Stratford,
	// Canning Town, Liverpool St, Ealing Broadway, Holborn, Bond St)
	// probe-verified 2026-09-17 — Ealing Broadway is 11 rows, not empty.
	for (const [stop, label, clon, clat, prefix] of [
		["940GZZLUBST", "Baker St", -0.157, 51.522, "tflarr"],
		["940GZZLUKSX", "King's Cross", -0.124, 51.53, "tflarrkx"],
		["940GZZLUEUS", "Euston", -0.132, 51.528, "tflarreus"],
		["940GZZLUGPK", "Green Park", -0.143, 51.507, "tflarrgpk"],
		["940GZZLUPAC", "Paddington", -0.176, 51.515, "tflarrpac"],
		["940GZZLUVIC", "Victoria", -0.144, 51.496, "tflarrvic"],
		["940GZZLUOVL", "Oval", -0.112, 51.481, "tflarrovl"],
		["940GZZLUHSC", "High St Ken", -0.188, 51.505, "tflarrhsc"],
		["940GZZLUWLO", "Waterloo", -0.114, 51.503, "tflarrwlo"],
		["940GZZLULNB", "London Bridge", -0.088, 51.505, "tflarrlnb"],
		["940GZZLUSTD", "Stratford", -0.003, 51.5416, "tflarrstd"],
		["940GZZLUCGT", "Canning Town", 0.008, 51.514, "tflarrcgt"],
		["940GZZLULVT", "Liverpool St", -0.082, 51.518, "tflarrlvt"],
		["940GZZLUEBY", "Ealing Bdwy", -0.301, 51.515, "tflarreby"],
		["940GZZLUHBN", "Holborn", -0.119, 51.517, "tflarrhbn"],
		["940GZZLUBND", "Bond St", -0.149, 51.514, "tflarrbnd"],
	] as const) {
		try {
			const url = `https://api.tfl.gov.uk/StopPoint/${stop}/Arrivals`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const rows = (await res.json()) as {
				id?: string;
				lineName?: string;
				platformName?: string;
				destinationName?: string;
				expectedArrival?: string;
				timeToStation?: number;
				vehicleId?: string;
			}[];
			const source =
				prefix === "tflarr"
					? "tfl-arr"
					: prefix === "tflarrkx"
						? "tfl-arr-kx"
						: prefix === "tflarreus"
							? "tfl-arr-eus"
							: prefix === "tflarrgpk"
								? "tfl-arr-gpk"
								: prefix === "tflarrpac"
									? "tfl-arr-pac"
									: prefix === "tflarrvic"
										? "tfl-arr-vic"
										: prefix === "tflarrovl"
											? "tfl-arr-ovl"
											: prefix === "tflarrhsc"
												? "tfl-arr-hsc"
												: prefix === "tflarrwlo"
													? "tfl-arr-wlo"
													: prefix === "tflarrstd"
														? "tfl-arr-std"
														: prefix === "tflarrcgt"
															? "tfl-arr-cgt"
															: prefix === "tflarrlvt"
																? "tfl-arr-lvt"
																: prefix === "tflarreby"
																	? "tfl-arr-eby"
																	: prefix === "tflarrhbn"
																		? "tfl-arr-hbn"
																		: prefix === "tflarrbnd"
																			? "tfl-arr-bnd"
																			: "tfl-arr-lnb";
			await storeRaw(source, layer, res.status, { n: rows.length });
			for (const a of rows.slice(0, 8)) {
				if (!a.id || !a.expectedArrival) continue;
				await storeNormalized({
					id: `${prefix}:${a.id}`,
					ts: a.expectedArrival,
					source,
					layer,
					title:
						`${label} ${a.lineName ?? "?"} → ${(a.destinationName ?? "?").slice(0, 50)} in ${Math.round((a.timeToStation ?? 0) / 60)}min (${(a.platformName ?? "?").slice(0, 30)})`.slice(
							0,
							280,
						),
					severity: "info",
					confidence: 0.85,
					lon: clon,
					lat: clat,
					entities: {},
					meta: {
						line: a.lineName ?? null,
						vehicle: a.vehicleId ?? null,
						ttStation: a.timeToStation ?? null,
					},
				});
				n++;
			}
			await markHealth(source, true);
		} catch (e: unknown) {
			const src =
				prefix === "tflarr"
					? "tfl-arr"
					: prefix === "tflarrkx"
						? "tfl-arr-kx"
						: prefix === "tflarreus"
							? "tfl-arr-eus"
							: prefix === "tflarrgpk"
								? "tfl-arr-gpk"
								: prefix === "tflarrpac"
									? "tfl-arr-pac"
									: prefix === "tflarrvic"
										? "tfl-arr-vic"
										: prefix === "tflarrovl"
											? "tfl-arr-ovl"
											: prefix === "tflarrhsc"
												? "tfl-arr-hsc"
												: prefix === "tflarrwlo"
													? "tfl-arr-wlo"
													: prefix === "tflarrstd"
														? "tfl-arr-std"
														: prefix === "tflarrcgt"
															? "tfl-arr-cgt"
															: prefix === "tflarrlvt"
																? "tfl-arr-lvt"
																: prefix === "tflarreby"
																	? "tfl-arr-eby"
																	: prefix === "tflarrhbn"
																		? "tfl-arr-hbn"
																		: prefix === "tflarrbnd"
																			? "tfl-arr-bnd"
																			: "tfl-arr-lnb";
			errors.push(`${src}: ${errMsg(e)}`);
			await markHealth(src, false, errors[errors.length - 1]);
		}
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

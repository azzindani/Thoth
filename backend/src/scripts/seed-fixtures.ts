import { isProduction } from "../config.js";
import { closePool, query } from "../db/client.js";
import { log } from "../lib/logger.js";
import { markHealth, storeNormalized } from "../workers/lib/store.js";

// Deterministic demo/CI dataset for every dynamic layer, written through the
// same storeNormalized/markHealth path the collectors use. CI and fresh dev
// databases get a populated terminal without reaching ~300 upstreams (CI
// runners and sandboxes are often blocked or rate-limited by them).
//
// Every row id starts with "fixture:"; `--clean` removes exactly those.
// Refuses to run when NODE_ENV=production: fixture rows must never mix with
// real intelligence.
//
// Usage: npm run db:seed:fixtures [-- --clean]

type Fx = {
	layer: string;
	source: string;
	title: string;
	lat: number;
	lon: number;
	polygon?: boolean;
	/** a route (LineString) instead of a point, e.g. submarine cables */
	line?: boolean;
	meta?: Record<string, unknown>;
};

// One or two representative sources per layer (real source ids, so health
// grouping and per-source UI filters behave as in production).
const FIXTURES: Fx[] = [
	{
		layer: "quakes",
		source: "usgs",
		title: "M5.8 Fixture Trench",
		lat: 38.3,
		lon: 142.4,
		meta: { mag: 5.8 },
	},
	{
		layer: "flights",
		source: "adsb.lol",
		title: "FIX123 A320 FL350",
		lat: 51.47,
		lon: -0.45,
	},
	{
		layer: "fires",
		source: "firms",
		title: "VIIRS hotspot (fixture)",
		lat: -12.5,
		lon: 131.0,
	},
	{
		layer: "cctv",
		source: "tfl-jamcam",
		title: "JamCam Westminster Bridge (fixture)",
		lat: 51.5,
		lon: -0.12,
		meta: { image: "https://example.com/cam.jpg" },
	},
	{
		layer: "weather",
		source: "nws",
		title: "Severe Thunderstorm Warning (fixture)",
		lat: 35.2,
		lon: -97.4,
	},
	{
		layer: "disasters",
		source: "eonet",
		title: "Wildfire complex (fixture)",
		lat: 37.8,
		lon: -120.1,
	},
	{
		layer: "telegram",
		source: "telegram",
		title: "Air-defence activity reported near Kyiv (fixture)",
		lat: 50.45,
		lon: 30.52,
	},
	{
		layer: "spacewx",
		source: "swpc-kp",
		title: "Kp 5 geomagnetic storm watch (fixture)",
		lat: 64.8,
		lon: -147.7,
	},
	{
		layer: "markets",
		source: "yahoo",
		title: "S&P 500 5,432.10 +0.4% (fixture)",
		lat: 40.7,
		lon: -74.0,
	},
	{
		layer: "news",
		source: "bbc",
		title: "World leaders meet for emergency summit (fixture)",
		lat: 51.5,
		lon: -0.13,
	},
	{
		layer: "gdacs",
		source: "gdacs",
		title: "Orange flood alert (fixture)",
		lat: 23.7,
		lon: 90.4,
	},
	{
		layer: "cyber",
		source: "cisa-kev",
		title: "CVE-2024-3094 xz-utils backdoor (fixture)",
		lat: 38.9,
		lon: -77.0,
		meta: { cve: "CVE-2024-3094" },
	},
	{
		layer: "oceans",
		source: "ndbc",
		title: "Buoy 41001 waves 4.1m (fixture)",
		lat: 34.7,
		lon: -72.2,
	},
	{
		layer: "radiation",
		source: "safecast",
		title: "Dose rate 0.12 µSv/h (fixture)",
		lat: 37.4,
		lon: 141.0,
	},
	{
		layer: "volcanoes",
		source: "hans",
		title: "Etna alert ORANGE (fixture)",
		lat: 37.75,
		lon: 14.99,
	},
	{
		layer: "drones",
		source: "neptun",
		title: "UAV track over Odesa (fixture)",
		lat: 46.48,
		lon: 30.72,
	},
	{
		layer: "transit",
		source: "tfl-status",
		title: "Central line minor delays (fixture)",
		lat: 51.51,
		lon: -0.1,
	},
	{
		layer: "satellites",
		source: "celestrak",
		title: "ISS (ZARYA) (fixture)",
		lat: 12.0,
		lon: 45.0,
	},
	{
		layer: "energy",
		source: "carbon-uk",
		title: "GB grid 142 gCO2/kWh (fixture)",
		lat: 52.5,
		lon: -1.5,
	},
	{
		layer: "airquality",
		source: "openmeteo-aq",
		title: "Delhi PM2.5 180 µg/m³ (fixture)",
		lat: 28.6,
		lon: 77.2,
	},
	{
		layer: "metar",
		source: "awc-metar",
		title: "EGLL 231150Z 24012KT 9999 (fixture)",
		lat: 51.47,
		lon: -0.46,
	},
	{
		layer: "forecast",
		source: "openmeteo-fx",
		title: "Tokyo 24°C, wind 12 km/h (fixture)",
		lat: 35.68,
		lon: 139.69,
	},
	{
		layer: "research",
		source: "openalex",
		title: "Seismic early warning survey (fixture)",
		lat: 47.37,
		lon: 8.54,
	},
	{
		layer: "health",
		source: "who-gho",
		title: "Measles immunisation 91% (fixture)",
		lat: 46.2,
		lon: 6.14,
	},
	{
		layer: "policy",
		source: "fedreg",
		title: "Executive order on critical infrastructure (fixture)",
		lat: 38.9,
		lon: -77.04,
	},
	{
		layer: "perims",
		source: "nifc",
		title: "Fixture Fire perimeter 1,200 ac",
		lat: 39.5,
		lon: -121.5,
		polygon: true,
	},
	{
		layer: "airwx",
		source: "awc-isigmet",
		title: "SIGMET TS FL300-FL450 (fixture)",
		lat: 10.0,
		lon: 100.0,
		polygon: true,
	},
	{
		layer: "navwarn",
		source: "nga-msi",
		title:
			"HYDROLANT 1001/26 · EASTERN MEDITERRANEAN — HAZARDOUS OPERATIONS, LIVE FIRING (fixture)",
		lat: 34.4,
		lon: 32.4,
		polygon: true,
	},
	{
		layer: "gpsjam",
		source: "gpsjam",
		title: "GNSS interference 34% · 12/35 aircraft degraded (fixture)",
		lat: 56.5,
		lon: 21.5,
		polygon: true,
		meta: { bad: 12, total: 35 },
	},
	{
		layer: "advisories",
		source: "state-travel",
		title: "US travel advisory L4 · Afghanistan: Do Not Travel (fixture)",
		lat: 34.53,
		lon: 69.17,
		meta: { level: 4 },
	},
	{
		layer: "vessels",
		source: "digitraffic-ais",
		title: "FIXTURE STAR · cargo · 12.3 kn · → TALLINN (fixture)",
		lat: 59.9,
		lon: 24.9,
		meta: { kind: "cargo", track: 180 },
	},
	{
		layer: "displacement",
		source: "unhcr",
		title: "2.1M displaced from Fixtureland (fixture)",
		lat: 15.5,
		lon: 32.5,
		meta: { total: 2_100_000 },
	},
	{
		layer: "cables",
		source: "submarine-cables",
		title: "Submarine cable · Fixture Express (fixture)",
		lat: 36.0,
		lon: 14.0,
		line: true,
		meta: { kind: "cable" },
	},
	{
		layer: "incidents",
		source: "thoth-incidents",
		title:
			"M6.2 Fixture Trench — 4 reports · quakes, gdacs · near Japan (fixture)",
		lat: 38.4,
		lon: 142.4,
		meta: {
			reports: 4,
			events: 3,
			layers: ["quakes", "gdacs"],
			sources: ["usgs", "ntwc", "gdacs"],
			radius_km: 48,
			started: new Date(Date.now() - 40 * 60e3).toISOString(),
			timeline: [
				{
					id: "fixture:quakes:0",
					ts: new Date(Date.now() - 40 * 60e3).toISOString(),
					layer: "quakes",
					source: "usgs",
					severity: "critical",
					title: "M6.2 Fixture Trench (fixture)",
					dups: 1,
				},
				{
					id: "fixture:gdacs:0",
					ts: new Date(Date.now() - 20 * 60e3).toISOString(),
					layer: "gdacs",
					source: "gdacs",
					severity: "watch",
					title: "Orange earthquake alert (fixture)",
					dups: 0,
				},
			],
		},
	},
	{
		layer: "anomalies",
		source: "thoth-anomaly",
		title:
			"Air traffic drop near Fixtureland: 3 in the last hour vs usual 41 (−93%) (fixture)",
		lat: 47.5,
		lon: 32.5,
		polygon: true,
		meta: { layer: "flights", dir: "drop", n: 3, median: 41, z: -9.3 },
	},
];

const SEVERITIES = ["critical", "watch", "info"] as const;
// Observation ages: spread over three days so history/trend have >1 bucket.
const AGES_H = [1, 26, 50];

function square(lat: number, lon: number, d = 0.5) {
	return {
		type: "Polygon",
		coordinates: [
			[
				[lon - d, lat - d],
				[lon + d, lat - d],
				[lon + d, lat + d],
				[lon - d, lat + d],
				[lon - d, lat - d],
			],
		],
	};
}

// Dense traffic over Europe / the Mediterranean: live data always has many
// flights and geolocated news there, and map specs hover the clusters that
// form at world zoom. 3 rows per layer never cluster, so they'd test nothing.
const DENSE: {
	layer: string;
	source: string;
	n: number;
	lat: number;
	lon: number;
}[] = [
	{ layer: "flights", source: "adsb.lol", n: 40, lat: 45, lon: 12 },
	{ layer: "news", source: "bbc", n: 24, lat: 41, lon: 20 },
];

async function seedDense(now: number): Promise<number> {
	let n = 0;
	for (const d of DENSE) {
		for (let i = 0; i < d.n; i++) {
			// Deterministic spiral: stable ids + positions on every run.
			const r = 0.4 + (i % 8) * 0.9;
			const a = i * 2.39996; // golden angle
			await storeNormalized({
				id: `fixture:${d.layer}:dense:${i}`,
				ts: new Date(now - (i % 12) * 3600e3).toISOString(),
				source: d.source,
				layer: d.layer,
				title: `${d.layer} fixture ${i + 1}`,
				severity: i % 11 === 0 ? "watch" : "info",
				confidence: 0.9,
				lat: d.lat + r * Math.sin(a),
				lon: d.lon + r * Math.cos(a),
				meta: { fixture: true },
			});
			n++;
		}
		await markHealth(d.source, true);
	}
	return n;
}

async function clean() {
	await query("DELETE FROM events WHERE id LIKE 'fixture:%'");
	await query("DELETE FROM sanctions_entities WHERE id LIKE 'fixture:%'");
	log.info("fixtures removed");
}

async function seed() {
	const now = Date.now();
	let n = 0;
	for (const f of FIXTURES) {
		for (let i = 0; i < AGES_H.length; i++) {
			const lat = f.lat + i * 0.05;
			const lon = f.lon + i * 0.05;
			await storeNormalized({
				id: `fixture:${f.layer}:${i}`,
				ts: new Date(now - AGES_H[i] * 3600e3).toISOString(),
				source: f.source,
				layer: f.layer,
				title: f.title,
				body: `Deterministic fixture row ${i + 1} for the ${f.layer} layer.`,
				url: "https://example.com/fixture",
				severity: SEVERITIES[i],
				confidence: 0.9,
				lat,
				lon,
				geomJson: f.polygon
					? square(lat, lon)
					: f.line
						? {
								type: "LineString",
								coordinates: [
									[lon - 6, lat - 1],
									[lon, lat],
									[lon + 6, lat + 1],
								],
							}
						: undefined,
				meta: { fixture: true, ...f.meta },
			});
			n++;
		}
		await markHealth(f.source, true);
	}
	n += await seedDense(now);
	await query(
		`INSERT INTO sanctions_entities(id, schema, name, aliases, countries, dataset)
     VALUES ('fixture:putin', 'Person', 'Vladimir Vladimirovich PUTIN', '{"Putin"}', '{"ru"}', 'fixture')
     ON CONFLICT (id) DO NOTHING`,
	);
	log.info("fixtures seeded", { events: n, layers: FIXTURES.length });
}

if (isProduction) {
	log.error("refusing to seed fixtures with NODE_ENV=production");
	process.exit(1);
}
try {
	if (process.argv.includes("--clean")) await clean();
	else await seed();
} finally {
	await closePool();
}

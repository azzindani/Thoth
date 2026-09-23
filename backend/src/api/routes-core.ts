import type express from "express";
import { z } from "zod";
import { query } from "../db/client.js";
import {
	getAlerts,
	getBrief,
	getDossier,
	getLayerHistory,
	getLayerSlice,
	getStats,
	getVersions,
} from "../db/queries.js";
import { log } from "../lib/logger.js";
import { LayerParams, VERSION } from "./shared.js";
import { SOURCE_MAP } from "./source-map.js";

const BOOT = Date.now();

// Freeze budgets per source class (sec). Sensors: event-ts ≈ now, tight budget.
// Digests (article dates lag legitimately): wide budget. Catalogs: fetch-failure
// is the only signal — event dates are inherently old, never frozen.
const NEVER_FROZEN =
	/^(cisa-kev|smithsonian|opensanctions|static|gdacs|swpc-alerts|fema|ioda|ooni|usgs-blast|fng|who-gho|hdx-idmc|fda-food|fda-device|fda-faers|fda-510k|fda-ndc|who-news)$/;
const BUDGET: [RegExp, number][] = [
	[
		/^(usgs|emsc|ingv|jma|jma-forecast|bmkg|turkey-kandilli|turkey-afad|opensky|opensky-bosporus|opensky-tokyo|opensky-sydney|opensky-mexico|adsb|telegram|neptun|celestrak|tle-mirror|iss-live|ndbc|coops|coops-temp|coops-pred|coops-wind|coops-pressure|urlhaus|swpc-kp|om-flood)$/,
		7200,
	],
	[
		/^(eonet|neo|firms|nws|nws-fx|metalerts|metalarm|metnow|metocean|metocean-ns|metsun|sunsched|hko|brightsky|nasa-power|bom|ipma|iss-now|yr-forecast|yr-nowcast|nws-obs|fmi|dwd-warn|swiss-rail|swiss-conn|sncf|metrotransit|gbfs|gbfs-divvy|gbfs-cabi|gbfs-blue|gbfs-toronto|tfl-aq|tfl-tube|tfl-bike|tfl-road|tfl-arr|tfl-arr-kx|tfl-arr-eus|tfl-arr-gpk|tfl-arr-pac|tfl-arr-vic|tfl-arr-ovl|tfl-arr-hsc|tfl-arr-wlo|tfl-arr-lnb|tfl-status|irail-conn|mbta|septa|septa-rail|digitraffic|irail|ioda|kalshi|epa-ie|safecast|usgs-blast|sg-lta|sg-psi|tfl-jamcam|on511|polymarket|coingecko|cg-global|yahoo|binance|coinbase|kraken|bitstamp|deribit|deribit-dvol|deribit-funding|mempool|manifold|fxrates|nbp|hn|trials|pubmed|pubmed-latest|doaj|datacite|nhc|carbon-uk|carbon-uk-hist|dk-spot|rainviewer|energy-charts|energy-charts-fr|energy-charts-es|energy-charts-it|energy-charts-nl|energy-charts-pl|energy-charts-be|energy-charts-at|energy-charts-se|energy-charts-dk|energy-charts-pt|energy-charts-gr|energy-charts-hu|energy-charts-si|energy-charts-fi|energy-charts-no|energy-charts-cz|geonet|vatsim|ivao|satnogs|spacedevs|rocketlive|amsat-tle|amsat-status|ghsa|autobahn|blockchair|goldapi|nyfed|fiscaldata|bls-cpi|boc-fx|worldbank|moex|nbp-pln|cbr|nasdaq-top|npm-dl|pypi-dl|rubygems|jsdelivr|crates-trend|defi|cg-exchanges|thn|krebs|bleep|schneier|spamdrop|threatpost|feodo|dshield|dshield-top|cins|threatfox|bazaar|ransomware|msrc|blocklistde|nyc311|chicrime|lacrime|austintraffic|sf311|ukbills|swpc-scales|swpc-wwv|goes-xray|sentry|silso-daily|ocha|ifrc|gateio|spamrep|medrxiv|zenodo|hal|inspire|core|figshare|openaire|arbeitnow|remoteok|themuse|openfood|musicbrainz|erapi-usd|erapi-eur|coinlore|paprika|frankfurter|adsbfi|stack|masto|reddit|lemmy|flickr|inat|gbif|bsky|gh-events|radio|lobsters|devto|)$/,
		14400,
	],
	[
		/^(gdelt|bbc|dw|france24|aljazeera|guardian|gnews|nyt-world|breakingdef|defenseone|ecdc|who-news|reliefweb|fema|sans-isc|snapi|fedreg|govtrack|openalex|crossref|epmc|arxiv|awc-metar|awc-taf|openmeteo-fx|openmeteo-marine|swpc-aurora|swpc-xray|swpc-f107|ecb|imf|nwis)$/,
		43200,
	],
	[/./, 14400],
];
function frozenBudget(source: string): number | null {
	if (NEVER_FROZEN.test(source)) return null;
	for (const [re, s] of BUDGET) if (re.test(source)) return s;
	return 5400;
}

/** Core routes: health, stats, versions, route index, layers, brief, alerts, dossier. */
export function registerCore(app: express.Express): void {
	// Liveness: the process answers. No DB — a DB outage must not get a
	// healthy API container killed and restarted in a loop.
	app.get("/api/livez", (_req, res) => {
		res.json({ ok: true, version: VERSION });
	});
	// Readiness: dependencies answer. Cheap (SELECT 1), for load balancers
	// and the container healthcheck; /api/health stays the verbose feed view.
	app.get("/api/readyz", async (_req, res) => {
		const t0 = Date.now();
		try {
			await query("SELECT 1");
			res.json({ ok: true, db_latency_ms: Date.now() - t0 });
		} catch (e: unknown) {
			log.warn("readiness failed", { error: String(e) });
			res.status(503).json({ ok: false, error: "database unavailable" });
		}
	});
	app.get("/api/health", async (_req, res) => {
		const t0 = Date.now();
		try {
			const rows = await query<{
				source: string;
				last_ok: string | null;
				last_attempt: string | null;
				error: string | null;
				content_ts: string | null;
				first_ok_at: string | null;
			}>(
				`SELECT source, last_ok, last_attempt, error, content_ts, first_ok_at FROM feed_health ORDER BY source`,
			);
			const now = Date.now();
			const feeds = rows.map((f) => {
				const ageMs = f.content_ts ? now - Date.parse(f.content_ts) : null;
				const budget = frozenBudget(f.source);
				// Frozen upstream: succeeding runs, but observations stopped moving.
				const frozen =
					!!f.last_ok &&
					budget !== null &&
					ageMs !== null &&
					ageMs > budget * 1000;
				// Warming: never published once AND not erroring — soft absence, not STALE.
				const warming = !f.first_ok_at && !f.error;
				// Owning collector + poll cadence (source-map.ts): the monitor
				// groups by collector and shows per-source period + stale depth.
				// Unknown sources stay null — shown ungrouped, never dropped.
				const meta = SOURCE_MAP[f.source] ?? null;
				return {
					...f,
					frozen,
					warming,
					collector: meta?.collector ?? null,
					intervalSec: meta?.intervalSec ?? null,
				};
			});
			res.json({
				ok: true,
				version: VERSION,
				uptime_sec: Math.floor((Date.now() - BOOT) / 1000),
				db_latency_ms: Date.now() - t0,
				ts: new Date().toISOString(),
				feeds,
			});
		} catch (e: unknown) {
			log.error("health failed", { error: String(e) });
			res.status(500).json({ ok: false, error: "health check failed" });
		}
	});

	app.get("/api/stats", async (_req, res) => {
		res.json({ serverTs: new Date().toISOString(), items: await getStats() });
	});

	app.get("/api/versions", async (_req, res) => {
		res.json({
			serverTs: new Date().toISOString(),
			versions: await getVersions(),
		});
	});

	// Self-describing route index, generated from the Express stack at runtime —
	// documentation that cannot drift from the code.
	app.get("/api/routes", (_req, res) => {
		const routes: { method: string; path: string }[] = [];
		const stack =
			(app as unknown as { router?: { stack?: unknown[] } }).router?.stack ??
			[];
		for (const l of stack) {
			const r = (l as { route?: { path?: unknown; methods?: unknown } }).route;
			if (typeof r?.path !== "string") continue;
			const methods = r.methods as Record<string, unknown> | undefined;
			for (const [m, on] of Object.entries(methods ?? {}))
				if (on && !m.startsWith("_"))
					routes.push({ method: m.toUpperCase(), path: r.path });
		}
		routes.sort(
			(a, b) =>
				a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
		);
		res.json({ ok: true, count: routes.length, routes });
	});

	app.get("/api/layers/:layer", async (req, res) => {
		const p = LayerParams.safeParse({
			layer: req.params.layer,
			since: req.query.since,
		});
		if (!p.success) {
			res.status(400).json({ ok: false, error: "bad layer or since" });
			return;
		}
		const items = await getLayerSlice(p.data.layer, 500, p.data.since);
		res.json({
			items,
			total: items.length,
			serverTs: new Date().toISOString(),
			versions: await getVersions(),
		});
	});

	app.get("/api/brief", async (_req, res) => {
		try {
			res.json(await getBrief());
		} catch (e: unknown) {
			log.error("brief failed", { error: String(e) });
			res.status(500).json({ ok: false, error: "brief query failed" });
		}
	});

	app.get("/api/alerts", async (req, res) => {
		const limit = req.query.limit ? Number(req.query.limit) : 50;
		try {
			const items = await getAlerts(Number.isFinite(limit) ? limit : 50);
			res.json({
				items,
				total: items.length,
				serverTs: new Date().toISOString(),
			});
		} catch (e: unknown) {
			log.error("alerts failed", { error: String(e) });
			res.status(500).json({ ok: false, error: "alerts query failed" });
		}
	});

	const HistoryParams = z.object({
		layer: z.string().min(1).max(64),
		bucket: z.enum(["hour", "day"]).default("day"),
		from: z.string().datetime({ offset: true }).optional(),
		to: z.string().datetime({ offset: true }).optional(),
	});
	app.get("/api/layers/:layer/history", async (req, res) => {
		const p = HistoryParams.safeParse({
			layer: req.params.layer,
			bucket: req.query.bucket,
			from: req.query.from,
			to: req.query.to,
		});
		if (!p.success) {
			res.status(400).json({ ok: false, error: "bad history params" });
			return;
		}
		try {
			res.json({
				layer: p.data.layer,
				bucket: p.data.bucket,
				buckets: await getLayerHistory(
					p.data.layer,
					p.data.bucket,
					p.data.from,
					p.data.to,
				),
			});
		} catch (e: unknown) {
			log.error("history failed", { error: String(e) });
			res.status(500).json({ ok: false, error: "history query failed" });
		}
	});

	const DossierParams = z.object({
		lat: z.coerce.number().min(-90).max(90),
		lon: z.coerce.number().min(-180).max(180),
		radius_km: z.coerce.number().min(1).max(1000).default(100),
	});
	app.get("/api/dossier", async (req, res) => {
		const p = DossierParams.safeParse({
			lat: req.query.lat,
			lon: req.query.lng ?? req.query.lon,
			radius_km: req.query.radius_km,
		});
		if (!p.success) {
			res.status(400).json({ ok: false, error: "lat + lng required" });
			return;
		}
		try {
			res.json({
				lat: p.data.lat,
				lon: p.data.lon,
				radius_km: p.data.radius_km,
				...(await getDossier(p.data.lat, p.data.lon, p.data.radius_km)),
			});
		} catch (e: unknown) {
			log.error("dossier failed", { error: String(e) });
			res.status(500).json({ ok: false, error: "dossier query failed" });
		}
	});
}

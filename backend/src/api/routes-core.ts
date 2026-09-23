import type express from "express";
import { z } from "zod";
import { query } from "../db/client.js";
import {
	getAlerts,
	getBrief,
	getDossier,
	getLayerHistory,
	getLayerSlice,
	getLayerView,
	getStats,
	getVersions,
} from "../db/queries.js";
import { log } from "../lib/logger.js";
import { frozenBudget } from "./freeze.js";
import { LayerParams, VERSION } from "./shared.js";
import { SOURCE_MAP } from "./source-map.js";

const BOOT = Date.now();

/** Camera view for map slices: zoom + optional bbox "w,s,e,n" (w > e
 * crosses the antimeridian). */
const ViewParams = z.object({
	z: z.coerce.number().min(0).max(24).optional(),
	bbox: z
		.string()
		.max(120)
		.transform((s) => s.split(",").map(Number))
		.refine(
			(b) =>
				b.length === 4 &&
				b.every(Number.isFinite) &&
				b[0] >= -180 &&
				b[2] <= 180 &&
				b[1] >= -90 &&
				b[3] <= 90 &&
				b[1] < b[3] &&
				b[0] <= 180 &&
				b[2] >= -180,
		)
		.transform((b) => b as [number, number, number, number])
		.optional(),
});

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
		const v = ViewParams.safeParse({ z: req.query.z, bbox: req.query.bbox });
		if (!v.success) {
			res.status(400).json({ ok: false, error: "bad z or bbox" });
			return;
		}
		// No camera → the classic newest-500 slice (inspector, ticker, exports).
		if (v.data.z == null) {
			const items = await getLayerSlice(p.data.layer, 500, p.data.since);
			res.json({
				items,
				total: items.length,
				serverTs: new Date().toISOString(),
				versions: await getVersions(),
			});
			return;
		}
		const r = await getLayerView(p.data.layer, {
			z: v.data.z,
			bbox: v.data.bbox,
			since: p.data.since,
		});
		res.json({
			items: r.items,
			total: r.items.length,
			matched: r.matched,
			limit: r.limit,
			truncated: r.truncated,
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
		const hours = req.query.hours ? Number(req.query.hours) : 24;
		try {
			const items = await getAlerts(
				Number.isFinite(limit) ? limit : 50,
				Number.isFinite(hours) ? hours : 24,
			);
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

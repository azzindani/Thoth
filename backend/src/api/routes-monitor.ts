import type express from "express";
import { z } from "zod";
import { query } from "../db/client.js";
import { log } from "../lib/logger.js";
import { COLLECTORS } from "../workers/registry.js";
import {
	catalog,
	clearMonitorCache,
	collectors,
	endpoints,
	metricsText,
	sourceDetail,
	sources,
	summary,
} from "./monitor.js";

/** Monitor routes (ROADMAP P1): history, cadence, endpoints, run-now, metrics. */
export function registerMonitor(app: express.Express): void {
	const wrap =
		(fn: (req: express.Request) => Promise<unknown>) =>
		async (req: express.Request, res: express.Response) => {
			try {
				res.json({ ok: true, ...((await fn(req)) as object) });
			} catch (e: unknown) {
				log.error("monitor query failed", { path: req.path, error: String(e) });
				res.status(500).json({ ok: false, error: "monitor query failed" });
			}
		};

	app.get(
		"/api/monitor/summary",
		wrap(async () => await summary()),
	);
	app.get(
		"/api/monitor/sources",
		wrap(async () => ({ items: await sources() })),
	);
	const Src = z.string().min(1).max(80);
	app.get("/api/monitor/sources/:source", async (req, res) => {
		const p = Src.safeParse(req.params.source);
		if (!p.success) {
			res.status(400).json({ ok: false, error: "bad source" });
			return;
		}
		try {
			const d = await sourceDetail(p.data);
			if (!d.row && !d.runs.length) {
				res.status(404).json({ ok: false, error: "unknown source" });
				return;
			}
			res.json({ ok: true, ...d });
		} catch (e: unknown) {
			log.error("monitor source failed", { error: String(e) });
			res.status(500).json({ ok: false, error: "monitor query failed" });
		}
	});
	app.get(
		"/api/monitor/collectors",
		wrap(async () => ({ items: await collectors() })),
	);
	app.get(
		"/api/monitor/endpoints",
		wrap(async () => ({ items: await endpoints() })),
	);
	app.get(
		"/api/monitor/catalog",
		wrap(async () => ({ items: await catalog() })),
	);

	// Run now: enqueue for the worker (write-key gated by the /api write
	// middleware like every POST). One open request per collector.
	app.post("/api/monitor/run/:collector", async (req, res) => {
		const name = String(req.params.collector ?? "");
		if (!(name in COLLECTORS)) {
			res.status(404).json({ ok: false, error: "unknown collector" });
			return;
		}
		try {
			const open = await query<{ id: string }>(
				`SELECT id FROM collector_requests WHERE collector = $1 AND done_at IS NULL LIMIT 1`,
				[name],
			);
			if (open.length) {
				res.status(202).json({ ok: true, queued: false, pending: true });
				return;
			}
			await query(`INSERT INTO collector_requests(collector) VALUES ($1)`, [
				name,
			]);
			clearMonitorCache();
			res.status(202).json({ ok: true, queued: true, pending: true });
		} catch (e: unknown) {
			log.error("run-now failed", { error: String(e) });
			res.status(500).json({ ok: false, error: "could not queue run" });
		}
	});

	// Prometheus text exposition (also under /api for the same-origin proxy).
	const metrics = async (_req: express.Request, res: express.Response) => {
		try {
			res
				.type("text/plain; version=0.0.4; charset=utf-8")
				.send(await metricsText());
		} catch (e: unknown) {
			log.error("metrics failed", { error: String(e) });
			res.status(500).type("text/plain").send("# metrics unavailable\n");
		}
	};
	app.get("/metrics", metrics);
	app.get("/api/metrics", metrics);
}

import type express from "express";
import { z } from "zod";
import { query } from "../db/client.js";
import {
	getBrief,
	getLayerSlice as slice,
	getVersions as versions,
} from "../db/queries.js";
import { pushTelegram } from "../workers/lib/push.js";
import { queryImagery } from "./imagery.js";
import { LayerParams, VERSION } from "./server.js";

/** Intel routes: theaters, search, watch, sitrep, imagery, notify, trend, export, stream. */
export function registerIntel(app: express.Express): void {
	// Theaters: static config (centers, zooms, city lists) for map fly-to + reference.
	app.get("/api/theaters", async (_req, res) => {
		try {
			const { readFileSync } = await import("node:fs");
			const raw = JSON.parse(
				readFileSync(
					new URL("../../static/theaters.json", import.meta.url).pathname,
					"utf8",
				),
			) as {
				theaters: Record<
					string,
					{
						label: string;
						center: [number, number];
						zoom: number;
						cities: unknown[];
					}
				>;
			};
			res.json({
				theaters: Object.fromEntries(
					Object.entries(raw.theaters).map(([k, t]) => [
						k,
						{
							label: t.label,
							center: t.center,
							zoom: t.zoom,
							cities: t.cities.length,
						},
					]),
				),
			});
		} catch {
			res.status(503).json({ ok: false, error: "theaters not vendored" });
		}
	});

	// BTC address lookup via mempool.space (keyless; blockstream.info is
	// Full-text search over the live corpus (TSVECTOR + GIN, see 001_init.sql).
	app.get("/api/search", async (req, res) => {
		const q = String(req.query.q ?? "")
			.trim()
			.slice(0, 200);
		const layer = String(req.query.layer ?? "")
			.trim()
			.slice(0, 40);
		const limit = Math.min(
			Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
			200,
		);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "q required (min 2 chars)" });
			return;
		}
		try {
			const conds = ["search @@ plainto_tsquery('english', $1)"];
			const params: unknown[] = [q];
			if (layer) {
				params.push(layer);
				conds.push(`layer = $${params.length}`);
			}
			params.push(limit);
			const items = await query(
				`SELECT id, ts, source, layer, title, body, url, severity, confidence,
              ST_AsGeoJSON(geom)::json AS geom, entities, meta,
              ts_rank(search, plainto_tsquery('english', $1)) AS rank
       FROM events WHERE ${conds.join(" AND ")} ORDER BY rank DESC, ts DESC LIMIT $${params.length}`,
				params,
			);
			res.json({ ok: true, q, count: items.length, items });
		} catch (e: unknown) {
			res.status(500).json({ ok: false, error: String(e).slice(0, 120) });
		}
	});

	// Watchlists: keyword / layer / severity watches + match scanning.
	const WatchParams = z.object({
		kind: z.enum(["keyword", "layer", "severity"]),
		value: z.string().trim().min(1).max(200),
		note: z.string().trim().max(500).optional().default(""),
	});
	app.get("/api/watch", async (_req, res) => {
		res.json({
			ok: true,
			items: await query("SELECT * FROM watchlists ORDER BY created_at"),
		});
	});
	app.post("/api/watch", async (req, res) => {
		const p = WatchParams.safeParse(req.body);
		if (!p.success) {
			res.status(400).json({
				ok: false,
				error: "kind=keyword|layer|severity, value required",
			});
			return;
		}
		const id = `w:${p.data.kind}:${p.data.value.toLowerCase()}`;
		await query(
			`INSERT INTO watchlists(id, kind, value, note) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET note=EXCLUDED.note`,
			[id, p.data.kind, p.data.value, p.data.note],
		);
		res.json({ ok: true, id });
	});
	app.delete("/api/watch/:id", async (req, res) => {
		await query("DELETE FROM watchlists WHERE id=$1", [String(req.params.id)]);
		res.json({ ok: true });
	});
	app.get("/api/watch/matches", async (req, res) => {
		const limit = Math.min(
			Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
			200,
		);
		const watches = await query<{ kind: string; value: string }>(
			"SELECT kind, value FROM watchlists",
		);
		if (!watches.length) {
			res.json({ ok: true, count: 0, items: [] });
			return;
		}
		const ors: string[] = [];
		const params: unknown[] = [];
		for (const w of watches) {
			if (w.kind === "keyword") {
				params.push(`%${w.value}%`);
				ors.push(
					`(title ILIKE $${params.length} OR body ILIKE $${params.length})`,
				);
			} else if (w.kind === "layer") {
				params.push(w.value);
				ors.push(`layer = $${params.length}`);
			} else {
				params.push(w.value);
				ors.push(`severity = $${params.length}`);
			}
		}
		params.push(limit);
		const items = await query(
			`SELECT id, ts, source, layer, title, body, url, severity, confidence,
            ST_AsGeoJSON(geom)::json AS geom, entities, meta
     FROM events WHERE ${ors.join(" OR ")} ORDER BY ts DESC LIMIT $${params.length}`,
			params,
		);
		res.json({ ok: true, count: items.length, items });
	});

	function renderSitrep(b: {
		generated_at: string;
		critical: { layer: string; title: string; source: string; ts: string }[];
		watch: { layer: string; title: string; source: string; ts: string }[];
		gaps: { source: string; error: string | null }[];
		counts: { layer: string; count: string }[];
	}): string {
		const L = [
			`# THOTH SITREP — ${b.generated_at.slice(0, 10)}`,
			`_generated ${b.generated_at}_`,
			"",
			`## CRITICAL (${b.critical.length})`,
			...b.critical.map(
				(c) =>
					`- **[${c.layer}]** ${c.title} _(${c.source}, ${String(c.ts).slice(0, 16)})_`,
			),
			"",
			`## WATCH (${b.watch.length})`,
			...b.watch.map((c) => `- **[${c.layer}]** ${c.title} _(${c.source})_`),
			"",
			`## FEED GAPS (${b.gaps.length})`,
			...b.gaps.map((g) => `- ${g.source}: ${g.error ?? "stale"}`),
			"",
			"## 24H COUNTS",
			...b.counts.map((c) => `- ${c.layer}: ${c.count}`),
			"",
		];
		return L.join("\n");
	}
	app.post("/api/sitrep", async (_req, res) => {
		try {
			const b = await getBrief();
			const day = new Date().toISOString().slice(0, 10);
			await query(
				`INSERT INTO sitreps(day, critical_count, watch_count, gaps, body)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (day) DO UPDATE SET generated_at=now(), critical_count=EXCLUDED.critical_count,
         watch_count=EXCLUDED.watch_count, gaps=EXCLUDED.gaps, body=EXCLUDED.body`,
				[
					day,
					b.critical.length,
					b.watch.length,
					b.gaps.map((g) => g.source),
					JSON.stringify(b),
				],
			);
			res.json({ ok: true, day, md: renderSitrep(b) });
		} catch (e: unknown) {
			res.status(500).json({ ok: false, error: String(e).slice(0, 120) });
		}
	});
	app.get("/api/sitrep", async (_req, res) => {
		const rows = await query<{ day: string; body: unknown }>(
			"SELECT day, body FROM sitreps ORDER BY day DESC LIMIT 1",
		);
		if (!rows.length) {
			res.json({
				ok: true,
				day: null,
				md: "# SITREP — none archived yet (POST /api/sitrep)",
			});
			return;
		}
		const b = rows[0].body as Parameters<typeof renderSitrep>[0];
		res.json({ ok: true, day: rows[0].day, md: renderSitrep(b) });
	});

	// Company identity via GLEIF LEI records (keyless): LEI, legal name,
	// jurisdiction, status, HQ country. Identity leg only — an exposure
	// Latest Sentinel-2 true-color over a point (earth-search STAC, keyless).
	// scene:null is honest (open ocean, polar night, persistent cloud).
	app.get("/api/imagery", async (req, res) => {
		const lon = Number(req.query.lon);
		const lat = Number(req.query.lat);
		if (
			!Number.isFinite(lon) ||
			!Number.isFinite(lat) ||
			Math.abs(lon) > 180 ||
			Math.abs(lat) > 90
		) {
			res.status(400).json({ ok: false, error: "lon/lat required (degrees)" });
			return;
		}
		try {
			const scene = await queryImagery(lon, lat);
			res.json({ ok: true, scene });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `imagery unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Manual alert push (Phase 6 leg). Disabled-honest without bot token+chat.
	app.post("/api/notify", async (req, res) => {
		const text = String(req.body?.text ?? "")
			.trim()
			.slice(0, 4000);
		if (!text) {
			res.status(400).json({ ok: false, error: "text required" });
			return;
		}
		const r = await pushTelegram(text);
		res.json(r);
	});

	// Terminal pillar (fincept digest, batch64): analyst-owned objects.
	// Portfolios + positions (holdings aggregate), notes (ticker-linked
	// FinancialNote shape), screens (saved screener specs). Single-operator:
	// no auth scoping; ids client-stable for upsert.
	const Slug = z
		.string()
		.trim()
		.min(1)
		.max(80)
		.regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/);
	app.get("/api/portfolios", async (_req, res) => {
		res.json({
			ok: true,
			items: await query(
				"SELECT p.*, COALESCE(json_agg(o.*) FILTER (WHERE o.id IS NOT NULL), '[]') AS positions FROM portfolios p LEFT JOIN positions o ON o.portfolio_id = p.id GROUP BY p.id ORDER BY p.created_at",
			),
		});
	});
	app.post("/api/portfolios", async (req, res) => {
		const p = z
			.object({ name: Slug, note: z.string().max(500).default("") })
			.safeParse(req.body);
		if (!p.success) {
			res.status(400).json({ ok: false, error: "name required" });
			return;
		}
		const id = `pf:${p.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
		await query(
			`INSERT INTO portfolios(id, name, note) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, note=EXCLUDED.note`,
			[id, p.data.name, p.data.note],
		);
		res.json({ ok: true, id });
	});
	app.delete("/api/portfolios/:id", async (req, res) => {
		await query("DELETE FROM portfolios WHERE id=$1", [String(req.params.id)]);
		res.json({ ok: true });
	});
	app.post("/api/portfolios/:id/positions", async (req, res) => {
		const pid = String(req.params.id);
		const p = z
			.object({
				symbol: z
					.string()
					.trim()
					.min(1)
					.max(12)
					.regex(/^[A-Za-z0-9.^=-]+$/),
				qty: z.coerce.number().finite(),
				avg_price: z.coerce.number().finite().optional(),
				note: z.string().max(300).default(""),
			})
			.safeParse(req.body);
		if (!p.success) {
			res.status(400).json({ ok: false, error: "symbol + qty required" });
			return;
		}
		const sym = p.data.symbol.toUpperCase();
		const id = `${pid}:${sym}`;
		await query(
			`INSERT INTO positions(id, portfolio_id, symbol, qty, avg_price, note)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET qty=EXCLUDED.qty, avg_price=EXCLUDED.avg_price, note=EXCLUDED.note`,
			[id, pid, sym, p.data.qty, p.data.avg_price ?? null, p.data.note],
		);
		res.json({ ok: true, id });
	});
	app.delete("/api/portfolios/:id/positions/:sym", async (req, res) => {
		await query("DELETE FROM positions WHERE id=$1", [
			`${String(req.params.id)}:${String(req.params.sym).toUpperCase()}`,
		]);
		res.json({ ok: true });
	});
	const NoteParams = z.object({
		title: z.string().trim().min(1).max(200),
		body: z.string().max(8000).default(""),
		category: z
			.enum(["idea", "earnings", "risk", "macro", "watch"])
			.default("idea"),
		tickers: z.string().max(200).default(""),
		sentiment: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]).default("NEUTRAL"),
		favorite: z.coerce.boolean().default(false),
	});
	app.get("/api/notes", async (req, res) => {
		const q = String(req.query.q ?? "")
			.trim()
			.slice(0, 100);
		const items = q
			? await query(
					"SELECT * FROM notes WHERE (title ILIKE $1 OR body ILIKE $1 OR tickers ILIKE $1) AND NOT archived ORDER BY updated_at DESC LIMIT 50",
					[`%${q}%`],
				)
			: await query(
					"SELECT * FROM notes WHERE NOT archived ORDER BY updated_at DESC LIMIT 50",
				);
		res.json({ ok: true, count: items.length, items });
	});
	app.post("/api/notes", async (req, res) => {
		const p = NoteParams.safeParse(req.body);
		if (!p.success) {
			res.status(400).json({ ok: false, error: "title required" });
			return;
		}
		const id = `n:${Date.now().toString(36)}:${p.data.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.slice(0, 40)}`;
		await query(
			`INSERT INTO notes(id, title, body, category, tickers, sentiment, favorite)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			[
				id,
				p.data.title,
				p.data.body,
				p.data.category,
				p.data.tickers.toUpperCase(),
				p.data.sentiment,
				p.data.favorite,
			],
		);
		res.json({ ok: true, id });
	});
	app.delete("/api/notes/:id", async (req, res) => {
		await query("DELETE FROM notes WHERE id=$1", [String(req.params.id)]);
		res.json({ ok: true });
	});
	const ScreenParams = z.object({
		name: Slug,
		spec: z.record(z.unknown()).default({}),
	});
	app.get("/api/screens", async (_req, res) => {
		res.json({
			ok: true,
			items: await query("SELECT * FROM screens ORDER BY created_at"),
		});
	});
	app.post("/api/screens", async (req, res) => {
		const p = ScreenParams.safeParse(req.body);
		if (!p.success) {
			res.status(400).json({ ok: false, error: "name required" });
			return;
		}
		const id = `sc:${p.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
		await query(
			`INSERT INTO screens(id, name, spec) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, spec=EXCLUDED.spec`,
			[id, p.data.name, JSON.stringify(p.data.spec)],
		);
		res.json({ ok: true, id });
	});
	app.delete("/api/screens/:id", async (req, res) => {
		await query("DELETE FROM screens WHERE id=$1", [String(req.params.id)]);
		res.json({ ok: true });
	});
	app.get("/api/sitrep/history", async (req, res) => {
		const days = Math.min(
			Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1),
			365,
		);
		const rows = await query(
			"SELECT day, generated_at, critical_count, watch_count, gaps FROM sitreps ORDER BY day DESC LIMIT $1",
			[days],
		);
		res.json({ ok: true, count: rows.length, items: rows });
	});

	// Trend analytics: per-day event counts per layer (from the live corpus) plus
	// the sitrep archive's critical/watch series. Honest about depth: days with no
	// data are omitted, and the response says how many days back it reaches.
	app.get("/api/analytics/trend", async (req, res) => {
		const layer = String(req.query.layer ?? "")
			.trim()
			.slice(0, 40);
		const days = Math.min(
			Math.max(parseInt(String(req.query.days ?? "14"), 10) || 14, 1),
			90,
		);
		try {
			const conds = ["ts > now() - ($1 || ' days')::interval"];
			const params: unknown[] = [String(days)];
			if (layer) {
				params.push(layer);
				conds.push(`layer = $${params.length}`);
			}
			const series = await query<{ day: string; layer: string; n: string }>(
				`SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day, layer, count(*)::text AS n
       FROM events WHERE ${conds.join(" AND ")} GROUP BY 1, 2 ORDER BY 1`,
				params,
			);
			const sitreps = await query<{
				day: string;
				critical_count: number;
				watch_count: number;
			}>(
				"SELECT day, critical_count, watch_count FROM sitreps ORDER BY day DESC LIMIT $1",
				[days],
			);
			res.json({
				ok: true,
				layer: layer || null,
				days,
				depth_days: series.length ? series[0].day : null,
				series,
				sitreps,
			});
		} catch (e: unknown) {
			res.status(500).json({ ok: false, error: String(e).slice(0, 120) });
		}
	});

	// Layer export: CSV or GeoJSON download of the current slice.
	app.get("/api/layers/:layer/export", async (req, res) => {
		const p = LayerParams.safeParse({ layer: req.params.layer });
		const format = String(req.query.format ?? "csv").toLowerCase();
		if (!p.success || !["csv", "geojson"].includes(format)) {
			res
				.status(400)
				.json({ ok: false, error: "bad layer or format=csv|geojson" });
			return;
		}
		const items = (await slice(p.data.layer, 2000)) as {
			id: string;
			ts: string;
			source: string;
			title: string;
			severity: string;
			geom: { coordinates?: number[] } | null;
		}[];
		if (format === "geojson") {
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="thoth-${p.data.layer}.geojson"`,
			);
			res.json({
				type: "FeatureCollection",
				features: items
					.filter((i) => i.geom)
					.map((i) => ({
						type: "Feature",
						geometry: i.geom,
						properties: {
							id: i.id,
							ts: i.ts,
							source: i.source,
							title: i.title,
							severity: i.severity,
						},
					})),
			});
			return;
		}
		const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
		const csv = [
			"id,ts,source,layer,title,severity,lat,lon",
			...items.map((i) =>
				[
					i.id,
					i.ts,
					i.source,
					p.data.layer,
					i.title,
					i.severity,
					i.geom?.coordinates?.[1] ?? "",
					i.geom?.coordinates?.[0] ?? "",
				]
					.map(esc)
					.join(","),
			),
		].join("\n");
		res.setHeader("Content-Type", "text/csv");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="thoth-${p.data.layer}.csv"`,
		);
		res.send(csv);
	});

	// Live SSE: emits layer_changed when layer_versions move, heartbeat 15s.
	app.get("/api/stream", async (req, res) => {
		// Resume: client passes ?known=<base64 JSON {layer:version}> (or Last-Event-ID
		// with the same payload). Server replays every layer that moved since, so a
		// reconnect never silently misses ticks (gate_sse.py pattern).
		let known: Record<string, string> = {};
		const rawKnown =
			(req.query.known as string | undefined) ??
			(req.headers["last-event-id"] as string | undefined);
		if (rawKnown) {
			try {
				const txt = rawKnown.startsWith("{")
					? rawKnown
					: Buffer.from(rawKnown, "base64").toString("utf8");
				const parsed = JSON.parse(txt) as unknown;
				if (parsed && typeof parsed === "object")
					known = parsed as Record<string, string>;
			} catch {
				/* unknown resume state → full catch-up */
			}
		}
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.write(
			`event: connected\ndata: {"ts":"${new Date().toISOString()}","version":"${VERSION}"}\n\n`,
		);
		const last = new Map<string, string>(Object.entries(known));
		let alive = true;
		req.on("close", () => {
			alive = false;
		});
		const timer = setInterval(async () => {
			if (!alive) {
				clearInterval(timer);
				return;
			}
			try {
				const v = await versions();
				const changed = v.filter((r) => last.get(r.layer) !== r.version);
				last.clear();
				for (const r of v) last.set(r.layer, r.version);
				res.write(
					changed.length
						? `event: layer_changed\ndata: ${JSON.stringify({ layers: changed.map((r) => r.layer), versions: changed, ts: new Date().toISOString() })}\n\n`
						: `event: heartbeat\ndata: {"ts":"${new Date().toISOString()}"}\n\n`,
				);
			} catch {
				/* keep stream open on transient DB errors */
			}
		}, 5000);
		try {
			const v = await versions();
			for (const r of v) last.set(r.layer, r.version);
			res.write(
				`event: snapshot\ndata: ${JSON.stringify({ versions: v })}\n\n`,
			);
		} catch {
			/* ignore */
		}
	});
}

// Worker operations (ROADMAP P1): liveness, schedule, run-now queue, feed
// alerts, retention. Everything here is best-effort bookkeeping — a failure
// is logged and retried next tick, never allowed to stop collectors.
import { hostname } from "node:os";
import { isFrozen } from "../api/freeze.js";
import { VERSION } from "../api/shared.js";
import { config } from "../config.js";
import { query } from "../db/client.js";
import { log } from "../lib/logger.js";
import { pushTelegram } from "./lib/push.js";
import { errMsg, flushVersions, storeNormalized } from "./lib/store.js";

export const WORKER_ID = `${hostname()}:${process.pid}`;
const STARTED = new Date();

async function safe(what: string, fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (e: unknown) {
		log.warn(`ops ${what} failed`, { error: errMsg(e) });
	}
}

// ── liveness ──────────────────────────────────────────────────────────────
export function heartbeat(collectors: number) {
	return safe("heartbeat", () =>
		query(
			`INSERT INTO worker_heartbeat(id, host, pid, version, started_at, beat_at, collectors)
			 VALUES ($1,$2,$3,$4,$5, now(), $6)
			 ON CONFLICT (id) DO UPDATE SET beat_at = now(), collectors = EXCLUDED.collectors`,
			[WORKER_ID, hostname(), process.pid, VERSION, STARTED, collectors],
		),
	);
}

// ── schedule ──────────────────────────────────────────────────────────────
export function scheduleInit(
	collector: string,
	intervalSec: number,
	nextDue: Date,
) {
	return safe("schedule", () =>
		query(
			`INSERT INTO collector_schedule(collector, interval_sec, next_due, running)
			 VALUES ($1,$2,$3,false)
			 ON CONFLICT (collector) DO UPDATE SET interval_sec = EXCLUDED.interval_sec,
			   next_due = EXCLUDED.next_due, running = false`,
			[collector, intervalSec, nextDue],
		),
	);
}
export function scheduleStart(collector: string) {
	return safe("schedule", () =>
		query(
			`UPDATE collector_schedule SET last_start = now(), running = true WHERE collector = $1`,
			[collector],
		),
	);
}
export function scheduleEnd(collector: string, nextDue: Date | null) {
	return safe("schedule", () =>
		query(
			`UPDATE collector_schedule SET last_end = now(), running = false,
			   next_due = COALESCE($2, next_due) WHERE collector = $1`,
			[collector, nextDue],
		),
	);
}

// ── run-now queue ─────────────────────────────────────────────────────────
/** Claim open "run now" requests (one per collector; duplicates collapse). */
export async function claimRequests(): Promise<string[]> {
	try {
		const rows = await query<{ collector: string }>(
			`UPDATE collector_requests SET picked_at = now()
			 WHERE id IN (SELECT id FROM collector_requests WHERE picked_at IS NULL
			              ORDER BY requested_at LIMIT 20 FOR UPDATE SKIP LOCKED)
			 RETURNING collector`,
		);
		return [...new Set(rows.map((r) => r.collector))];
	} catch (e: unknown) {
		log.warn("ops claim failed", { error: errMsg(e) });
		return [];
	}
}
export function finishRequests(collector: string) {
	return safe("request", () =>
		query(
			`UPDATE collector_requests SET done_at = now()
			 WHERE collector = $1 AND picked_at IS NOT NULL AND done_at IS NULL`,
			[collector],
		),
	);
}

// ── feed alerts ───────────────────────────────────────────────────────────
// A source failing N runs in a row, or frozen (succeeding with stale
// content), raises an `ops` event: it shows in alerts/brief like any other
// intelligence, and Telegram gets a push when configured. Recovery removes
// it (and pushes once). Event ids are stable so re-checks never duplicate.
type Want = {
	id: string;
	source: string;
	kind: "failing" | "frozen" | "mass";
	severity: "critical" | "watch";
	title: string;
	error: string | null;
	fails: number;
};

export async function desiredAlerts(
	streak = config.ALERT_FAIL_STREAK,
): Promise<Want[]> {
	const out: Want[] = [];
	const fails = await query<{
		source: string;
		n: number;
		bad: number;
		run: number;
		last_error: string | null;
	}>(
		`WITH r AS (
		   SELECT source, ok, error,
		          row_number() OVER (PARTITION BY source ORDER BY ts DESC) AS rn
		   FROM source_runs WHERE ts > now() - interval '7 days')
		 SELECT source,
		   count(*) FILTER (WHERE rn <= $1)::int AS n,
		   count(*) FILTER (WHERE rn <= $1 AND NOT ok)::int AS bad,
		   -- length of the current failure run (for severity)
		   COALESCE(min(rn) FILTER (WHERE ok), count(*) + 1)::int - 1 AS run,
		   max(error) FILTER (WHERE rn = 1) AS last_error
		 FROM r GROUP BY source`,
		[streak],
	);
	for (const f of fails) {
		if (f.n < streak || f.bad < streak) continue;
		out.push({
			id: `ops:failing:${f.source}`,
			source: f.source,
			kind: "failing",
			severity: f.run >= streak * 3 ? "critical" : "watch",
			title: `Feed failing: ${f.source} — ${f.run} runs in a row${f.last_error ? ` · ${f.last_error.slice(0, 120)}` : ""}`,
			error: f.last_error,
			fails: f.run,
		});
	}
	const fh = await query<{
		source: string;
		last_ok: string | null;
		content_ts: string | null;
	}>(`SELECT source, last_ok, content_ts FROM feed_health`);
	const failing = new Set(out.map((w) => w.source));
	for (const f of fh) {
		if (failing.has(f.source)) continue;
		if (!isFrozen(f.source, f.last_ok, f.content_ts)) continue;
		out.push({
			id: `ops:frozen:${f.source}`,
			source: f.source,
			kind: "frozen",
			severity: "watch",
			title: `Feed frozen: ${f.source} — responding, but newest data is from ${String(f.content_ts).slice(0, 16).replace("T", " ")}Z`,
			error: null,
			fails: 0,
		});
	}
	// Mass failure: when a large share of sources fail at once the cause is
	// almost never N separate upstreams — it is egress, DNS, a proxy or a
	// firewall. Raise ONE critical alert for it, cap the per-source ones at
	// watch, and (in checkAlerts) push only the summary, not hundreds.
	const nFailing = out.filter((w) => w.kind === "failing").length;
	const total = fh.length;
	if (nFailing >= Math.max(MASS_MIN, Math.ceil(total * MASS_SHARE))) {
		for (const w of out) if (w.kind === "failing") w.severity = "watch";
		out.push({
			id: "ops:mass",
			source: "*",
			kind: "mass",
			severity: "critical",
			title: `Mass feed failure: ${nFailing} of ${total} sources failing — check the worker's network egress, DNS or proxy`,
			error: null,
			fails: nFailing,
		});
	}
	return out;
}

const MASS_MIN = 10;
const MASS_SHARE = 0.25;

export async function checkAlerts(push = pushTelegram): Promise<{
	raised: string[];
	cleared: string[];
}> {
	const want = await desiredAlerts();
	const have = new Set(
		(
			await query<{ id: string }>(
				`SELECT id FROM events WHERE layer = 'ops' AND source = 'thoth-monitor'`,
			)
		).map((r) => r.id),
	);
	const raised: string[] = [];
	for (const w of want) {
		if (have.has(w.id)) {
			// Still true: refresh the wording, keep the first-seen time.
			await query(
				`UPDATE events SET title = $2, severity = $3, meta = $4, ingested_at = now() WHERE id = $1`,
				[w.id, w.title, w.severity, JSON.stringify({ ...w, id: undefined })],
			);
			continue;
		}
		await storeNormalized({
			id: w.id,
			ts: new Date().toISOString(),
			source: "thoth-monitor",
			layer: "ops",
			title: w.title,
			body: w.error ?? undefined,
			severity: w.severity,
			confidence: 1,
			entities: { source: w.source },
			meta: { source: w.source, kind: w.kind, fails: w.fails },
		});
		raised.push(w.id);
	}
	const keep = new Set(want.map((w) => w.id));
	const cleared = [...have].filter((id) => !keep.has(id));
	if (cleared.length)
		await query(`DELETE FROM events WHERE id = ANY($1::text[])`, [cleared]);
	await flushVersions();
	// During a mass failure only the summary is pushed (and its recovery);
	// per-source noise stays in the alerts tab.
	// …and when a mass failure ends, the individual recoveries that clear
	// with it stay quiet too — one "recovered" message, not hundreds.
	const mass = keep.has("ops:mass") || have.has("ops:mass");
	for (const id of raised) {
		const w = want.find((x) => x.id === id);
		if (w && (!mass || w.kind === "mass")) void push(`THOTH ops · ${w.title}`);
	}
	for (const id of cleared)
		if (!mass || id === "ops:mass")
			void push(
				`THOTH ops · recovered: ${id === "ops:mass" ? "mass feed failure" : id.split(":").slice(2).join(":")}`,
			);
	return { raised, cleared };
}

// ── retention ─────────────────────────────────────────────────────────────
const BATCH = 5000;
const MAX_BATCHES = 40; // ≤200k rows per table per prune; the rest next hour

async function deleteBatched(sql: string, params: unknown[]): Promise<number> {
	let total = 0;
	for (let i = 0; i < MAX_BATCHES; i++) {
		const rows = await query<{ layer?: string }>(sql, params);
		total += rows.length;
		if (rows.length < BATCH) break;
	}
	return total;
}

export async function prune(): Promise<Record<string, number>> {
	const out: Record<string, number> = {};
	const md = config.MONITOR_RETENTION_DAYS;
	for (const [table, col] of [
		["source_runs", "ts"],
		["endpoint_calls", "ts"],
		["collector_runs", "started_at"],
		["collector_requests", "requested_at"],
		["layer_samples", "ts"],
	] as const) {
		out[table] = await deleteBatched(
			`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table}
			   WHERE ${col} < now() - make_interval(days => $1) LIMIT ${BATCH}) RETURNING 1`,
			[md],
		);
	}
	await query(
		`DELETE FROM worker_heartbeat WHERE beat_at < now() - interval '1 day'`,
	);
	if (config.RAW_RETENTION_DAYS > 0)
		out.raw_events = await deleteBatched(
			`DELETE FROM raw_events WHERE id IN (SELECT id FROM raw_events
			   WHERE fetched_at < now() - make_interval(days => $1) LIMIT ${BATCH}) RETURNING 1`,
			[config.RAW_RETENTION_DAYS],
		);
	if (config.EVENTS_RETENTION_DAYS > 0) {
		// Only rows neither observed nor re-seen in the window; static
		// catalogs and live ops alerts are never pruned.
		out.events = await deleteBatched(
			`DELETE FROM events WHERE id IN (SELECT id FROM events
			   WHERE ts < now() - make_interval(days => $1)
			     AND ingested_at < now() - make_interval(days => $1)
			     AND source <> 'static' AND layer <> 'ops'
			   LIMIT ${BATCH}) RETURNING layer`,
			[config.EVENTS_RETENTION_DAYS],
		);
	}
	return out;
}

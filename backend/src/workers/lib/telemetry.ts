// Run telemetry (ROADMAP P1): every collector run and every upstream HTTP
// call it makes, recorded for the monitor. A run opens an AsyncLocalStorage
// context; the instrumented global fetch appends one record per call while
// a context is active (so tests that call collect() directly, with no run
// open, record nothing). Records flush in one batch when the run ends.
import { AsyncLocalStorage } from "node:async_hooks";
import { query } from "../../db/client.js";
import { log } from "../../lib/logger.js";
import { errMsg } from "./store.js";

export type Call = {
	ts: Date;
	host: string;
	path: string;
	status: number | null;
	ms: number;
	bytes: number | null;
	error: string | null;
};
type RunCtx = { collector: string; calls: Call[] };

const ctx = new AsyncLocalStorage<RunCtx>();
const MAX_CALLS_PER_RUN = 500;

/** Upstream path safe to store: no query string, credential-looking
 * segments masked (Telegram bot tokens, long opaque keys, e-mails). */
export function redactPath(pathname: string): string {
	return (
		pathname
			.split("/")
			.map((seg) => {
				if (/^bot\d+:[\w-]+$/.test(seg)) return "bot***";
				if (/@/.test(seg)) return "***";
				if (seg.length >= 32 && /^[\w.~%-]+$/.test(seg)) return "***";
				return seg;
			})
			.join("/")
			.slice(0, 200) || "/"
	);
}

function describe(input: unknown): { host: string; path: string } | null {
	try {
		const u = new URL(
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: (input as Request).url,
		);
		return { host: u.host, path: redactPath(u.pathname) };
	} catch {
		return null;
	}
}

let installed = false;
/** Wrap globalThis.fetch once (worker process only). Calls made outside a
 * run pass straight through. */
export function instrumentFetch(): void {
	if (installed) return;
	installed = true;
	const orig = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const run = ctx.getStore();
		const d = run ? describe(input) : null;
		if (!run || !d) return orig(input, init);
		const t0 = performance.now();
		const ts = new Date();
		try {
			const res = await orig(input, init);
			const len = Number(res.headers.get("content-length"));
			record(run, {
				ts,
				...d,
				status: res.status,
				ms: Math.round(performance.now() - t0),
				bytes: Number.isFinite(len) && len > 0 ? len : null,
				error: null,
			});
			return res;
		} catch (e: unknown) {
			record(run, {
				ts,
				...d,
				status: null,
				ms: Math.round(performance.now() - t0),
				bytes: null,
				error: errMsg(e).slice(0, 300),
			});
			throw e;
		}
	}) as typeof fetch;
}

function record(run: RunCtx, c: Call) {
	if (run.calls.length < MAX_CALLS_PER_RUN) run.calls.push(c);
}

export type RunOutcome = {
	ok: boolean;
	count: number | null;
	error: string | null;
};

/** Collector result → outcome. Collectors return {ok, count|error} by
 * contract; anything else counts as success with no count. */
export function outcomeOf(res: unknown): RunOutcome {
	const r = (res ?? {}) as Record<string, unknown>;
	const ok = r.ok !== false;
	const count = typeof r.count === "number" ? r.count : null;
	const error = ok ? null : String(r.error ?? "failed").slice(0, 500);
	return { ok, count, error };
}

/** Run `fn` as one recorded collector run: timing, outcome, upstream calls. */
export async function withRun<T>(
	collector: string,
	trigger: "schedule" | "manual" | "once",
	fn: () => Promise<T>,
): Promise<T> {
	const run: RunCtx = { collector, calls: [] };
	const startedAt = new Date();
	const t0 = performance.now();
	let out: RunOutcome = { ok: false, count: null, error: "crashed" };
	try {
		const res = await ctx.run(run, fn);
		out = outcomeOf(res);
		return res;
	} catch (e: unknown) {
		out = { ok: false, count: null, error: errMsg(e).slice(0, 500) };
		throw e;
	} finally {
		await persist(
			run,
			startedAt,
			Math.round(performance.now() - t0),
			out,
			trigger,
		);
	}
}

async function persist(
	run: RunCtx,
	startedAt: Date,
	ms: number,
	out: RunOutcome,
	trigger: string,
) {
	try {
		await query(
			`INSERT INTO collector_runs(collector, started_at, ms, ok, count, error, trigger)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			[run.collector, startedAt, ms, out.ok, out.count, out.error, trigger],
		);
		if (run.calls.length) {
			// One multi-row insert per run (unnest keeps it a single statement).
			const c = run.calls;
			await query(
				`INSERT INTO endpoint_calls(ts, collector, host, path, status, ms, bytes, error)
				 SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[],
				                      $5::int[], $6::int[], $7::bigint[], $8::text[])`,
				[
					c.map((x) => x.ts),
					c.map(() => run.collector),
					c.map((x) => x.host),
					c.map((x) => x.path),
					c.map((x) => x.status),
					c.map((x) => x.ms),
					c.map((x) => x.bytes),
					c.map((x) => x.error),
				],
			);
		}
	} catch (e: unknown) {
		// Telemetry must never take a collector down with it.
		log.warn("telemetry persist failed", {
			collector: run.collector,
			error: errMsg(e),
		});
	}
}

// Monitor data (ROADMAP P1): per-source history, per-collector cadence,
// per-endpoint health, worker liveness. Shared by the JSON routes and the
// Prometheus /metrics exposition so both always agree. Results are memoised
// for a few seconds — the monitor polls, and these scan a week of history.
import { config } from "../config.js";
import { query } from "../db/client.js";
import { COLLECTORS } from "../workers/registry.js";
import { isFrozen } from "./freeze.js";
import { SOURCE_MAP } from "./source-map.js";

const TTL_MS = 10_000;
const memo = new Map<string, { at: number; v: Promise<unknown> }>();
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const hit = memo.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.v as Promise<T>;
	const v = fn();
	memo.set(key, { at: Date.now(), v });
	v.catch(() => memo.delete(key));
	return v;
}
/** Tests and "run now" want fresh numbers. */
export function clearMonitorCache() {
	memo.clear();
}

const WORKER_STALE_MS = 60_000;

export type WorkerState = {
	alive: boolean;
	id: string | null;
	beat_at: string | null;
	started_at: string | null;
	version: string | null;
	collectors: number | null;
};

export function workerState(): Promise<WorkerState> {
	return cached("worker", async () => {
		const r = await query<{
			id: string;
			beat_at: string;
			started_at: string;
			version: string | null;
			collectors: number | null;
		}>(
			`SELECT id, beat_at, started_at, version, collectors FROM worker_heartbeat
			 ORDER BY beat_at DESC LIMIT 1`,
		);
		const w = r[0];
		if (!w)
			return {
				alive: false,
				id: null,
				beat_at: null,
				started_at: null,
				version: null,
				collectors: null,
			};
		return {
			...w,
			alive: Date.now() - new Date(w.beat_at).getTime() < WORKER_STALE_MS,
		};
	});
}

export type SourceRow = {
	source: string;
	collector: string | null;
	interval_sec: number | null;
	state: "ok" | "failing" | "frozen" | "stale" | "warming";
	last_ok: string | null;
	last_attempt: string | null;
	content_ts: string | null;
	first_ok_at: string | null;
	error: string | null;
	runs24: number;
	ok24: number;
	runs7: number;
	ok7: number;
	fail_streak: number;
	/** newest first, "1" ok / "0" failed, up to 48 */
	strip: string;
	next_due: string | null;
	running: boolean;
};

export function sources(): Promise<SourceRow[]> {
	return cached("sources", async () => {
		const [fh, hist, sched] = await Promise.all([
			query<{
				source: string;
				last_ok: string | null;
				last_attempt: string | null;
				error: string | null;
				content_ts: string | null;
				first_ok_at: string | null;
			}>(
				`SELECT source, last_ok, last_attempt, error, content_ts, first_ok_at
				 FROM feed_health ORDER BY source`,
			),
			query<{
				source: string;
				runs24: number;
				ok24: number;
				runs7: number;
				ok7: number;
				fail_streak: number;
				strip: string | null;
			}>(
				`WITH r AS (
				   SELECT source, ok, ts,
				          row_number() OVER (PARTITION BY source ORDER BY ts DESC) AS rn
				   FROM source_runs WHERE ts > now() - interval '7 days')
				 SELECT source,
				   count(*) FILTER (WHERE ts > now() - interval '24 hours')::int AS runs24,
				   count(*) FILTER (WHERE ok AND ts > now() - interval '24 hours')::int AS ok24,
				   count(*)::int AS runs7,
				   count(*) FILTER (WHERE ok)::int AS ok7,
				   COALESCE(min(rn) FILTER (WHERE ok), count(*) + 1)::int - 1 AS fail_streak,
				   string_agg(CASE WHEN ok THEN '1' ELSE '0' END, '' ORDER BY ts DESC)
				     FILTER (WHERE rn <= 48) AS strip
				 FROM r GROUP BY source`,
			),
			query<{ collector: string; next_due: string | null; running: boolean }>(
				`SELECT collector, next_due, running FROM collector_schedule`,
			),
		]);
		const h = new Map(hist.map((x) => [x.source, x]));
		const s = new Map(sched.map((x) => [x.collector, x]));
		const streak = config.ALERT_FAIL_STREAK;
		return fh.map((f): SourceRow => {
			const meta = SOURCE_MAP[f.source] ?? null;
			const x = h.get(f.source);
			const sc = meta ? s.get(meta.collector) : undefined;
			const failStreak = x?.fail_streak ?? 0;
			const state: SourceRow["state"] =
				failStreak >= streak
					? "failing"
					: isFrozen(f.source, f.last_ok, f.content_ts)
						? "frozen"
						: f.last_ok
							? "ok"
							: !f.first_ok_at && !f.error
								? "warming"
								: "stale";
			return {
				...f,
				collector: meta?.collector ?? null,
				interval_sec: meta?.intervalSec ?? null,
				state,
				runs24: x?.runs24 ?? 0,
				ok24: x?.ok24 ?? 0,
				runs7: x?.runs7 ?? 0,
				ok7: x?.ok7 ?? 0,
				fail_streak: failStreak,
				strip: x?.strip ?? "",
				next_due: sc?.next_due ?? null,
				running: sc?.running ?? false,
			};
		});
	});
}

export type CollectorRow = {
	collector: string;
	interval_sec: number;
	sources: string[];
	last_start: string | null;
	last_end: string | null;
	next_due: string | null;
	running: boolean;
	runs24: number;
	ok24: number;
	p50_ms: number | null;
	p95_ms: number | null;
	last_run_at: string | null;
	last_ok: boolean | null;
	last_ms: number | null;
	last_count: number | null;
	last_error: string | null;
	queued: boolean;
};

export function collectors(): Promise<CollectorRow[]> {
	return cached("collectors", async () => {
		const names = Object.keys(COLLECTORS);
		const rows = await query<Omit<CollectorRow, "interval_sec" | "sources">>(
			`SELECT c.collector, s.last_start, s.last_end, s.next_due,
			        COALESCE(s.running, false) AS running,
			        COALESCE(r.runs24, 0) AS runs24, COALESCE(r.ok24, 0) AS ok24,
			        r.p50_ms, r.p95_ms,
			        lr.started_at AS last_run_at, lr.ok AS last_ok, lr.ms AS last_ms,
			        lr.count AS last_count, lr.error AS last_error,
			        EXISTS (SELECT 1 FROM collector_requests q
			                WHERE q.collector = c.collector AND q.done_at IS NULL) AS queued
			 FROM unnest($1::text[]) AS c(collector)
			 LEFT JOIN collector_schedule s ON s.collector = c.collector
			 LEFT JOIN LATERAL (
			   SELECT count(*)::int AS runs24, count(*) FILTER (WHERE ok)::int AS ok24,
			          percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)::int AS p50_ms,
			          percentile_cont(0.95) WITHIN GROUP (ORDER BY ms)::int AS p95_ms
			   FROM collector_runs
			   WHERE collector = c.collector AND started_at > now() - interval '24 hours') r ON true
			 LEFT JOIN LATERAL (
			   SELECT started_at, ok, ms, count, error FROM collector_runs
			   WHERE collector = c.collector ORDER BY started_at DESC LIMIT 1) lr ON true
			 ORDER BY c.collector`,
			[names],
		);
		const bySrc = new Map<string, string[]>();
		for (const [src, m] of Object.entries(SOURCE_MAP)) {
			const l = bySrc.get(m.collector) ?? [];
			l.push(src);
			bySrc.set(m.collector, l);
		}
		return rows.map((r) => ({
			...r,
			interval_sec:
				COLLECTORS[r.collector as keyof typeof COLLECTORS].intervalSec,
			sources: (bySrc.get(r.collector) ?? []).sort(),
		}));
	});
}

export type EndpointRow = {
	host: string;
	calls: number;
	errors: number;
	p50_ms: number | null;
	p95_ms: number | null;
	last_ts: string;
	last_status: number | null;
	last_error: string | null;
	collectors: string[];
};

export function endpoints(): Promise<EndpointRow[]> {
	return cached("endpoints", () =>
		query<EndpointRow>(
			`SELECT host,
			   count(*)::int AS calls,
			   count(*) FILTER (WHERE status IS NULL OR status >= 400)::int AS errors,
			   percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)::int AS p50_ms,
			   percentile_cont(0.95) WITHIN GROUP (ORDER BY ms)::int AS p95_ms,
			   max(ts) AS last_ts,
			   (array_agg(status ORDER BY ts DESC))[1] AS last_status,
			   (array_agg(COALESCE(error, 'HTTP ' || status) ORDER BY ts DESC)
			      FILTER (WHERE status IS NULL OR status >= 400))[1] AS last_error,
			   array_agg(DISTINCT collector) FILTER (WHERE collector IS NOT NULL) AS collectors
			 FROM endpoint_calls WHERE ts > now() - interval '24 hours'
			 GROUP BY host ORDER BY errors DESC, calls DESC`,
		),
	);
}

export async function sourceDetail(source: string) {
	const meta = SOURCE_MAP[source] ?? null;
	const [runs, errors, events, hosts] = await Promise.all([
		query<{ ts: string; ok: boolean; error: string | null }>(
			`SELECT ts, ok, error FROM source_runs WHERE source = $1 ORDER BY ts DESC LIMIT 48`,
			[source],
		),
		query<{ error: string; n: number; last: string }>(
			`SELECT error, count(*)::int AS n, max(ts) AS last FROM source_runs
			 WHERE source = $1 AND NOT ok AND error IS NOT NULL
			   AND ts > now() - interval '7 days'
			 GROUP BY error ORDER BY last DESC LIMIT 10`,
			[source],
		),
		query<{ id: string; ts: string; layer: string; title: string | null }>(
			`SELECT id, ts, layer, title FROM events WHERE source = $1 ORDER BY ts DESC LIMIT 5`,
			[source],
		),
		meta
			? query<{
					host: string;
					path: string;
					calls: number;
					errors: number;
					p95_ms: number | null;
					last_status: number | null;
				}>(
					`SELECT host, path, count(*)::int AS calls,
					   count(*) FILTER (WHERE status IS NULL OR status >= 400)::int AS errors,
					   percentile_cont(0.95) WITHIN GROUP (ORDER BY ms)::int AS p95_ms,
					   (array_agg(status ORDER BY ts DESC))[1] AS last_status
					 FROM endpoint_calls
					 WHERE collector = $1 AND ts > now() - interval '24 hours'
					 GROUP BY host, path ORDER BY calls DESC LIMIT 15`,
					[meta.collector],
				)
			: Promise.resolve([]),
	]);
	const row = (await sources()).find((s) => s.source === source) ?? null;
	return { source, row, collector: meta, runs, errors, events, hosts };
}

/** Keyed collectors: which env var enables them, and whether it is set. */
const KEYED: Record<string, string> = {
	otx: "OTX_API_KEY",
	finnhub: "FINNHUB_KEY",
};

export function catalog() {
	return cached("catalog", async () => {
		const [hosts, layers] = await Promise.all([
			query<{ collector: string; hosts: string[] }>(
				`SELECT collector, array_agg(DISTINCT host ORDER BY host) AS hosts
				 FROM endpoint_calls WHERE ts > now() - interval '7 days' AND collector IS NOT NULL
				 GROUP BY collector`,
			),
			query<{ source: string; layer: string }>(
				`SELECT DISTINCT ON (source) source, layer FROM raw_events
				 WHERE fetched_at > now() - interval '14 days'
				 ORDER BY source, fetched_at DESC`,
			),
		]);
		const h = new Map(hosts.map((x) => [x.collector, x.hosts]));
		const l = new Map(layers.map((x) => [x.source, x.layer]));
		const cols = await collectors();
		return cols.map((c) => ({
			collector: c.collector,
			interval_sec: c.interval_sec,
			key: KEYED[c.collector] ?? null,
			key_set: KEYED[c.collector]
				? Boolean((config as Record<string, unknown>)[KEYED[c.collector]])
				: null,
			hosts: h.get(c.collector) ?? [],
			sources: c.sources.map((s) => ({ source: s, layer: l.get(s) ?? null })),
		}));
	});
}

export function summary() {
	return cached("summary", async () => {
		const [worker, src, db, alerts] = await Promise.all([
			workerState(),
			sources(),
			query<{ size: string; events: string; raw: string }>(
				`SELECT pg_database_size(current_database())::text AS size,
				   (SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE relname = 'events')::text AS events,
				   (SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE relname = 'raw_events')::text AS raw`,
			),
			query<{ severity: string; n: number }>(
				`SELECT severity, count(*)::int AS n FROM events WHERE layer = 'ops' GROUP BY severity`,
			),
		]);
		const count = (st: SourceRow["state"]) =>
			src.filter((s) => s.state === st).length;
		return {
			worker,
			sources: {
				total: src.length,
				ok: count("ok"),
				failing: count("failing"),
				frozen: count("frozen"),
				stale: count("stale"),
				warming: count("warming"),
			},
			collectors: Object.keys(COLLECTORS).length,
			alerts: Object.fromEntries(alerts.map((a) => [a.severity, a.n])),
			db: {
				size_bytes: Number(db[0]?.size ?? 0),
				events_est: Number(db[0]?.events ?? 0),
				raw_events_est: Number(db[0]?.raw ?? 0),
			},
			retention: {
				monitor_days: config.MONITOR_RETENTION_DAYS,
				raw_days: config.RAW_RETENTION_DAYS,
				events_days: config.EVENTS_RETENTION_DAYS,
			},
			alert_fail_streak: config.ALERT_FAIL_STREAK,
		};
	});
}

// ── Prometheus exposition ─────────────────────────────────────────────────
const esc = (v: string) =>
	v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const epoch = (t: string | null) =>
	t ? Math.round(new Date(t).getTime() / 1000) : null;

export async function metricsText(): Promise<string> {
	const [sm, src, cols, eps] = await Promise.all([
		summary(),
		sources(),
		collectors(),
		endpoints(),
	]);
	const out: string[] = [];
	const metric = (
		name: string,
		help: string,
		rows: [Record<string, string>, number | null][],
	) => {
		out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
		for (const [labels, v] of rows) {
			if (v === null || !Number.isFinite(v)) continue;
			const l = Object.entries(labels)
				.map(([k, x]) => `${k}="${esc(x)}"`)
				.join(",");
			out.push(`${name}${l ? `{${l}}` : ""} ${v}`);
		}
	};
	metric("thoth_worker_up", "Worker heartbeat seen in the last 60s.", [
		[{}, sm.worker.alive ? 1 : 0],
	]);
	metric("thoth_db_size_bytes", "Database size.", [[{}, sm.db.size_bytes]]);
	metric(
		"thoth_ops_alerts",
		"Open feed alerts by severity.",
		Object.entries(sm.alerts).map(([s, n]) => [{ severity: s }, n as number]),
	);
	const lab = (s: SourceRow) => ({
		source: s.source,
		collector: s.collector ?? "",
	});
	metric(
		"thoth_source_up",
		"1 when the source is healthy (ok), 0 otherwise.",
		src.map((s) => [lab(s), s.state === "ok" ? 1 : 0]),
	);
	metric(
		"thoth_source_fail_streak",
		"Consecutive failed runs.",
		src.map((s) => [lab(s), s.fail_streak]),
	);
	metric(
		"thoth_source_success_ratio_24h",
		"Successful runs / runs over 24h.",
		src.map((s) => [lab(s), s.runs24 ? s.ok24 / s.runs24 : null]),
	);
	metric(
		"thoth_source_last_success_timestamp_seconds",
		"Last successful run.",
		src.map((s) => [lab(s), epoch(s.last_ok)]),
	);
	metric(
		"thoth_source_content_timestamp_seconds",
		"Newest observation stored.",
		src.map((s) => [lab(s), epoch(s.content_ts)]),
	);
	metric(
		"thoth_collector_run_p95_ms",
		"95th percentile run duration over 24h.",
		cols.map((c) => [{ collector: c.collector }, c.p95_ms]),
	);
	metric(
		"thoth_collector_next_due_timestamp_seconds",
		"When the collector is next due.",
		cols.map((c) => [{ collector: c.collector }, epoch(c.next_due)]),
	);
	metric(
		"thoth_endpoint_calls_24h",
		"Upstream calls per host over 24h.",
		eps.map((e) => [{ host: e.host }, e.calls]),
	);
	metric(
		"thoth_endpoint_errors_24h",
		"Upstream failures (network or HTTP >= 400) per host over 24h.",
		eps.map((e) => [{ host: e.host }, e.errors]),
	);
	metric(
		"thoth_endpoint_latency_p95_ms",
		"95th percentile upstream latency per host over 24h.",
		eps.map((e) => [{ host: e.host }, e.p95_ms]),
	);
	return `${out.join("\n")}\n`;
}

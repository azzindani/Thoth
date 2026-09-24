"use client";
// Server monitor v2 (ROADMAP P1). Three views over the operational history:
// SOURCES (state, 48-run strip, success rate, streak, freshness, next due;
// click for detail: errors, endpoints, latest rows), COLLECTORS (cadence,
// last run, p95, run now), ENDPOINTS (per upstream host: calls, errors,
// latency, last status). Refreshes every 15s while open. Fail honest:
// unknown sources render ungrouped, never dropped.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type MonCollector,
	type MonEndpoint,
	type MonSource,
	type MonSourceDetail,
	type MonSummary,
	monitor,
	type SourceState,
} from "../lib/api";
import { ageStr, fmtCadence } from "../lib/ui";
import { type Column, DataTable } from "./DataTable";

const REFRESH_MS = 15000;

const STATE_COLOR: Record<SourceState, string> = {
	ok: "var(--txt2)",
	failing: "var(--red)",
	frozen: "var(--red)",
	stale: "var(--amber)",
	warming: "var(--dim)",
};

/** "in 3m" / "overdue 12m" relative to now. */
function dueStr(t: string | null, running = false): string {
	if (running) return "running";
	if (!t) return "—";
	const d = Math.round((Date.parse(t) - Date.now()) / 1000);
	const f = (s: number) =>
		s < 60
			? `${s}s`
			: s < 3600
				? `${Math.round(s / 60)}m`
				: `${Math.round(s / 3600)}h`;
	return d >= 0 ? `in ${f(d)}` : `overdue ${f(-d)}`;
}
const pct = (ok: number, n: number) =>
	n ? `${Math.round((ok / n) * 100)}%` : "—";
const ms = (v: number | null) =>
	v == null ? "—" : v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(1)}s`;
const mb = (b: number) =>
	b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`;

/** Last runs, oldest → newest left to right; red ticks are failures. */
function Strip({ s }: { s: string }) {
	const ticks = [...s].reverse();
	return (
		<span
			className="mon-strip"
			role="img"
			aria-label={`last ${ticks.length} runs: ${ticks.filter((t) => t === "0").length} failed`}
		>
			{ticks.map((t, i) => (
				<i key={i} className={`mon-tick ${t === "1" ? "ok" : "bad"}`} />
			))}
		</span>
	);
}

function RunNow({ collector }: { collector: string }) {
	const [st, setSt] = useState<"" | "queued" | "err">("");
	return (
		<button
			type="button"
			className="ghost-btn mon-run"
			disabled={st === "queued"}
			title={`Run the ${collector} collector now`}
			onClick={async (e) => {
				e.stopPropagation();
				try {
					await monitor.runNow(collector);
					setSt("queued");
				} catch {
					setSt("err");
				}
			}}
		>
			{st === "queued" ? "QUEUED" : st === "err" ? "RETRY" : "RUN NOW"}
		</button>
	);
}

function SourceDetail({ source }: { source: string }) {
	const [d, setD] = useState<MonSourceDetail | null>(null);
	const [err, setErr] = useState(false);
	useEffect(() => {
		monitor
			.source(source)
			.then(setD)
			.catch(() => setErr(true));
	}, [source]);
	if (err) return <div className="mon-detail dim">detail unavailable</div>;
	if (!d) return <div className="mon-detail dim">loading…</div>;
	return (
		<div className="mon-detail">
			{d.collector && (
				<div className="mon-dline">
					collector <b>{d.collector.collector}</b> · every{" "}
					{fmtCadence(d.collector.intervalSec)}{" "}
					<RunNow collector={d.collector.collector} />
				</div>
			)}
			{d.errors.length > 0 && (
				<>
					<div className="mon-sub">Errors · 7 days</div>
					{d.errors.map((e) => (
						<div key={e.error} className="mon-dline">
							<span className="mon-err">{e.error}</span>
							<span className="dim">
								{" "}
								×{e.n} · last {ageStr(e.last)}
							</span>
						</div>
					))}
				</>
			)}
			{d.hosts.length > 0 && (
				<>
					<div className="mon-sub">Endpoints · 24h</div>
					{d.hosts.map((h) => (
						<div key={`${h.host}${h.path}`} className="mon-dline mono">
							<span className={h.errors ? "mon-err" : ""}>
								{h.last_status ?? "ERR"}
							</span>{" "}
							{h.host}
							<span className="dim">{h.path}</span> · {h.calls} calls ·{" "}
							{h.errors} err · p95 {ms(h.p95_ms)}
						</div>
					))}
				</>
			)}
			{d.events.length > 0 && (
				<>
					<div className="mon-sub">Latest rows</div>
					{d.events.map((e) => (
						<div key={e.id} className="mon-dline">
							<span className="dim">{ageStr(e.ts)} · </span>
							{e.title ?? e.id}
						</div>
					))}
				</>
			)}
		</div>
	);
}

type View = "sources" | "collectors" | "endpoints";

const STATE_RANK: Record<SourceState, number> = {
	failing: 0,
	frozen: 1,
	stale: 2,
	warming: 3,
	ok: 4,
};
const ts = (t: string | null) => (t ? Date.parse(t) : null);
const ratio = (ok: number, n: number) => (n ? ok / n : null);
const WIDE_KEY = "thoth.monWide";
const matches = (needle: string, ...xs: (string | null | undefined)[]) =>
	!needle || xs.some((x) => (x ?? "").toLowerCase().includes(needle));

/** Desk: the monitor is a data grid, so the inspector widens while it is
 * open (body.insp-wide; the camera padding follows). Remembered. */
function useWide(): [boolean, (v: boolean) => void] {
	const [wide, setWide] = useState(true);
	useEffect(() => {
		try {
			const v = localStorage.getItem(WIDE_KEY);
			if (v !== null) setWide(v === "1");
		} catch {
			/* default wide */
		}
	}, []);
	useEffect(() => {
		document.body.classList.toggle("insp-wide", wide);
		try {
			localStorage.setItem(WIDE_KEY, wide ? "1" : "0");
		} catch {
			/* not persisted */
		}
		return () => document.body.classList.remove("insp-wide");
	}, [wide]);
	return [wide, setWide];
}

export function MonitorTab() {
	const [view, setView] = useState<View>("sources");
	const [sum, setSum] = useState<MonSummary | null>(null);
	const [src, setSrc] = useState<MonSource[] | null>(null);
	const [cols, setCols] = useState<MonCollector[] | null>(null);
	const [eps, setEps] = useState<MonEndpoint[] | null>(null);
	const [q, setQ] = useState("");
	const [issues, setIssues] = useState(false);
	const [open, setOpen] = useState<string | null>(null);
	const [wide, setWide] = useWide();

	const load = useCallback(async () => {
		const [s, a, c, e] = await Promise.allSettled([
			monitor.summary(),
			monitor.sources(),
			monitor.collectors(),
			monitor.endpoints(),
		]);
		if (s.status === "fulfilled") setSum(s.value);
		setSrc(a.status === "fulfilled" ? a.value.items : []);
		if (c.status === "fulfilled") setCols(c.value.items);
		if (e.status === "fulfilled") setEps(e.value.items);
	}, []);
	useEffect(() => {
		void load();
		const t = setInterval(() => void load(), REFRESH_MS);
		return () => clearInterval(t);
	}, [load]);

	const needle = q.trim().toLowerCase();
	const srcRows = useMemo(
		() =>
			(src ?? []).filter(
				(f) =>
					!(issues && f.state === "ok") &&
					matches(needle, f.source, f.collector),
			),
		[src, issues, needle],
	);
	const colRows = useMemo(
		() =>
			(cols ?? []).filter(
				(c) =>
					!(issues && c.last_ok !== false) &&
					matches(needle, c.collector, ...c.sources),
			),
		[cols, issues, needle],
	);
	const epRows = useMemo(
		() =>
			(eps ?? []).filter(
				(e) =>
					!(issues && e.errors === 0) &&
					matches(needle, e.host, ...(e.collectors ?? [])),
			),
		[eps, issues, needle],
	);

	const sourceCols: Column<MonSource>[] = [
		{
			key: "state",
			label: "State",
			sort: (f) => STATE_RANK[f.state],
			render: (f) => (
				<span className="mon-state" style={{ color: STATE_COLOR[f.state] }}>
					● {f.state.toUpperCase()}
				</span>
			),
		},
		{
			key: "source",
			label: "Source",
			sort: (f) => f.source,
			render: (f) => <b className="dt-key">{f.source}</b>,
		},
		{
			key: "collector",
			label: "Collector",
			wide: true,
			sort: (f) => f.collector ?? "~",
			render: (f) => <span className="dim">{f.collector ?? "—"}</span>,
		},
		{
			key: "runs",
			label: "Last 48 runs",
			wide: true,
			render: (f) => <Strip s={f.strip} />,
		},
		{
			key: "ok24",
			label: "24h",
			num: true,
			title: "successful runs over 24h",
			sort: (f) => ratio(f.ok24, f.runs24),
			render: (f) => pct(f.ok24, f.runs24),
		},
		{
			key: "ok7",
			label: "7d",
			num: true,
			wide: true,
			title: "successful runs over 7 days",
			sort: (f) => ratio(f.ok7, f.runs7),
			render: (f) => pct(f.ok7, f.runs7),
		},
		{
			key: "streak",
			label: "Fails",
			num: true,
			title: "failed runs in a row",
			sort: (f) => f.fail_streak,
			render: (f) =>
				f.fail_streak ? (
					<span className="mon-err">{f.fail_streak}×</span>
				) : (
					<span className="dim">0</span>
				),
		},
		{
			key: "last_ok",
			label: "Last OK",
			num: true,
			sort: (f) => ts(f.last_ok),
			render: (f) => (f.last_ok ? ageStr(f.last_ok) : "never"),
		},
		{
			key: "data",
			label: "Data age",
			num: true,
			wide: true,
			title: "newest observation stored",
			sort: (f) => ts(f.content_ts),
			render: (f) => (f.content_ts ? ageStr(f.content_ts) : "—"),
		},
		{
			key: "every",
			label: "Every",
			num: true,
			wide: true,
			sort: (f) => f.interval_sec,
			render: (f) =>
				f.interval_sec != null ? fmtCadence(f.interval_sec) : "—",
		},
		{
			key: "next",
			label: "Next",
			num: true,
			sort: (f) => ts(f.next_due),
			render: (f) => dueStr(f.next_due, f.running),
		},
		{
			key: "error",
			label: "Last error",
			wide: true,
			render: (f) =>
				f.error ? <span className="mon-err dt-clip">{f.error}</span> : "",
		},
	];

	const collectorCols: Column<MonCollector>[] = [
		{
			key: "result",
			label: "Result",
			sort: (c) => (c.last_ok == null ? 2 : c.last_ok ? 1 : 0),
			render: (c) => (
				<span
					className="mon-state"
					style={{
						color:
							c.last_ok == null
								? "var(--dim)"
								: c.last_ok
									? "var(--txt2)"
									: "var(--red)",
					}}
				>
					● {c.last_ok == null ? "—" : c.last_ok ? "OK" : "FAILED"}
				</span>
			),
		},
		{
			key: "collector",
			label: "Collector",
			sort: (c) => c.collector,
			render: (c) => <b className="dt-key">{c.collector}</b>,
		},
		{
			key: "every",
			label: "Every",
			num: true,
			sort: (c) => c.interval_sec,
			render: (c) => fmtCadence(c.interval_sec),
		},
		{
			key: "ran",
			label: "Last run",
			num: true,
			sort: (c) => ts(c.last_run_at),
			render: (c) => (c.last_run_at ? ageStr(c.last_run_at) : "never"),
		},
		{
			key: "dur",
			label: "Took",
			num: true,
			wide: true,
			sort: (c) => c.last_ms,
			render: (c) => ms(c.last_ms),
		},
		{
			key: "rows",
			label: "Rows",
			num: true,
			wide: true,
			sort: (c) => c.last_count,
			render: (c) => c.last_count ?? "—",
		},
		{
			key: "ok24",
			label: "24h",
			num: true,
			sort: (c) => ratio(c.ok24, c.runs24),
			render: (c) => pct(c.ok24, c.runs24),
		},
		{
			key: "p50",
			label: "p50",
			num: true,
			wide: true,
			sort: (c) => c.p50_ms,
			render: (c) => ms(c.p50_ms),
		},
		{
			key: "p95",
			label: "p95",
			num: true,
			wide: true,
			sort: (c) => c.p95_ms,
			render: (c) => ms(c.p95_ms),
		},
		{
			key: "next",
			label: "Next",
			num: true,
			sort: (c) => ts(c.next_due),
			render: (c) => dueStr(c.next_due, c.running),
		},
		{
			key: "sources",
			label: "Sources",
			num: true,
			wide: true,
			sort: (c) => c.sources.length,
			render: (c) => c.sources.length,
		},
		{
			key: "error",
			label: "Last error",
			wide: true,
			render: (c) =>
				c.last_error && c.last_ok === false ? (
					<span className="mon-err dt-clip">{c.last_error}</span>
				) : (
					""
				),
		},
		{
			key: "run",
			label: "",
			render: (c) => <RunNow collector={c.collector} />,
		},
	];

	const endpointCols: Column<MonEndpoint>[] = [
		{
			key: "status",
			label: "Last",
			sort: (e) => e.last_status ?? 0,
			render: (e) => (
				<span
					className="mono"
					style={{ color: e.errors ? "var(--red)" : "var(--txt2)" }}
				>
					{e.last_status ?? "ERR"}
				</span>
			),
		},
		{
			key: "host",
			label: "Host",
			sort: (e) => e.host,
			render: (e) => <b className="dt-key">{e.host}</b>,
		},
		{
			key: "calls",
			label: "Calls 24h",
			num: true,
			sort: (e) => e.calls,
			render: (e) => e.calls,
		},
		{
			key: "ok",
			label: "OK",
			num: true,
			sort: (e) => ratio(e.calls - e.errors, e.calls),
			render: (e) => pct(e.calls - e.errors, e.calls),
		},
		{
			key: "errors",
			label: "Errors",
			num: true,
			wide: true,
			sort: (e) => e.errors,
			render: (e) =>
				e.errors ? <span className="mon-err">{e.errors}</span> : 0,
		},
		{
			key: "p50",
			label: "p50",
			num: true,
			wide: true,
			sort: (e) => e.p50_ms,
			render: (e) => ms(e.p50_ms),
		},
		{
			key: "p95",
			label: "p95",
			num: true,
			sort: (e) => e.p95_ms,
			render: (e) => ms(e.p95_ms),
		},
		{
			key: "seen",
			label: "Last call",
			num: true,
			wide: true,
			sort: (e) => ts(e.last_ts),
			render: (e) => ageStr(e.last_ts),
		},
		{
			key: "collectors",
			label: "Used by",
			wide: true,
			render: (e) => (
				<span className="dim">{(e.collectors ?? []).join(", ")}</span>
			),
		},
		{
			key: "error",
			label: "Last error",
			wide: true,
			render: (e) =>
				e.last_error && e.errors ? (
					<span className="mon-err dt-clip">{e.last_error}</span>
				) : (
					""
				),
		},
	];

	if (!src) return <div className="dim">loading monitor…</div>;
	const s = sum?.sources;
	return (
		<>
			<div className="mon-head">
				<h3>
					MONITOR · {s?.ok ?? src.filter((f) => f.state === "ok").length}/
					{src.length} LIVE
				</h3>
				<button
					type="button"
					className="ghost-btn mon-wide"
					onClick={() => setWide(!wide)}
					title={wide ? "narrow the panel back" : "widen into a full table"}
				>
					{wide ? "COMPACT" : "EXPAND"}
				</button>
			</div>
			{sum && (
				<div className="mon-kpis" id="mon-kpis">
					<span
						className={`mon-kpi${sum.worker.alive ? "" : " bad"}`}
						title={
							sum.worker.beat_at
								? `worker heartbeat ${ageStr(sum.worker.beat_at)} · up since ${String(sum.worker.started_at).slice(0, 16).replace("T", " ")}Z`
								: "no worker has ever reported"
						}
					>
						<i /> worker {sum.worker.alive ? "alive" : "DOWN"}
					</span>
					<span className={`mon-kpi${sum.sources.failing ? " bad" : ""}`}>
						{sum.sources.failing} failing
					</span>
					<span className={`mon-kpi${sum.sources.frozen ? " bad" : ""}`}>
						{sum.sources.frozen} frozen
					</span>
					<span className={`mon-kpi${sum.sources.stale ? " warn" : ""}`}>
						{sum.sources.stale} stale
					</span>
					<span className="mon-kpi">{sum.sources.ok} ok</span>
					<span
						className="mon-kpi"
						title={`retention: history ${sum.retention.monitor_days}d · raw ${sum.retention.raw_days}d · events ${sum.retention.events_days || "∞"}d`}
					>
						db {mb(sum.db.size_bytes)}
					</span>
				</div>
			)}
			<div className="mon-tools">
				<fieldset className="seg mon-views" aria-label="monitor view">
					{(["sources", "collectors", "endpoints"] as View[]).map((v) => (
						<button
							key={v}
							type="button"
							className={`tbtn${view === v ? " mode-on" : ""}`}
							onClick={() => setView(v)}
						>
							{v.toUpperCase()}
						</button>
					))}
				</fieldset>
				<input
					id="mon-q"
					placeholder="filter…"
					value={q}
					onChange={(e) => setQ(e.target.value)}
				/>
				<button
					type="button"
					className={`tbtn${issues ? " mode-on" : ""}`}
					onClick={() => setIssues((v) => !v)}
					title="show only rows that need attention"
				>
					{issues ? "ALL" : "ISSUES"}
				</button>
			</div>

			{view === "sources" && (
				<DataTable
					label="Sources"
					rows={srcRows}
					cols={sourceCols}
					rowKey={(f) => f.source}
					rowClass={() => "mon-row"}
					rowTitle={(f) =>
						[
							f.content_ts ? `observed ${ageStr(f.content_ts)}` : null,
							f.last_attempt ? `polled ${ageStr(f.last_attempt)}` : null,
							f.first_ok_at
								? `live since ${String(f.first_ok_at).slice(0, 10)}`
								: null,
							f.error ? `err: ${f.error}` : null,
						]
							.filter(Boolean)
							.join(" · ") || f.source
					}
					initialSort={{ key: "state", dir: "asc" }}
					expanded={open}
					onRowClick={(f) => setOpen(open === f.source ? null : f.source)}
					renderExpanded={(f) => <SourceDetail source={f.source} />}
					empty="No sources match."
				/>
			)}
			{view === "collectors" && (
				<DataTable
					label="Collectors"
					rows={colRows}
					cols={collectorCols}
					rowKey={(c) => c.collector}
					rowClass={() => "mon-crow"}
					initialSort={{ key: "result", dir: "asc" }}
					empty="No collectors match."
				/>
			)}
			{view === "endpoints" && (
				<DataTable
					label="Upstream endpoints"
					rows={epRows}
					cols={endpointCols}
					rowKey={(e) => e.host}
					rowClass={() => "mon-erow"}
					initialSort={{ key: "errors", dir: "desc" }}
					empty="No upstream calls recorded in the last 24h — the worker records them as it runs."
				/>
			)}
		</>
	);
}

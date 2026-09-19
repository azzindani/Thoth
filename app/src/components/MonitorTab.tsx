"use client";
// Server monitor (ops pattern): feed health grouped by owning collector,
// tabular rows with state · healthy · last update · period. Fail honest:
// unknown sources render ungrouped, never dropped.
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { ageStr, fmtCadence } from "../lib/ui";

export interface MonitorFeed {
	source: string;
	last_ok: string | null;
	last_attempt: string | null;
	error: string | null;
	content_ts: string | null;
	first_ok_at: string | null;
	frozen?: boolean;
	warming?: boolean;
	collector: string | null;
	intervalSec: number | null;
}

type FeedState = "ok" | "STALE" | "FROZEN" | "WARMING";

function feedState(f: MonitorFeed): { st: FeedState; color: string } {
	if (f.frozen) return { st: "FROZEN", color: "var(--red)" };
	if (f.last_ok) return { st: "ok", color: "var(--grn)" };
	if (f.warming) return { st: "WARMING", color: "var(--dim)" };
	return { st: "STALE", color: "var(--amber)" };
}

/** Stale depth: polls missed since last success (period-aware). */
function missed(f: MonitorFeed): string {
	if (!f.last_ok || !f.intervalSec) return "—";
	const s = Math.max(
		0,
		Math.floor((Date.now() - Date.parse(f.last_ok)) / 1000),
	);
	const m = Math.floor(s / f.intervalSec);
	return m <= 0 ? "—" : `×${m}`;
}

export function MonitorTab() {
	const [feeds, setFeeds] = useState<MonitorFeed[] | null>(null);
	const [q, setQ] = useState("");
	const [hideOk, setHideOk] = useState(false);
	useEffect(() => {
		let stop = false;
		api
			.health()
			.then((h) => {
				if (!stop) setFeeds((h as { feeds: MonitorFeed[] }).feeds);
			})
			.catch(() => {
				if (!stop) setFeeds([]);
			});
		return () => {
			stop = true;
		};
	}, []);
	const groups = useMemo(() => {
		const rows = (feeds ?? []).filter((f) => {
			if (hideOk && f.last_ok && !f.frozen) return false;
			return q
				? f.source.toLowerCase().includes(q.toLowerCase()) ||
						(f.collector ?? "").toLowerCase().includes(q.toLowerCase())
				: true;
		});
		const by = new Map<string, MonitorFeed[]>();
		for (const f of rows) {
			const k = f.collector ?? "ungrouped";
			if (!by.has(k)) by.set(k, []);
			by.get(k)?.push(f);
		}
		return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [feeds, q, hideOk]);
	if (!feeds)
		return <div style={{ color: "var(--dim)" }}>loading monitor…</div>;
	const nOk = feeds.filter((f) => f.last_ok && !f.frozen).length;
	return (
		<>
			<h3>
				MONITOR · {nOk}/{feeds.length} LIVE
			</h3>
			<div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
				<input
					id="mon-q"
					placeholder="filter source or collector…"
					value={q}
					onChange={(e) => setQ(e.target.value)}
					style={{ flex: 1 }}
				/>
				<button
					className={`tbtn${hideOk ? " mode-on" : ""}`}
					onClick={() => setHideOk((v) => !v)}
					title="hide healthy feeds"
				>
					{hideOk ? "ALL" : "ISSUES"}
				</button>
			</div>
			{groups.map(([coll, rows]) => {
				const gOk = rows.filter((f) => f.last_ok && !f.frozen).length;
				const cad =
					rows[0]?.intervalSec != null ? fmtCadence(rows[0].intervalSec) : "—";
				return (
					<div key={coll}>
						<h3>
							{coll.toUpperCase()} · {gOk}/{rows.length} · {cad}
						</h3>
						{rows.map((f) => {
							const { st, color } = feedState(f);
							const tip = [
								f.content_ts ? `observed ${ageStr(f.content_ts)}` : null,
								f.last_attempt ? `polled ${ageStr(f.last_attempt)}` : null,
								f.first_ok_at
									? `live since ${String(f.first_ok_at).slice(0, 10)}`
									: null,
								f.error ? `err: ${f.error}` : null,
							]
								.filter(Boolean)
								.join(" · ");
							return (
								<div
									key={f.source}
									className="item mon-row"
									title={tip || f.source}
								>
									<span style={{ color }}>●</span> <b>{f.source}</b>
									<span style={{ color: "var(--dim)" }}> · {st}</span>
									<br />
									<span
										style={{
											color: "var(--dim)",
											fontSize: 12,
											fontVariantNumeric: "tabular-nums",
										}}
									>
										healthy {f.last_ok ? ageStr(f.last_ok) : "never"}
										{" · updated "}
										{f.content_ts ? ageStr(f.content_ts) : "—"}
										{f.intervalSec != null &&
											` · every ${fmtCadence(f.intervalSec)}`}
										{missed(f) !== "—" && ` · missed ${missed(f)}`}
									</span>
								</div>
							);
						})}
					</div>
				);
			})}
		</>
	);
}

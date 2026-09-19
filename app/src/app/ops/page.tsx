"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Feed {
	source: string;
	last_ok: string | null;
	last_attempt: string | null;
	error: string | null;
	content_ts: string | null;
	first_ok_at: string | null;
	frozen?: boolean;
	warming?: boolean;
}

function age(ts: string | null): string {
	if (!ts) return "—";
	const s = Math.max(0, Math.floor((Date.now() - Date.parse(ts)) / 1000));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

export default function Ops() {
	const [feeds, setFeeds] = useState<Feed[]>([]);
	const [versions, setVersions] = useState<
		{ layer: string; version: string }[]
	>([]);
	const [counts, setCounts] = useState<{ layer: string; count: string }[]>([]);
	useEffect(() => {
		let stop = false;
		async function load() {
			try {
				const [h, s, st] = await Promise.all([
					api.health(),
					api.versions(),
					api.stats(),
				]);
				if (stop) return;
				setFeeds(h.feeds);
				setVersions(s.versions);
				setCounts(st.items);
			} catch {
				/* keep */
			}
		}
		load();
		const t = setInterval(load, 30000);
		return () => {
			stop = true;
			clearInterval(t);
		};
	}, []);
	const ver = new Map(versions.map((v) => [v.layer, v.version]));
	const cnt = new Map(counts.map((c) => [c.layer, c.count]));
	const live = feeds.filter((f) => f.last_ok && !f.frozen).length;
	return (
		<main style={{ padding: 16, overflow: "auto", height: "100vh" }}>
			<h3>
				OPS · {live}/{feeds.length} LIVE · <a href="/">← TERMINAL</a>
			</h3>
			<h3>LAYERS</h3>
			<table
				style={{ borderCollapse: "collapse", width: "100%", maxWidth: 900 }}
			>
				<thead>
					<tr style={{ color: "var(--dim)", textAlign: "left" }}>
						<th>LAYER</th>
						<th>ROWS/24H</th>
						<th>VERSION</th>
					</tr>
				</thead>
				<tbody>
					{[...cnt.entries()].map(([l, c]) => (
						<tr key={l} style={{ borderTop: "1px solid var(--line)" }}>
							<td>{l}</td>
							<td style={{ color: "var(--amber)" }}>{c}</td>
							<td style={{ color: "var(--dim)" }}>{ver.get(l) ?? "—"}</td>
						</tr>
					))}
				</tbody>
			</table>
			<h3 style={{ marginTop: 16 }}>FEEDS (content-age contract)</h3>
			<table
				style={{ borderCollapse: "collapse", width: "100%", maxWidth: 1100 }}
			>
				<thead>
					<tr style={{ color: "var(--dim)", textAlign: "left" }}>
						<th>SOURCE</th>
						<th>STATE</th>
						<th>LAST OK</th>
						<th>CONTENT AGE</th>
						<th>ERROR</th>
					</tr>
				</thead>
				<tbody>
					{feeds.map((f) => {
						const st = f.frozen
							? "FROZEN"
							: f.last_ok
								? "ok"
								: f.warming
									? "WARMING"
									: "STALE";
						const col = f.frozen
							? "var(--red)"
							: f.last_ok
								? "var(--grn)"
								: f.warming
									? "var(--dim)"
									: "var(--amber)";
						return (
							<tr key={f.source} style={{ borderTop: "1px solid var(--line)" }}>
								<td>{f.source}</td>
								<td style={{ color: col }}>{st}</td>
								<td style={{ color: "var(--dim)" }}>{age(f.last_ok)}</td>
								<td style={{ color: f.frozen ? "var(--red)" : "var(--dim)" }}>
									{age(f.content_ts)}
								</td>
								<td
									style={{
										color: "var(--dim)",
										maxWidth: 320,
										overflow: "hidden",
										textOverflow: "ellipsis",
									}}
								>
									{f.error ?? ""}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</main>
	);
}

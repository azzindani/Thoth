"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Btn } from "../lib/ui";

interface Feed {
	source: string;
	last_ok: string | null;
	error: string | null;
	frozen?: boolean;
	warming?: boolean;
}

export default function Ticker({
	mode,
	setMode,
	globe,
	setGlobe,
	onMonitor,
	focus,
	setFocus,
	sse,
}: {
	mode: string;
	setMode: (m: string) => void;
	globe: boolean;
	setGlobe: (g: boolean) => void;
	onMonitor: () => void;
	focus: boolean;
	setFocus: (f: boolean) => void;
	sse?: { ok: boolean; last: number; n: number };
}) {
	const [clock, setClock] = useState("--:--:--");
	const [tape, setTape] = useState("booting…");
	const [pill, setPill] = useState(<span>···</span>);

	useEffect(() => {
		const t = setInterval(
			() => setClock(`${new Date().toISOString().slice(11, 19)}Z`),
			1000,
		);
		return () => clearInterval(t);
	}, []);

	useEffect(() => {
		let stop = false;
		async function refresh() {
			try {
				const [mkt, news, stats, health, brief, spwx] = await Promise.all([
					api.layer("markets").catch(() => ({ items: [] })),
					api.layer("news").catch(() => ({ items: [] })),
					api.stats().catch(() => ({ items: [] })),
					api.health().catch(() => ({ feeds: [] })),
					api.brief().catch(() => ({ critical: [] })),
					api.layer("spacewx").catch(() => ({ items: [] })),
				]);
				if (stop) return;
				const counts = new Map(stats.items.map((i) => [i.layer, i.count]));
				const items = (mkt.items || [])
					.slice(0, 5)
					.map((i) => i.title)
					.join(" /// ");
				const heads =
					(news.items || [])
						.slice(0, 5)
						.map((i) => `NEWS: ${i.title}`)
						.join(" /// ") || "NEWS: feeds recovering — retrying";
				setTape(
					`${items} /// ${heads} /// ` +
						[...counts.entries()]
							.map(([l, c]) => `${l.toUpperCase()} ${c}`)
							.join(" /// "),
				);
				const feeds = (health as { feeds: Feed[] }).feeds || [];
				const live = feeds.filter((f) => f.last_ok && !f.frozen);
				const stale = feeds.filter((f) => !f.last_ok && !f.warming);
				const frozen = feeds.filter((f) => f.frozen);
				const nc = ((brief as { critical?: unknown[] }).critical ?? []).length;
				const defcon =
					nc >= 30 ? 1 : nc >= 15 ? 2 : nc >= 5 ? 3 : nc >= 1 ? 4 : 5;
				const dcol =
					defcon <= 2
						? "var(--red)"
						: defcon === 3
							? "var(--amber)"
							: "var(--grn)";
				const ent = [...counts.values()].reduce(
					(a, c) => a + (Number(c) || 0),
					0,
				);
				const kpRaw = (
					(spwx as { items?: { meta?: { kp?: unknown } }[] }).items ?? []
				).find((i) => typeof i.meta?.kp === "number")?.meta?.kp as
					| number
					| undefined;
				const kp =
					typeof kpRaw === "number" && Number.isFinite(kpRaw)
						? kpRaw
						: undefined;
				const kcol =
					kp === undefined
						? "var(--dim)"
						: kp >= 7
							? "var(--red)"
							: kp >= 5
								? "var(--amber)"
								: "var(--grn)";
				setPill(
					<span>
						<span style={{ color: dcol }}>DEFCON {defcon}</span> · {live.length}{" "}
						LIVE
						{stale.length > 0 && (
							<>
								{" "}
								· <span className="stale">{stale.length} STALE</span>
							</>
						)}
						{frozen.length > 0 && (
							<>
								{" "}
								· <span className="stale">{frozen.length} FROZEN</span>
							</>
						)}
						<span className="pill-ext">
							{" "}
							· {(ent >= 1000 ? `${(ent / 1000).toFixed(1)}K` : ent) || "—"} ENT
							· <span style={{ color: kcol }}>Kp {kp ?? "—"}</span>
						</span>
					</span>,
				);
			} catch {
				/* keep last tape */
			}
		}
		refresh();
		const t = setInterval(refresh, 120000);
		return () => {
			stop = true;
			clearInterval(t);
		};
	}, []);

	return (
		<div className="ticker" id="ticker">
			{/* Mobile nav: ☰ opens the layer sheet (like a navigation pane —
			tap a layer directly there). Desktop keeps the icon rail. */}
			<button
				className="sheet-toggle"
				aria-label="layers"
				onClick={() =>
					document.getElementById("explorer")?.classList.toggle("open")
				}
			>
				☰
			</button>
			<span className="logo">THOTH</span>
			<span className="clock">{clock}</span>
			<div className="tape">
				<span id="tape-txt">{tape}</span>
			</div>
			{/* Health pill opens the MONITOR tab: tabular server status
			(grouped by collector, period + stale depth per feed). */}
			<button
				className="hpill"
				id="health-pill"
				onClick={onMonitor}
				title={
					sse
						? `open server monitor · SSE ${sse.ok ? "connected" : "RECONNECTING"} · last message ${sse.last ? `${Math.max(0, Math.round((Date.now() - sse.last) / 1000))}s ago` : "never"} · ${sse.n} reconnects`
						: "open server monitor"
				}
				style={{
					background: "none",
					border: "none",
					cursor: "pointer",
					font: "inherit",
					padding: 0,
				}}
			>
				<span style={{ color: !sse || sse.ok ? "var(--grn)" : "var(--amber)" }}>
					●{" "}
				</span>
				{pill}
			</button>
			<Btn on={mode === "default"} onClick={() => setMode("default")}>
				DARK
			</Btn>
			<Btn on={mode === "sat"} onClick={() => setMode("sat")}>
				SAT
			</Btn>
			<Btn on={mode === "nvg"} onClick={() => setMode("nvg")}>
				NVG
			</Btn>
			<Btn on={globe} onClick={() => setGlobe(!globe)}>
				GLOBE
			</Btn>
			<Btn on={mode === "cinema"} onClick={() => setMode("cinema")}>
				CINEMA
			</Btn>
			<Btn on={focus} onClick={() => setFocus(!focus)}>
				FOCUS
			</Btn>
		</div>
	);
}

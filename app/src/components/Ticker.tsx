"use client";
import { useEffect, useState } from "react";
import { api, monitor } from "../lib/api";
import { Btn } from "../lib/ui";

/** Market-tape sources: prices, rates, odds (not package downloads). */
const TAPE_SOURCES =
	/^(yahoo|cboe|cboe-eu|coingecko|cg-global|binance|coinbase|kraken|bitstamp|deribit|frankfurter|fxrates|ecb|nbp|boc-fx|cbr|moex|polymarket|kalshi|manifold|nyfed|fiscaldata|fng)$/;
const SEP = "   ·   ";

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
	clear,
	onClear,
	sse,
}: {
	mode: string;
	setMode: (m: string) => void;
	globe: boolean;
	setGlobe: (g: boolean) => void;
	onMonitor: () => void;
	focus: boolean;
	setFocus: (f: boolean) => void;
	/** every panel hidden (clear view) */
	clear: boolean;
	onClear: () => void;
	sse?: { ok: boolean; last: number; n: number };
}) {
	const [clock, setClock] = useState("--:--:--");
	const [tape, setTape] = useState("booting…");
	const [pill, setPill] = useState(<span>···</span>);
	// Worker liveness (monitor P1): a dead worker otherwise only shows as
	// feeds slowly going stale. Checked more often than the tape.
	const [workerDown, setWorkerDown] = useState(false);
	useEffect(() => {
		let stop = false;
		const check = () =>
			monitor
				.summary()
				.then((s) => {
					if (!stop) setWorkerDown(!s.worker.alive);
				})
				.catch(() => {});
		check();
		const t = setInterval(check, 30000);
		return () => {
			stop = true;
			clearInterval(t);
		};
	}, []);

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
				// The markets layer also carries package-download and dev
				// mindshare rows; the tape is for prices, rates and odds.
				const items = (mkt.items || [])
					.filter((i) => TAPE_SOURCES.test(i.source))
					.slice(0, 6)
					.map((i) => i.title)
					.join(SEP);
				const heads =
					(news.items || [])
						.slice(0, 5)
						.map((i) => `NEWS  ${i.title}`)
						.join(SEP) || "NEWS  feeds recovering — retrying";
				setTape(
					[
						items,
						heads,
						[...counts.entries()]
							.map(([l, c]) => `${l.toUpperCase()} ${c}`)
							.join(SEP),
					]
						.filter(Boolean)
						.join(SEP),
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
							: "var(--txt2)";
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
								: "var(--txt2)";
				const sep = <span className="sep">/</span>;
				setPill(
					<span>
						<span style={{ color: dcol }}>DEFCON {defcon}</span>
						{sep}
						{live.length} LIVE
						{stale.length > 0 && (
							<>
								{sep}
								<span className="stale">{stale.length} STALE</span>
							</>
						)}
						{frozen.length > 0 && (
							<>
								{sep}
								<span className="stale">{frozen.length} FROZEN</span>
							</>
						)}
						<span className="pill-ext">
							{sep}
							{(ent >= 1000 ? `${(ent / 1000).toFixed(1)}K` : ent) || "—"} ENT
							{sep}
							<span style={{ color: kcol }}>Kp {kp ?? "—"}</span>
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
				LAYERS
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
				<span
					style={{ color: !sse || sse.ok ? "var(--faint)" : "var(--amber)" }}
				>
					{!sse || sse.ok ? "● " : "● RECONNECTING / "}
				</span>
				{workerDown && (
					<span className="stale" id="worker-down">
						WORKER DOWN <span className="sep">/</span>{" "}
					</span>
				)}
				{pill}
			</button>
			{/* Basemap is one choice (segmented); projection and layout modes
			are independent toggles. */}
			<fieldset className="seg" aria-label="basemap">
				<Btn on={mode === "default"} onClick={() => setMode("default")}>
					DARK
				</Btn>
				<Btn on={mode === "sat"} onClick={() => setMode("sat")}>
					SAT
				</Btn>
				<Btn on={mode === "nvg"} onClick={() => setMode("nvg")}>
					NVG
				</Btn>
			</fieldset>
			<fieldset className="seg" aria-label="view">
				<Btn on={globe} onClick={() => setGlobe(!globe)}>
					GLOBE
				</Btn>
				<Btn on={mode === "cinema"} onClick={() => setMode("cinema")}>
					CINEMA
				</Btn>
				<Btn on={focus} onClick={() => setFocus(!focus)}>
					FOCUS
				</Btn>
				<Btn
					on={clear}
					onClick={onClear}
					id="clear-btn"
					title="clear view: hide every panel (\)"
				>
					CLEAR
				</Btn>
			</fieldset>
		</div>
	);
}

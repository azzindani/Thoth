"use client";
// Terminal pillar tabs (fincept digest, batch64): PULSE market overview,
// PORTFOLIO holdings, SCREENER quote filter, NOTES analyst journal.
// Fincept shapes ported: MarketPulsePanel sections, WatchlistScreen table,
// ScreenerScreen basket + sorts, FinancialNote model. Data: live collectors
// (cboe/cboe-eu/yahoo/nasdaq-top/coingecko/fiscal-rates) + terminal APIs.
import { useEffect, useState } from "react";
import { api, type LayerItem } from "../lib/api";
import { Field, ItemRow } from "../lib/ui";
import { flyTo, MAP_NOTES_EVENT } from "./MapView";

export function PulseTab() {
	const [items, setItems] = useState<LayerItem[] | null>(null);
	const [fng, setFng] = useState<string | null>(null);
	useEffect(() => {
		let stop = false;
		api
			.layer("markets")
			.then((j) => {
				if (stop) return;
				setItems(j.items);
				const f = j.items.find((i) => i.source === "fng");
				setFng(f ? (f.title ?? null) : null);
			})
			.catch(() => {
				if (!stop) setItems([]);
			});
		return () => {
			stop = true;
		};
	}, []);
	if (!items) return <div style={{ color: "var(--dim)" }}>loading pulse…</div>;
	const pick = (...srcs: string[]) =>
		items.filter((i) => srcs.includes(i.source));
	// EQUITIES ordered quotes-first (yahoo) then screeners: the raw feed
	// is ts-DESC so nasdaq-top/moex drown below the slice(0, 8) cap.
	// FX lists every USD-base source (fixed 2026-09-18: ecb/nbp/fxrates/
	// erapi rows existed but never surfaced).
	const secs: [string, LayerItem[]][] = [
		["VOLATILITY", pick("cboe")],
		["EUROPE", pick("cboe-eu")],
		["CRYPTO", pick("coingecko")],
		["RATES", pick("fiscal-rates", "nyfed")],
		[
			"FX",
			pick(
				"frankfurter",
				"frankfurter-eur",
				"ecb",
				"nbp",
				"fxrates",
				"erapi-usd",
				"erapi-eur",
				"nbp-pln",
				"boc-fx",
			),
		],
		["EQUITIES", [...pick("yahoo"), ...pick("nasdaq-top"), ...pick("moex")]],
	];
	return (
		<>
			<h3>PULSE · {fng ?? "markets"}</h3>
			{secs.map(
				([t, rows]) =>
					rows.length > 0 && (
						<div key={t}>
							<h3>{t}</h3>
							{rows.slice(0, 8).map((a) => (
								<ItemRow key={a.id}>
									<b>{a.source}</b> · {a.title}
								</ItemRow>
							))}
						</div>
					),
			)}
		</>
	);
}

export function PortfolioTab() {
	const [pfs, setPfs] = useState<
		{
			id: string;
			name: string;
			positions: { id: string; symbol: string; qty: string }[];
		}[]
	>(() => []);
	const [name, setName] = useState("");
	const [sym, setSym] = useState("");
	const [qty, setQty] = useState("");
	const [sel, setSel] = useState("");
	useEffect(() => {
		let stop = false;
		api
			.portfolios()
			.then((j) => {
				if (!stop) setPfs(j.items);
			})
			.catch(() => {});
		return () => {
			stop = true;
		};
	}, []);
	const load = () =>
		api
			.portfolios()
			.then((j) => setPfs(j.items))
			.catch(() => {});
	return (
		<>
			<h3>PORTFOLIO · {pfs.length}</h3>
			<div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
				<Field
					id="pf-name"
					placeholder="new portfolio"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
				<button
					onClick={() => {
						if (name.trim()) api.portfolioAdd(name.trim()).then(load);
						setName("");
					}}
				>
					ADD
				</button>
			</div>
			{pfs.map((p) => (
				<div key={p.id}>
					<h3>
						{p.name}{" "}
						<button
							onClick={() => {
								setSel(p.id);
								setSym("");
							}}
						>
							{sel === p.id ? "▾" : "▸"}
						</button>{" "}
						<button onClick={() => api.portfolioDel(p.id).then(load)}>
							DEL
						</button>
					</h3>
					{sel === p.id && (
						<>
							{p.positions.map((o) => (
								<ItemRow key={o.id}>
									<b>{o.symbol}</b> · {o.qty}{" "}
									<button
										onClick={() => api.positionDel(p.id, o.symbol).then(load)}
									>
										x
									</button>
								</ItemRow>
							))}
							<div style={{ display: "flex", gap: 6 }}>
								<Field
									id="pos-sym"
									placeholder="SYM"
									value={sym}
									onChange={(e) => setSym(e.target.value)}
								/>
								<Field
									id="pos-qty"
									placeholder="qty"
									value={qty}
									onChange={(e) => setQty(e.target.value)}
								/>
								<button
									onClick={() => {
										if (sym.trim() && Number(qty))
											api.positionAdd(p.id, sym.trim(), Number(qty)).then(load);
										setSym("");
										setQty("");
									}}
								>
									ADD
								</button>
							</div>
						</>
					)}
				</div>
			))}
		</>
	);
}

export function ScreenerTab() {
	const [items, setItems] = useState<LayerItem[] | null>(null);
	const [q, setQ] = useState("");
	const [sort, setSort] = useState("gainers");
	useEffect(() => {
		let stop = false;
		api
			.layer("markets")
			.then((j) => {
				if (!stop) setItems(j.items);
			})
			.catch(() => {
				if (!stop) setItems([]);
			});
		return () => {
			stop = true;
		};
	}, []);
	if (!items) return <div style={{ color: "var(--dim)" }}>loading screen…</div>;
	const rows = items
		.filter((i) =>
			q
				? (i.title ?? "").toLowerCase().includes(q.toLowerCase()) ||
					i.id.toLowerCase().includes(q.toLowerCase())
				: true,
		)
		.slice()
		.sort((a, b) => {
			const chg = (r: { meta?: Record<string, unknown> }) =>
				Number(
					(r.meta?.chg ?? r.meta?.chg24 ?? r.meta?.chgpct ?? 0) as number,
				) || 0;
			return sort === "losers" ? chg(a) - chg(b) : chg(b) - chg(a);
		});
	return (
		<>
			<h3>
				SCREEN · {rows.length}{" "}
				<select value={sort} onChange={(e) => setSort(e.target.value)}>
					<option value="gainers">TOP GAINERS</option>
					<option value="losers">TOP LOSERS</option>
				</select>
			</h3>
			<Field
				id="screen-q"
				placeholder="filter symbol or text…"
				value={q}
				onChange={(e) => setQ(e.target.value)}
			/>
			{rows.slice(0, 40).map((a) => (
				<ItemRow key={a.id}>
					<b>{a.source}</b> · {a.title}
				</ItemRow>
			))}
		</>
	);
}

export function NotesTab() {
	const [notes, setNotes] = useState<
		{
			id: string;
			title: string;
			body: string;
			category: string;
			tickers: string;
			sentiment: string;
			lat: number | null;
			lon: number | null;
		}[]
	>([]);
	const [title, setTitle] = useState("");
	const [tickers, setTickers] = useState("");
	useEffect(() => {
		let stop = false;
		api
			.notes()
			.then((j) => {
				if (!stop) setNotes(j.items);
			})
			.catch(() => {});
		return () => {
			stop = true;
		};
	}, []);
	const load = () =>
		api
			.notes()
			.then((j) => setNotes(j.items))
			.catch(() => {});
	return (
		<>
			<h3>JOURNAL · {notes.length}</h3>
			<div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
				<Field
					id="note-title"
					placeholder="new note title"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
				/>
				<Field
					id="note-tickers"
					placeholder="TICKERS"
					value={tickers}
					onChange={(e) => setTickers(e.target.value)}
				/>
				<button
					onClick={() => {
						if (title.trim())
							api
								.noteAdd({ title: title.trim(), tickers: tickers.trim() })
								.then(load);
						setTitle("");
						setTickers("");
					}}
				>
					ADD
				</button>
			</div>
			{notes.map((n) => (
				<ItemRow key={n.id}>
					<b>{n.tickers || n.category}</b> · {n.title} · {n.sentiment}{" "}
					{n.lat != null && n.lon != null && (
						<button
							type="button"
							title="fly to this map note"
							onClick={() =>
								n.lat != null && n.lon != null && flyTo(n.lat, n.lon, 6)
							}
						>
							MAP
						</button>
					)}{" "}
					<button
						onClick={() =>
							api.noteDel(n.id).then(() => {
								load();
								window.dispatchEvent(new Event(MAP_NOTES_EVENT));
							})
						}
					>
						x
					</button>
					{n.body && (
						<>
							<br />
							<span style={{ color: "var(--dim)" }}>
								{n.body.slice(0, 160)}
							</span>
						</>
					)}
				</ItemRow>
			))}
		</>
	);
}

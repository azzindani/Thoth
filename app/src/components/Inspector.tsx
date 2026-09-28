"use client";
import { useEffect, useRef, useState } from "react";
import { api, type LayerItem } from "../lib/api";
import { LAYERS, STREAMS } from "../lib/layer-catalog";
import { fmtKm, MOVING_LAYERS, mosaic, satZoom, tileKm } from "../lib/satview";
import { SheetHead } from "../lib/sheet";
import { ageStr, Glyph, ItemRow, KV, SourceLink } from "../lib/ui";
import { CountryTab } from "./CountryTab";
import { IncidentsTab } from "./IncidentsTab";
import {
	AreaTab,
	BriefBlock,
	CyberTab,
	FeedTab,
	SdnTab,
	VideoTab,
} from "./InspectorTabs";
import type { ObjProps } from "./MapView";
import { MonitorTab } from "./MonitorTab";
import OsintView from "./OsintView";
import { Provenance } from "./Provenance";
import { NotesTab, PortfolioTab, PulseTab, ScreenerTab } from "./TerminalTabs";

export type Tab =
	| "object"
	| "area"
	| "country"
	| "sdn"
	| "alerts"
	| "incidents"
	| "video"
	| "news"
	| "markets"
	| "cyber"
	| "pulse"
	| "portfolio"
	| "screen"
	| "monitor"
	| "notes";

/** An ask from outside the panel (map right-click / long-press, command
 * line, palette). `n` makes a repeat of the same ask run again. */
export type InspRequest = { n: number } & (
	| { kind: "area"; lat: string; lng: string }
	| { kind: "sdn"; q: string }
);
export type LookupState = "idle" | "loading" | "error";

function Sev({ s }: { s?: string }) {
	return (
		<span className={`sev-${s || "info"}`}>{(s || "info").toUpperCase()}</span>
	);
}

export default function Inspector({
	tab,
	setTab,
	sel,
	osint,
	onClose,
	onOsint,
	country,
	request,
}: {
	tab: Tab;
	setTab: (t: Tab) => void;
	sel: ObjProps | null;
	osint: { kind: string; arg: string } | null;
	onClose: () => void;
	onOsint?: (kind: string, arg: string) => void;
	/** Country the command line / palette asked for (country tab). */
	country?: string;
	request?: InspRequest | null;
}) {
	const [area, setArea] = useState<{
		lat: string;
		lng: string;
		r: string;
		label: string;
		counts: { layer: string; count: string }[];
		items: LayerItem[];
		threat?: { score: number; level: string };
	} | null>(null);
	const [alerts, setAlerts] = useState<LayerItem[] | null>(null);
	const [sdn, setSdn] = useState<{
		q: string;
		items: Record<string, unknown>[];
	} | null>(null);
	const [video, setVideo] = useState<string>(STREAMS[0][1]);
	const [areaState, setAreaState] = useState<LookupState>("idle");
	// 15 tabs in a strip that shows about six: arrows say there is more.
	const tabsRef = useRef<HTMLDivElement>(null);
	const [edges, setEdges] = useState({ l: false, r: false });
	const readEdges = () => {
		const t = tabsRef.current;
		if (!t) return;
		setEdges({
			l: t.scrollLeft > 2,
			r: t.scrollLeft + t.clientWidth < t.scrollWidth - 2,
		});
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: DOM measurement only
	useEffect(() => {
		const t = tabsRef.current;
		if (!t) return;
		readEdges();
		const ro = new ResizeObserver(readEdges);
		ro.observe(t);
		return () => ro.disconnect();
	}, []);
	const nudge = (dx: number) =>
		tabsRef.current?.scrollBy({ left: dx, behavior: "smooth" });
	const [sdnState, setSdnState] = useState<LookupState>("idle");

	async function openTab(t: Tab) {
		setTab(t);
		document.getElementById("inspector")?.classList.add("open");
		if (t === "alerts" && !alerts) {
			try {
				setAlerts((await api.alerts()).items);
			} catch {
				setAlerts([]);
			}
		}
	}
	async function goArea(lat: string, lng: string, r: string) {
		setAreaState("loading");
		try {
			const [d, g] = await Promise.all([
				api.dossier(lat, lng, Number(r)),
				api.osint("geo", `${lat},${lng}`).catch(() => ({})) as Promise<{
					label?: string;
				}>,
			]);
			setArea({
				lat,
				lng,
				r,
				label: g.label?.split(",").slice(0, 3).join(",") ?? "",
				counts: d.counts,
				items: d.items,
				threat: d.threat,
			});
			setAreaState("idle");
		} catch {
			setAreaState("error");
		}
	}
	async function goSdn(q: string) {
		if (!q.trim()) return;
		setSdnState("loading");
		try {
			setSdn({ q, items: (await api.sdn(q)).items });
			setSdnState("idle");
		} catch {
			setSdn({ q, items: [] });
			setSdnState("error");
		}
	}
	// Outside asks: the map's right-click / long-press and the command
	// line's `dossier lat,lng` / `sdn name` land here with their arguments.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the nonce is the trigger
	useEffect(() => {
		if (!request) return;
		if (request.kind === "area") {
			void openTab("area");
			void goArea(request.lat, request.lng, "300");
		} else {
			void openTab("sdn");
			void goSdn(request.q);
		}
	}, [request?.n]);

	// Keep the active tab visible in the scrollable strip: deep links
	// (pulse/portfolio/screen/notes via cmdbar) land off-screen on phone
	// (strip is 669px in a 361px window, measured 2026-09-18). Defer a
	// frame: on phone the sheet is display:none until .open applies, and
	// scrollIntoView on a hidden strip is a no-op (probed 2026-09-18).
	// biome-ignore lint/correctness/useExhaustiveDependencies: tab is the trigger; DOM scroll has no reactive value
	useEffect(() => {
		const raf = requestAnimationFrame(() => {
			document
				.querySelector("#tabs button.on")
				?.scrollIntoView({ inline: "center", block: "nearest" });
		});
		return () => cancelAnimationFrame(raf);
	}, [tab]);

	return (
		<div className="inspector" id="inspector">
			<SheetHead onClose={onClose} />
			<div className="insp-head">
				{edges.l && (
					<button
						type="button"
						className="tabs-arrow"
						aria-label="earlier tabs"
						onClick={() => nudge(-220)}
					>
						‹
					</button>
				)}
				<div
					className={`tabs${edges.r ? "" : " at-end"}`}
					id="tabs"
					ref={tabsRef}
					onScroll={readEdges}
				>
					{(
						[
							"object",
							"area",
							"country",
							"sdn",
							"alerts",
							"incidents",
							"news",
							"markets",
							"cyber",
							"pulse",
							"portfolio",
							"screen",
							"monitor",
							"notes",
							"video",
						] as Tab[]
					).map((t) => (
						<button
							key={t}
							data-tab={t}
							className={tab === t ? "on" : ""}
							onClick={() => openTab(t)}
						>
							{t[0].toUpperCase() + t.slice(1)}
						</button>
					))}
				</div>
				{edges.r && (
					<button
						type="button"
						className="tabs-arrow"
						aria-label="more tabs"
						onClick={() => nudge(220)}
					>
						›
					</button>
				)}
				<button
					className="insp-close"
					aria-label="close panel"
					onClick={onClose}
				>
					✕
				</button>
			</div>
			<div className="ibody" id="insp-body">
				{tab === "object" && osint && (
					<OsintView kind={osint.kind} arg={osint.arg} />
				)}
				{tab === "object" && !osint && !sel && (
					<div className="empty">
						<h3>No object selected</h3>
						<p>
							Tap or click a dot on the map to inspect it. Right-click a spot
							(long-press on a touch screen) for its area dossier, or type{" "}
							<code>help</code> in the command line.
						</p>
					</div>
				)}
				{tab === "object" && sel && (
					<>
						<h3>
							Object · <Glyph layer={sel.layer} size={14} /> {sel.layer}
						</h3>
						<div
							style={{
								fontSize: "calc(14px * var(--fk))",
								fontWeight: 600,
								color: "var(--txt)",
							}}
						>
							{sel.title}
						</div>
						<KV
							pairs={[
								["SEV", <Sev key="s" s={sel.severity} />],
								["AGE", ageStr(sel.ts)],
								[
									"POS",
									`${Number(sel.lat).toFixed(2)},${Number(sel.lon).toFixed(2)}`,
								],
								...(sel.airline
									? [["AIRLINE", sel.airline] as [string, string]]
									: []),
							]}
						/>
						<Provenance sel={sel} />
						{Number.isFinite(sel.lat) && Number.isFinite(sel.lon) && (
							<Nearby lat={sel.lat} lon={sel.lon} selfId={sel.id} />
						)}
						{Number.isFinite(sel.lat) && Number.isFinite(sel.lon) && (
							<SatImage lat={sel.lat} lon={sel.lon} layer={sel.layer} />
						)}
					</>
				)}
				{tab === "area" && (
					<AreaTab
						key={area ? `${area.lat},${area.lng}` : "none"}
						area={area}
						goArea={goArea}
						state={areaState}
					/>
				)}
				{tab === "sdn" && (
					<SdnTab key={sdn?.q ?? ""} sdn={sdn} goSdn={goSdn} state={sdnState} />
				)}
				{tab === "alerts" && (
					<>
						<h3>Alerts · 24h · {(alerts ?? []).length}</h3>
						{(alerts ?? []).map((a) => (
							<ItemRow key={a.id}>
								<b>{a.layer}</b> · {a.title}
								<br />
								<span style={{ color: "var(--dim)" }}>
									{a.source} · {String(a.ts).slice(0, 10)}
								</span>{" "}
								<SourceLink url={a.url} source={a.source} />
							</ItemRow>
						))}
					</>
				)}
				{tab === "video" && <VideoTab video={video} setVideo={setVideo} />}
				{tab === "news" && (
					<>
						<BriefBlock />
						<FeedTab layer="news" title="News wire" />
					</>
				)}
				{tab === "markets" && <FeedTab layer="markets" title="Markets" />}
				{tab === "cyber" && <CyberTab onOsint={onOsint} />}
				{tab === "pulse" && <PulseTab />}
				{tab === "portfolio" && <PortfolioTab />}
				{tab === "screen" && <ScreenerTab />}
				{tab === "incidents" && <IncidentsTab />}
				{tab === "country" && <CountryTab key={country} initial={country} />}
				{tab === "monitor" && <MonitorTab />}
				{tab === "notes" && <NotesTab />}
			</div>
		</div>
	);
}

// SATIMAGE — freshest Sentinel-2 true-color over the selection
// (earth-search STAC via /api/imagery, keyless). Lazy, honest-empty.
export function SatImage({
	lat,
	lon,
	layer,
}: {
	lat: number;
	lon: number;
	layer: string;
}) {
	const moving = MOVING_LAYERS.has(layer);
	const [s, setS] = useState<
		| {
				id: string;
				datetime: string;
				cloud_cover: number | null;
				thumbnail: string;
				tci: string;
		  }
		| null
		| undefined
	>(undefined);
	useEffect(() => {
		if (moving) return;
		let stop = false;
		api
			.imagery(lon, lat)
			.then((j) => {
				if (!stop) setS(j.scene);
			})
			.catch(() => {
				if (!stop) setS(null);
			});
		return () => {
			stop = true;
		};
	}, [lat, lon, moving]);
	// Imagery under a plane or ship says nothing about it.
	if (moving) return null;
	const z = satZoom(layer, Boolean(LAYERS[layer]?.polygon));
	return (
		<>
			<h3>Imagery · {fmtKm(tileKm(lat, z))} across</h3>
			<div className="hov-shot sat-view">
				{mosaic(lat, lon, z).map((t) => (
					// biome-ignore lint/performance/noImgElement: raw map tiles, positioned by hand
					<img
						key={t.url}
						className="on"
						alt=""
						loading="lazy"
						referrerPolicy="no-referrer"
						src={t.url}
						style={{
							left: `calc(50% + ${t.left}px)`,
							top: `calc(50% + ${t.top}px)`,
						}}
					/>
				))}
				<span className="hov-x" aria-hidden="true" />
			</div>
			<div
				style={{
					color: "var(--dim)",
					fontSize: "calc(12px * var(--fk))",
					marginTop: 4,
				}}
			>
				Esri World Imagery, centred on the object (basemap, not live).
				{s === undefined && " Looking for the latest Sentinel-2 pass…"}
				{s && (
					<>
						{" "}
						Latest Sentinel-2 pass:{" "}
						<a href={s.tci} target="_blank" rel="noreferrer">
							{String(s.datetime).slice(0, 10)}
							{s.cloud_cover != null
								? ` · ${Number(s.cloud_cover).toFixed(0)}% cloud`
								: ""}{" "}
							↗
						</a>
					</>
				)}
			</div>
		</>
	);
}

// COMPLETEVIEW — the full preview a map click opens: identity, full record,
// satellite pass and proximity in one card. Desk/tab: right-side overlay;
// phone: bottom sheet so the map stays visible above it.
export function CompleteView({
	sel,
	onClose,
}: {
	sel: ObjProps;
	onClose: () => void;
}) {
	return (
		<div className="fullview-wrap" id="fullview">
			<div className="fullview" role="dialog" aria-label="full preview">
				<SheetHead onClose={onClose} />
				<button className="fv-close" onClick={onClose} aria-label="close">
					✕
				</button>
				<div className="fv-body">
					<h3>
						Full view · <Glyph layer={sel.layer} size={14} /> {sel.layer}
					</h3>
					<div
						style={{
							fontSize: "calc(14px * var(--fk))",
							fontWeight: 600,
							color: "var(--txt)",
						}}
					>
						{sel.title}
					</div>
					<KV
						pairs={[
							["SEV", <Sev key="s" s={sel.severity} />],
							["AGE", ageStr(sel.ts)],
							[
								"POS",
								`${Number(sel.lat).toFixed(2)},${Number(sel.lon).toFixed(2)}`,
							],
							...(sel.airline
								? [["AIRLINE", sel.airline] as [string, string]]
								: []),
						]}
					/>
					<Provenance sel={sel} />
					{Number.isFinite(sel.lat) && Number.isFinite(sel.lon) && (
						<SatImage lat={sel.lat} lon={sel.lon} layer={sel.layer} />
					)}
					{Number.isFinite(sel.lat) && Number.isFinite(sel.lon) && (
						<Nearby lat={sel.lat} lon={sel.lon} selfId={sel.id} />
					)}
				</div>
			</div>
		</div>
	);
}

// NEARBY — proximity correlation for the selected feature: what else sits
// within 100km (other layers, real dossier data, self excluded).
export function Nearby({
	lat,
	lon,
	selfId,
}: {
	lat: number;
	lon: number;
	selfId: string;
}) {
	const [d, setD] = useState<{
		counts: { layer: string; count: string }[];
		items: LayerItem[];
	} | null>(null);
	useEffect(() => {
		let stop = false;
		api
			.dossier(String(lat), String(lon), 100)
			.then((j) => {
				if (!stop) setD(j);
			})
			.catch(() => {
				if (!stop) setD({ counts: [], items: [] });
			});
		return () => {
			stop = true;
		};
	}, [lat, lon]);
	if (!d) return <div style={{ color: "var(--dim)" }}>nearby…</div>;
	const others = d.items.filter((i) => i.id !== selfId).slice(0, 5);
	if (!others.length) return null;
	return (
		<>
			<h3>Nearby · 100 km</h3>
			<div style={{ color: "var(--dim)" }}>
				{d.counts
					.slice(0, 6)
					.map((c) => `${c.layer} ${c.count}`)
					.join(" · ")}
			</div>
			{others.map((i) => (
				<ItemRow key={i.id}>
					<b>{i.layer}</b> · {i.title}{" "}
					<SourceLink url={i.url} source={i.source} />
				</ItemRow>
			))}
		</>
	);
}

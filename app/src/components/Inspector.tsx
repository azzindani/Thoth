"use client";
import { useEffect, useState } from "react";
import { api, type LayerItem } from "../lib/api";
import { STREAMS } from "../lib/layer-catalog";
import { ageStr, Glyph, ItemRow, KV } from "../lib/ui";
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
import { NotesTab, PortfolioTab, PulseTab, ScreenerTab } from "./TerminalTabs";

export type Tab =
	| "object"
	| "area"
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
}: {
	tab: Tab;
	setTab: (t: Tab) => void;
	sel: ObjProps | null;
	osint: { kind: string; arg: string } | null;
	onClose: () => void;
	onOsint?: (kind: string, arg: string) => void;
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
		} catch {
			/* keep */
		}
	}
	async function goSdn(q: string) {
		if (!q.trim()) return;
		try {
			setSdn({ q, items: (await api.sdn(q)).items });
		} catch {
			/* keep */
		}
	}

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
			<div className="insp-head">
				<div className="tabs" id="tabs">
					{(
						[
							"object",
							"area",
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
							for its area dossier, or type <code>help</code> in the command
							line.
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
								fontSize: 14,
								fontWeight: 600,
								color: "var(--txt)",
							}}
						>
							{sel.title}
						</div>
						<KV
							pairs={[
								["SEV", <Sev key="s" s={sel.severity} />],
								["SRC", sel.source],
								["TS", String(sel.ts).slice(0, 19).replace("T", " ")],
								["AGE", ageStr(sel.ts)],
								[
									"POS",
									`${Number(sel.lat).toFixed(2)},${Number(sel.lon).toFixed(2)}`,
								],
								[
									"ID",
									<span key="i" style={{ wordBreak: "break-all" }}>
										{sel.id}
									</span>,
								],
								...(sel.airline
									? [["AIRLINE", sel.airline] as [string, string]]
									: []),
							]}
						/>
						{sel.url && (
							<a href={sel.url} target="_blank" rel="noreferrer">
								SOURCE ↗
							</a>
						)}
						<ObjectDetail sel={sel} />
						{Number.isFinite(sel.lat) && Number.isFinite(sel.lon) && (
							<Nearby lat={sel.lat} lon={sel.lon} selfId={sel.id} />
						)}
						{Number.isFinite(sel.lat) && Number.isFinite(sel.lon) && (
							<SatImage lat={sel.lat} lon={sel.lon} />
						)}
					</>
				)}
				{tab === "area" && <AreaTab area={area} goArea={goArea} />}
				{tab === "sdn" && <SdnTab sdn={sdn} goSdn={goSdn} />}
				{tab === "alerts" && (
					<>
						<h3>Alerts · 24h · {(alerts ?? []).length}</h3>
						{(alerts ?? []).map((a) => (
							<ItemRow key={a.id}>
								<b>{a.layer}</b> · {a.title}
								<br />
								<span style={{ color: "var(--dim)" }}>
									{a.source} · {String(a.ts).slice(0, 10)}
								</span>
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
				{tab === "monitor" && <MonitorTab />}
				{tab === "notes" && <NotesTab />}
			</div>
		</div>
	);
}

// OBJECTDETAIL — full record for the selection: the map only carries the
// render fields, so we pull the layer feed once and merge body + meta
// (altitude/track/magnitude/ids — everything the collector stored).
export function ObjectDetail({ sel }: { sel: ObjProps }) {
	const [full, setFull] = useState<LayerItem | null | undefined>(undefined);
	useEffect(() => {
		let stop = false;
		api
			.layer(sel.layer)
			.then((j) => {
				if (!stop) setFull(j.items.find((i) => i.id === sel.id) ?? null);
			})
			.catch(() => {
				if (!stop) setFull(null);
			});
		return () => {
			stop = true;
		};
	}, [sel.layer, sel.id]);
	if (full === undefined)
		return <div style={{ color: "var(--dim)" }}>detail…</div>;
	if (!full) return null;
	const meta = Object.entries(full.meta ?? {}).filter(([k]) => k !== "airline");
	return (
		<>
			{full.body && (
				<div style={{ margin: "6px 0", lineHeight: 1.6 }}>{full.body}</div>
			)}
			{meta.length > 0 && (
				<KV
					pairs={meta
						.slice(0, 12)
						.map(([k, v]) => [
							k.toUpperCase().slice(0, 10),
							typeof v === "object"
								? JSON.stringify(v).slice(0, 120)
								: String(v),
						])}
				/>
			)}
		</>
	);
}

// SATIMAGE — freshest Sentinel-2 true-color over the selection
// (earth-search STAC via /api/imagery, keyless). Lazy, honest-empty.
export function SatImage({ lat, lon }: { lat: number; lon: number }) {
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
	const [imgOk, setImgOk] = useState(true);
	useEffect(() => {
		let stop = false;
		setImgOk(true);
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
	}, [lat, lon]);
	if (s === undefined)
		return <div style={{ color: "var(--dim)" }}>satellite…</div>;
	if (!s) return null;
	return (
		<>
			<h3>
				SATELLITE ·{" "}
				{String(s.datetime).slice(0, 10) +
					(s.cloud_cover != null
						? ` · ${Number(s.cloud_cover).toFixed(0)}% cloud`
						: "")}
			</h3>
			<a href={s.tci} target="_blank" rel="noreferrer">
				{imgOk && (
					// biome-ignore lint/performance/noImgElement: remote STAC thumbnail, next/image has no optimizer for it
					<img
						src={s.thumbnail}
						alt={`Sentinel-2 ${s.id}`}
						style={{ width: "100%", borderRadius: "var(--r-md)" }}
						loading="lazy"
						onError={() => setImgOk(false)}
					/>
				)}
			</a>
			<div style={{ color: "var(--dim)", fontSize: 12 }}>
				Sentinel-2 · {s.id} · click opens full-res COG
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
				<button className="fv-close" onClick={onClose} aria-label="close">
					✕
				</button>
				<h3>
					Full view · <Glyph layer={sel.layer} size={14} /> {sel.layer}
				</h3>
				<div style={{ fontSize: 14, fontWeight: 600, color: "var(--txt)" }}>
					{sel.title}
				</div>
				<KV
					pairs={[
						["SEV", <Sev key="s" s={sel.severity} />],
						["SRC", sel.source],
						["TS", String(sel.ts).slice(0, 19).replace("T", " ")],
						["AGE", ageStr(sel.ts)],
						[
							"POS",
							`${Number(sel.lat).toFixed(2)},${Number(sel.lon).toFixed(2)}`,
						],
						[
							"ID",
							<span key="i" style={{ wordBreak: "break-all" }}>
								{sel.id}
							</span>,
						],
						...(sel.airline
							? [["AIRLINE", sel.airline] as [string, string]]
							: []),
					]}
				/>
				{sel.url && (
					<a href={sel.url} target="_blank" rel="noreferrer">
						SOURCE ↗
					</a>
				)}
				<ObjectDetail sel={sel} />
				{Number.isFinite(sel.lat) && Number.isFinite(sel.lon) && (
					<SatImage lat={sel.lat} lon={sel.lon} />
				)}
				{Number.isFinite(sel.lat) && Number.isFinite(sel.lon) && (
					<Nearby lat={sel.lat} lon={sel.lon} selfId={sel.id} />
				)}
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
					<b>{i.layer}</b> · {i.title}
				</ItemRow>
			))}
		</>
	);
}

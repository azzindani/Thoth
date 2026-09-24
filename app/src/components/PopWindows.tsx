"use client";
// Pop-out object windows: a pinned map card can be popped into a movable
// window so several objects stay open side by side (compare two quakes,
// watch a flight next to a warning box). Desk: free-floating, draggable,
// z-ordered, a leader line back to the map point, double-click the header
// to minimise into a tray. Tablet/phone: the same cards as one swipeable
// stack above the dock — no free windows where there is no room for them.
// Live: windows re-read their layer when SSE says it changed.
import type * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type LayerItem } from "../lib/api";
import { ageStr } from "../lib/ui";
import { type ObjProps, POPOUT_EVENT, type PopoutDetail } from "./map-popups";

/** page.tsx dispatches this with the layers an SSE tick changed. */
export const LAYERS_EVENT = "thoth:layers";
const STORE_KEY = "thoth.pop";
const MAX = 4;
const WIN_W = 300; // keep in sync with .popwin width
const EDGE = 8;

type Win = {
	key: string;
	p: ObjProps;
	anchor: [number, number] | null;
	x: number;
	y: number;
	min: boolean;
	z: number;
	/** the object fell out of its layer's current slice */
	gone?: boolean;
};

const SEV_COL: Record<string, string> = {
	critical: "var(--red)",
	watch: "var(--amber)",
};

function anchorOf(
	p: ObjProps,
	fallback: [number, number] | null,
): [number, number] | null {
	const lon = Number(p.lon);
	const lat = Number(p.lat);
	return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : fallback;
}

/** Fresh layer row → the window's record (keeps what the row lacks). */
function fromItem(it: LayerItem, prev: ObjProps): ObjProps {
	const c = it.geom?.type === "Point" ? it.geom.coordinates : undefined;
	return {
		...prev,
		title: it.title || prev.title,
		severity: it.severity || prev.severity,
		source: it.source || prev.source,
		url: it.url || prev.url,
		ts: it.ts || prev.ts,
		lon: c ? Number(c[0]) : prev.lon,
		lat: c ? Number(c[1]) : prev.lat,
	};
}

function clampPos(x: number, y: number): { x: number; y: number } {
	const top =
		(document.getElementById("ticker")?.getBoundingClientRect().bottom ?? 0) +
		EDGE;
	return {
		x: Math.min(Math.max(EDGE, x), window.innerWidth - WIN_W - EDGE),
		y: Math.min(Math.max(top, y), window.innerHeight - 120),
	};
}

export default function PopWindows({
	getMap,
	onFull,
}: {
	getMap: () => maplibregl.Map | null;
	onFull: (p: ObjProps) => void;
}) {
	const [wins, setWins] = useState<Win[]>([]);
	const winsRef = useRef<Win[]>([]);
	winsRef.current = wins;
	const zTop = useRef(1);
	const els = useRef(new Map<string, HTMLDivElement>());
	const drag = useRef<{ key: string; dx: number; dy: number } | null>(null);
	const [compact, setCompact] = useState(false);
	const [, setTick] = useState(0);

	// Desk vs stacked form follows the responsive contract (≥1200 = desk).
	useEffect(() => {
		const mq = window.matchMedia("(max-width: 1199px)");
		const on = () => setCompact(mq.matches);
		on();
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, []);

	// Restore the remembered arrangement; persist every change.
	useEffect(() => {
		try {
			const raw = localStorage.getItem(STORE_KEY);
			if (!raw) return;
			const saved = (JSON.parse(raw) as Win[]).slice(-MAX);
			zTop.current = Math.max(1, ...saved.map((w) => w.z));
			setWins(saved.map((w) => ({ ...w, ...clampPos(w.x, w.y) })));
		} catch {
			/* start empty */
		}
	}, []);
	const restored = useRef(false);
	useEffect(() => {
		// Skip the initial empty render so it can't overwrite the store
		// before the restore above lands.
		if (!restored.current) {
			restored.current = true;
			return;
		}
		try {
			localStorage.setItem(
				STORE_KEY,
				JSON.stringify(wins.map(({ gone: _g, ...w }) => w)),
			);
		} catch {
			/* not persisted */
		}
	}, [wins]);

	// Pinned card → window.
	useEffect(() => {
		function onPop(e: Event) {
			const d = (e as CustomEvent<PopoutDetail>).detail;
			const key = `${d.layer}:${d.p.id}`;
			setWins((ws) => {
				const z = ++zTop.current;
				if (ws.some((w) => w.key === key))
					return ws.map((w) => (w.key === key ? { ...w, min: false, z } : w));
				const n = ws.length;
				const pad = getMap()?.getPadding();
				const pos =
					d.x != null && d.y != null
						? clampPos(d.x, d.y)
						: clampPos((pad?.left ?? 0) + 24 + n * 28, 24 + n * 28);
				const win: Win = {
					key,
					p: { ...d.p, layer: d.layer },
					anchor: anchorOf(d.p, d.anchor),
					...pos,
					min: false,
					z,
				};
				// Oldest window makes room for the newest.
				return [...ws, win].slice(-MAX);
			});
		}
		window.addEventListener(POPOUT_EVENT, onPop);
		return () => window.removeEventListener(POPOUT_EVENT, onPop);
	}, [getMap]);

	// Live: re-read the layers an SSE tick changed (and everything once
	// after a restore). The layer slice is the source of truth.
	const refresh = useCallback(async (layers?: string[]) => {
		const todo = [
			...new Set(
				winsRef.current
					.map((w) => w.p.layer)
					.filter((l) => !layers || layers.includes(l)),
			),
		];
		for (const l of todo) {
			try {
				const j = await api.layer(l);
				const byId = new Map(j.items.map((i) => [i.id, i]));
				setWins((ws) =>
					ws.map((w) => {
						if (w.p.layer !== l) return w;
						const it = byId.get(w.p.id);
						if (!it) return { ...w, gone: true };
						const p = fromItem(it, w.p);
						return { ...w, p, gone: false, anchor: anchorOf(p, w.anchor) };
					}),
				);
			} catch {
				/* keep the last known state */
			}
		}
	}, []);
	const hadWins = wins.length > 0;
	useEffect(() => {
		if (hadWins) void refresh();
	}, [hadWins, refresh]);
	useEffect(() => {
		const on = (e: Event) => void refresh((e as CustomEvent<string[]>).detail);
		window.addEventListener(LAYERS_EVENT, on);
		// Ages tick even when nothing changes.
		const t = setInterval(() => setTick((n) => n + 1), 30000);
		return () => {
			window.removeEventListener(LAYERS_EVENT, on);
			clearInterval(t);
		};
	}, [refresh]);

	// Leader lines follow the camera: re-render on map move (rAF-coalesced).
	// Only while a window is open — with none, a pan must not schedule a
	// React render every frame.
	useEffect(() => {
		if (!hadWins) return;
		let raf = 0;
		let bound: maplibregl.Map | null = null;
		const onMove = () => {
			if (!raf)
				raf = requestAnimationFrame(() => {
					raf = 0;
					setTick((n) => n + 1);
				});
		};
		const bind = () => {
			const m = getMap();
			if (!m || m === bound) return false;
			bound = m;
			m.on("move", onMove);
			return true;
		};
		const t = bind()
			? undefined
			: setInterval(() => {
					if (bind()) clearInterval(t);
				}, 400);
		return () => {
			clearInterval(t);
			bound?.off("move", onMove);
			if (raf) cancelAnimationFrame(raf);
		};
	}, [getMap, hadWins]);

	// Keep windows on screen when the viewport shrinks.
	useEffect(() => {
		const on = () =>
			setWins((ws) => ws.map((w) => ({ ...w, ...clampPos(w.x, w.y) })));
		window.addEventListener("resize", on);
		return () => window.removeEventListener("resize", on);
	}, []);

	const update = (key: string, f: (w: Win) => Win) =>
		setWins((ws) => ws.map((w) => (w.key === key ? f(w) : w)));
	const front = (key: string) => {
		const z = ++zTop.current;
		update(key, (w) => ({ ...w, z }));
	};
	const close = (key: string) =>
		setWins((ws) => ws.filter((w) => w.key !== key));
	const toggleMin = (key: string) => {
		const z = ++zTop.current;
		update(key, (w) => ({ ...w, min: !w.min, z }));
	};
	const flyTo = (w: Win) => {
		const m = getMap();
		if (!m || !w.anchor) return;
		m.flyTo({ center: w.anchor, zoom: Math.max(m.getZoom(), 5), speed: 1.4 });
	};

	if (!wins.length) return null;

	const card = (w: Win) => {
		const sev = (w.p.severity || "info").toLowerCase();
		const col = SEV_COL[sev] ?? "var(--dim)";
		const lat = Number(w.p.lat);
		const lon = Number(w.p.lon);
		const pos = Number.isFinite(lat) && Number.isFinite(lon);
		return (
			<>
				<div
					className="popwin-head"
					onPointerDown={(e) => {
						if (compact || (e.target as HTMLElement).closest("button")) return;
						front(w.key);
						e.currentTarget.setPointerCapture(e.pointerId);
						drag.current = {
							key: w.key,
							dx: e.clientX - w.x,
							dy: e.clientY - w.y,
						};
					}}
					onPointerMove={(e) => {
						const d = drag.current;
						if (!d || d.key !== w.key) return;
						const p = clampPos(e.clientX - d.dx, e.clientY - d.dy);
						update(w.key, (x) => ({ ...x, ...p }));
					}}
					onPointerUp={() => {
						drag.current = null;
					}}
					onDoubleClick={() => !compact && toggleMin(w.key)}
				>
					<span className="popwin-sev" style={{ background: col }} />
					<span className="popwin-t" title={w.p.title}>
						{w.p.title || w.p.id}
					</span>
					{!compact && (
						<button
							type="button"
							data-pop-act="min"
							aria-label="Minimise window"
							title="Minimise (double-click the header)"
							onClick={() => toggleMin(w.key)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M6 12h12" />
							</svg>
						</button>
					)}
					<button
						type="button"
						data-pop-act="close"
						aria-label="Close window"
						onClick={() => close(w.key)}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M6 6l12 12M18 6 6 18" />
						</svg>
					</button>
				</div>
				<div className="popwin-body">
					<div className="hov-m">
						<span className="sev-tag" style={{ color: col }}>
							{sev.toUpperCase()}
						</span>{" "}
						· {w.p.layer}
					</div>
					<div className="hov-grid">
						<span>SRC</span>
						<span>{w.p.source || "?"}</span>
						<span>AGE</span>
						<span>{ageStr(w.p.ts)}</span>
						{pos && (
							<>
								<span>POS</span>
								<span>
									{lat.toFixed(2)}, {lon.toFixed(2)}
								</span>
							</>
						)}
					</div>
					{w.gone && (
						<div className="popwin-gone">
							Not in the current feed — last known state.
						</div>
					)}
					<div className="hov-act">
						<button
							type="button"
							className="primary"
							data-pop-act="full"
							onClick={() => onFull(w.p)}
						>
							Full view
						</button>
						<button
							type="button"
							className="ghost"
							data-pop-act="fly"
							disabled={!w.anchor}
							onClick={() => flyTo(w)}
						>
							Fly to
						</button>
					</div>
				</div>
			</>
		);
	};

	if (compact)
		return (
			<section className="pop-stack" aria-label="Popped-out objects">
				{wins.map((w) => (
					<div
						key={w.key}
						className="popwin"
						role="dialog"
						aria-label={w.p.title}
					>
						{card(w)}
					</div>
				))}
			</section>
		);

	// Stacking follows focus order; ranks, not raw counters, go to CSS.
	const rank = new Map(
		[...wins].sort((a, b) => a.z - b.z).map((w, i) => [w.key, i]),
	);
	const open = wins.filter((w) => !w.min);
	const minimised = wins.filter((w) => w.min);
	const map = getMap();
	const rect = map?.getContainer().getBoundingClientRect();
	const lines = open.flatMap((w) => {
		if (!map || !rect || !w.anchor) return [];
		const [lng, lat] = w.anchor;
		// Globe: a point on the far side has no line (internal API, guarded).
		const occluded = (
			map as unknown as {
				transform?: { isLocationOccluded?: (ll: unknown) => boolean };
			}
		).transform?.isLocationOccluded?.({ lng, lat });
		if (occluded) return [];
		const s = map.project(w.anchor);
		const ax = s.x + rect.left;
		const ay = s.y + rect.top;
		if (ax < 0 || ay < 0 || ax > window.innerWidth || ay > window.innerHeight)
			return [];
		// Under a panel (or another window) the point isn't visible — a line
		// into the middle of a panel reads as a glitch, so draw none.
		if (!document.elementFromPoint(ax, ay)?.closest("#map")) return [];
		const h = els.current.get(w.key)?.offsetHeight ?? 160;
		// Nearest point on the window's border; none when the point is under it.
		const bx = Math.min(Math.max(ax, w.x), w.x + WIN_W);
		const by = Math.min(Math.max(ay, w.y), w.y + h);
		if (bx === ax && by === ay) return [];
		return [{ key: w.key, ax, ay, bx, by }];
	});

	return (
		<>
			<svg className="pop-lines" aria-hidden="true">
				{lines.map((l) => (
					<g key={l.key}>
						<line
							className="pop-line"
							x1={l.bx}
							y1={l.by}
							x2={l.ax}
							y2={l.ay}
						/>
						<circle className="pop-dot" cx={l.ax} cy={l.ay} r={4} />
					</g>
				))}
			</svg>
			{open.map((w) => (
				<div
					key={w.key}
					ref={(el) => {
						if (el) els.current.set(w.key, el);
						else els.current.delete(w.key);
					}}
					className="popwin"
					role="dialog"
					aria-label={w.p.title}
					style={{ left: w.x, top: w.y, zIndex: 30 + (rank.get(w.key) ?? 0) }}
					onPointerDown={() => front(w.key)}
				>
					{card(w)}
				</div>
			))}
			{minimised.length > 0 && (
				<section className="pop-tray" aria-label="Minimised windows">
					{minimised.map((w) => (
						<button
							key={w.key}
							type="button"
							className="pop-chip"
							title={`Restore: ${w.p.title}`}
							onClick={() => toggleMin(w.key)}
						>
							<span
								className="popwin-sev"
								style={{
									background:
										SEV_COL[(w.p.severity || "").toLowerCase()] ?? "var(--dim)",
								}}
							/>
							<span className="pop-chip-t">{w.p.title || w.p.id}</span>
						</button>
					))}
				</section>
			)}
		</>
	);
}

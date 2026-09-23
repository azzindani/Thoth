"use client";
import type * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import CmdBar from "../components/CmdBar";
import EntityGraph from "../components/EntityGraph";
import Explorer from "../components/Explorer";
import Inspector, { CompleteView, type Tab } from "../components/Inspector";
import MapView, { loadAll, type ObjProps, setVis } from "../components/MapView";
import MiniMap from "../components/MiniMap";
import {
	type Action,
	CommandPalette,
	ShortcutSheet,
} from "../components/Palette";
import PopWindows, { LAYERS_EVENT } from "../components/PopWindows";
import Replay from "../components/Replay";
import ThreatClock from "../components/ThreatClock";
import Ticker from "../components/Ticker";
import Timeline from "../components/Timeline";
import { API, api } from "../lib/api";
import { LAYER_NAMES, MISSIONS } from "../lib/layer-catalog";

type Hidden = { expl: boolean; insp: boolean; dock: boolean };
const NO_HIDDEN: Hidden = { expl: false, insp: false, dock: false };
const HIDDEN_KEY = "thoth.hidden";
const PANEL_LABEL: Record<keyof Hidden, string> = {
	expl: "Layers",
	insp: "Inspector",
	dock: "Command",
};

export default function Terminal() {
	const [visible, setVisible] = useState<Record<string, boolean>>(() =>
		Object.fromEntries(LAYER_NAMES.map((k) => [k, true])),
	);
	const [sev, setSev] = useState("");
	const [since, setSince] = useState<string | null>(null);
	const [mode, setMode] = useState("default");
	const [globe, setGlobe] = useState(true);
	const [tab, setTab] = useState<Tab>("object");
	const [sel, setSel] = useState<ObjProps | null>(null);
	const [full, setFull] = useState<ObjProps | null>(null);
	// Map taps pin the preview card and open nothing — hover stays hover,
	// the complete view is one explicit button away. The inspector panel
	// underneath stays the data sink for tests and osint flows.
	const preview = useCallback((p: ObjProps) => {
		setSel(p);
	}, []);
	const selectFull = useCallback((p: ObjProps) => {
		setSel(p);
		setTab("object");
		setOsint(null);
		setFull(p);
	}, []);
	const [counts, setCounts] = useState<Map<string, string>>(new Map());
	const [mission, setMission] = useState("");
	const [palOpen, setPalOpen] = useState(false);
	const [replayOn, setReplayOn] = useState(false);
	const [keysOpen, setKeysOpen] = useState(false);
	const [theaterList, setTheaterList] = useState<[string, string][]>([]);
	const [osint, setOsint] = useState<{ kind: string; arg: string } | null>(
		null,
	);
	const [toasts, setToasts] = useState<{ id: string; title: string }[]>([]);
	const [sse, setSse] = useState({ ok: false, last: 0, n: 0 });
	const [changelog, setChangelog] = useState(false);
	const [focus, setFocus] = useState(false);
	// Collapsible chrome: each persistent panel can slide off-screen to an
	// edge tab; "clear view" (\) hides all three. Remembered per browser.
	const [hidden, setHidden] = useState<Hidden>(NO_HIDDEN);
	// true until the first user toggle: load/restore jumps the camera.
	const restoring = useRef(true);
	const clear = hidden.expl && hidden.insp && hidden.dock;
	const toggleClear = useCallback(() => {
		restoring.current = false;
		setHidden((h) => {
			const all = h.expl && h.insp && h.dock;
			return { expl: !all, insp: !all, dock: !all };
		});
	}, []);
	const [graph, setGraph] = useState(false);
	// syncPadding is defined below; effects above it reach it through this.
	const syncPaddingRef = useRef<(animate?: boolean) => void>(() => {});
	const padSnap = useRef<ReturnType<typeof setTimeout>>(undefined);
	const seenCrit = useRef<Set<string>>(new Set());
	const mapRef = useRef<maplibregl.Map | null>(null);
	const getMap = useCallback(() => mapRef.current, []);
	const stRef = useRef({ visible, sev, since });
	stRef.current = { visible, sev, since };

	const refreshStats = useCallback(async () => {
		try {
			// Feed health lives in the MONITOR tab now (own fetch); the page
			// only needs layer counts — one call, not two.
			const s = await api.stats();
			setCounts(new Map(s.items.map((i) => [i.layer, i.count])));
		} catch {
			/* keep */
		}
	}, []);

	useEffect(() => {
		refreshStats();
	}, [refreshStats]);

	useEffect(() => {
		document.body.classList.toggle("focus", focus);
	}, [focus]);

	// Restore the remembered panel state once, after hydration (storage can
	// be absent or throw in private windows — then everything stays shown).
	useEffect(() => {
		try {
			const raw = localStorage.getItem(HIDDEN_KEY);
			if (raw) setHidden({ ...NO_HIDDEN, ...(JSON.parse(raw) as Hidden) });
		} catch {
			/* keep defaults */
		}
	}, []);
	useEffect(() => {
		const b = document.body.classList;
		b.toggle("hide-expl", hidden.expl);
		b.toggle("hide-insp", hidden.insp);
		b.toggle("hide-dock", hidden.dock);
		try {
			localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
		} catch {
			/* not persisted */
		}
		// The camera re-centres into the space the panels give back; the
		// initial/restored state jumps instead of animating.
		syncPaddingRef.current(!restoring.current);
	}, [hidden]);
	const setPanel = useCallback((k: keyof Hidden, v: boolean) => {
		restoring.current = false;
		setHidden((h) => (h[k] === v ? h : { ...h, [k]: v }));
	}, []);
	// Toggle from the latest state, never a render-time snapshot: a click
	// that lands before a pending re-render must still flip the panel.
	const togglePanel = useCallback((k: keyof Hidden) => {
		restoring.current = false;
		setHidden((h) => ({ ...h, [k]: !h[k] }));
	}, []);

	// Reveal the inspector for explicit content only (osint lookups, other
	// tabs, the full view) — a bare map-tap preview must never yank a panel
	// open. On small screens an open full view IS the card: the inspector
	// sheet stays shut until the full view closes (then it falls back open).
	useEffect(() => {
		const insp = document.getElementById("inspector");
		if (!insp) return;
		const small = document.body.dataset.bp !== "desk";
		if (osint || tab !== "object") {
			insp.classList.add("open");
			setHidden((h) => (h.insp ? { ...h, insp: false } : h));
		} else if (full && small) insp.classList.remove("open");
	}, [tab, osint, full]);

	const applyMission = useCallback(
		(m: string) => {
			setMission(m);
			const set = m ? MISSIONS[m] : null;
			setVisible((v) => {
				const nv = Object.fromEntries(
					Object.keys(v).map((l) => [l, !set || set.includes(l)]),
				);
				const map = mapRef.current;
				if (map) for (const l of Object.keys(nv)) setVis(map, l, nv);
				return nv;
			});
			refreshStats();
		},
		[refreshStats],
	);
	// keyboard shortcuts: / focus-cmd · \ clear view · g globe · s mode · m mission · f focus · e graph · i inspector · esc close
	useEffect(() => {
		const modes = ["default", "sat", "nvg"];
		const missions = [
			"",
			"crisis",
			"cyber",
			"markets",
			"disaster",
			"intel",
			"wartime",
		];
		function onKey(e: KeyboardEvent) {
			const tag = (document.activeElement?.tagName ?? "").toLowerCase();
			const typing = tag === "input" || tag === "select" || tag === "textarea";
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setKeysOpen(false);
				setPalOpen((o) => !o);
			} else if (!typing && e.key === "?") {
				e.preventDefault();
				setPalOpen(false);
				setKeysOpen((o) => !o);
			} else if (e.key === "/" && !typing) {
				e.preventDefault();
				// A hidden dock slides back first; focus once it is laid out.
				setPanel("dock", false);
				requestAnimationFrame(() => document.getElementById("cmd")?.focus());
			} else if (!typing && e.key === "\\") {
				e.preventDefault();
				toggleClear();
			} else if (e.key === "Escape") {
				setPalOpen(false);
				setKeysOpen(false);
				document.getElementById("inspector")?.classList.remove("open");
				setOsint(null);
				setFull(null);
			} else if (!typing && e.key === "g") {
				setGlobe((g) => !g);
			} else if (!typing && e.key === "s") {
				setMode((m) => modes[(modes.indexOf(m) + 1) % modes.length]);
			} else if (!typing && e.key === "m") {
				applyMission(
					missions[(missions.indexOf(mission) + 1) % missions.length],
				);
			} else if (!typing && e.key === "f") {
				setFocus((f) => !f);
			} else if (!typing && e.key === "e") {
				setGraph((g) => !g);
			} else if (!typing && e.key === "i") {
				// Desk: show/hide the floating panel (FOCUS keeps its old job of
				// expanding the rail). Tablet/phone: open/close the sheet.
				const b = document.body;
				if (b.dataset.bp === "desk" && !b.classList.contains("focus"))
					togglePanel("insp");
				else document.getElementById("inspector")?.classList.toggle("open");
			}
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [mission, applyMission, setPanel, togglePanel, toggleClear]);

	// breakpoint mirror (responsive contract)
	useEffect(() => {
		function bp() {
			const w = window.innerWidth;
			document.body.dataset.bp =
				w >= 1200 ? "desk" : w >= 768 ? "tab" : "phone";
		}
		bp();
		window.addEventListener("resize", bp);
		return () => window.removeEventListener("resize", bp);
	}, []);

	// Floating chrome: the map is full-bleed, so tell the camera which part
	// of the viewport the persistent panels cover — the globe and every
	// flyTo then centre in the free area, not behind a panel. Overlay sheets
	// (tablet inspector, phone sheets) are excluded on purpose: opening one
	// must never shift the map.
	// Layout boxes (offset*), not getBoundingClientRect: panels slide with
	// transforms, and the camera must target where they come to rest.
	// Hidden panels give their side back entirely.
	const syncPadding = useCallback((animate = false) => {
		const el = (id: string) => document.getElementById(id);
		const hid = (c: string) => document.body.classList.contains(c);
		// The dock's height is content-driven; publish the measured value so
		// the chrome stacked above it (minimap, toasts, full view) clears it.
		const dock = el("bottom");
		if (dock?.offsetHeight)
			document.documentElement.style.setProperty(
				"--dock-h",
				`${dock.offsetHeight}px`,
			);
		// A newer layout supersedes a pending snap from an earlier ease.
		clearTimeout(padSnap.current);
		const map = mapRef.current;
		if (!map) return;
		const bp = document.body.dataset.bp;
		const GAP = 8;
		const W = window.innerWidth;
		const H = window.innerHeight;
		const tk = el("ticker");
		const top = tk ? tk.offsetTop + tk.offsetHeight : 0;
		const bottom = dock && !hid("hide-dock") ? H - dock.offsetTop : 0;
		const ex = el("explorer");
		const left =
			bp === "phone" || !ex || hid("hide-expl")
				? 0
				: ex.offsetLeft + ex.offsetWidth;
		const insp = el("inspector");
		const right =
			bp === "desk" && insp && insp.offsetWidth > 0 && !hid("hide-insp")
				? W - insp.offsetLeft
				: 0;
		const padding = {
			top: top + GAP,
			bottom: bottom ? bottom + GAP : GAP,
			left: left ? left + GAP : 0,
			right: right ? right + GAP : 0,
		};
		try {
			if (animate) {
				map.easeTo({ padding, duration: 260 });
				// Any other camera move (a drag, a flyTo, a resize) cancels the
				// ease midway and would strand the padding: land it exactly.
				padSnap.current = setTimeout(() => {
					try {
						map.setPadding(padding);
					} catch {
						/* map gone */
					}
				}, 320);
			} else map.setPadding(padding);
		} catch {
			/* map not ready */
		}
	}, []);
	syncPaddingRef.current = syncPadding;
	useEffect(() => {
		const ro = new ResizeObserver(() => syncPadding());
		for (const id of ["ticker", "explorer", "inspector", "bottom"]) {
			const el = document.getElementById(id);
			if (el) ro.observe(el);
		}
		const onResize = () => syncPadding();
		window.addEventListener("resize", onResize);
		return () => {
			ro.disconnect();
			window.removeEventListener("resize", onResize);
		};
	}, [syncPadding]);

	// SSE with resume
	useEffect(() => {
		// watch matches seed silently on first run, toast only new arrivals
		let watchSeeded = false;
		const seenWatch = new Set<string>();
		async function checkWatch() {
			try {
				const j = await api.watchMatches();
				const fresh = j.items.filter((w) => !seenWatch.has(w.id));
				for (const w of j.items) seenWatch.add(w.id);
				if (!watchSeeded) {
					watchSeeded = true;
					return;
				}
				if (fresh.length) {
					setToasts((t) =>
						[
							...fresh.slice(0, 3).map((w) => ({
								id: w.id,
								title: `WATCH · ${w.title ?? w.id}`,
							})),
							...t,
						].slice(0, 5),
					);
					setTimeout(
						() =>
							setToasts((t) =>
								t.filter((x) => !fresh.some((f) => f.id === x.id)),
							),
						9000,
					);
				}
			} catch {
				/* keep */
			}
		}
		// critical-alert toasts on fresh criticals (effect-local: no stale deps)
		async function checkToasts() {
			try {
				const j = await api.alerts(50);
				const fresh = j.items.filter(
					(a) => a.severity === "critical" && !seenCrit.current.has(a.id),
				);
				for (const a of j.items) seenCrit.current.add(a.id);
				if (fresh.length) {
					setToasts((t) =>
						[
							...fresh.map((a) => ({ id: a.id, title: a.title ?? a.id })),
							...t,
						].slice(0, 5),
					);
					setTimeout(
						() =>
							setToasts((t) =>
								t.filter((x) => !fresh.some((f) => f.id === x.id)),
							),
						9000,
					);
				}
			} catch {
				/* keep */
			}
		}
		const known: Record<string, string> = {};
		// Trailing throttle: worker ticks bump versions every ~60s across
		// many layers, and every bump re-fetches + re-clusters (killing open
		// hover cards mid-read as clusters dissolve under a static cursor).
		// Collectors poll slower than this anyway, so per-layer 45s quiet
		// time loses nothing and calms the map. Stats/toasts/watch below
		// still run on every event — only the heavy reload is throttled.
		const lastLoad: Record<string, number> = {};
		const QUIET_MS = 45000;
		let es: EventSource | null = null;
		let stop = false;
		let timer: ReturnType<typeof setTimeout>;
		let wasDown = false;
		function markMsg() {
			setSse((s) => ({ ...s, ok: true, last: Date.now() }));
		}
		function connect() {
			if (stop) return;
			const q = Object.keys(known).length
				? `?known=${btoa(JSON.stringify(known))}`
				: "";
			es = new EventSource(`${API}/api/stream${q}`);
			es.onopen = () => {
				if (wasDown) {
					wasDown = false;
					setSse((s) => ({ ok: true, last: Date.now(), n: s.n + 1 }));
					refreshStats();
				} else {
					markMsg();
				}
			};
			es.addEventListener("heartbeat", () => markMsg());
			es.addEventListener("snapshot", (e) => {
				markMsg();
				try {
					for (const r of JSON.parse((e as MessageEvent).data).versions as {
						layer: string;
						version: string;
					}[])
						known[r.layer] = r.version;
				} catch {
					/* keep */
				}
			});
			es.addEventListener("layer_changed", async (e) => {
				markMsg();
				try {
					const d = JSON.parse((e as MessageEvent).data) as {
						layers: string[];
						versions?: { layer: string; version: string }[];
					};
					if (d.versions)
						for (const r of d.versions) known[r.layer] = r.version;
					// Popped-out windows re-read their layer (cheap, unthrottled).
					window.dispatchEvent(
						new CustomEvent(LAYERS_EVENT, { detail: d.layers }),
					);
					const map = mapRef.current;
					const st = stRef.current;
					const now = Date.now();
					const due = d.layers.filter(
						(l) => now - (lastLoad[l] ?? 0) > QUIET_MS,
					);
					for (const l of due) lastLoad[l] = now;
					if (map && due.length)
						await loadAll(map, due, {
							sev: st.sev,
							since: st.since,
							visible: st.visible,
							onSelect: (p, ll) => {
								preview(p);
								void ll;
							},
							onFull: (p) => {
								selectFull(p);
							},
						});
					refreshStats();
					checkToasts();
					checkWatch();
				} catch {
					/* keep */
				}
			});
			es.onerror = () => {
				wasDown = true;
				setSse((s) => ({ ...s, ok: false }));
				es?.close();
				timer = setTimeout(connect, 5000);
			};
		}
		connect();
		return () => {
			stop = true;
			es?.close();
			clearTimeout(timer);
		};
	}, [refreshStats, preview, selectFull]);

	// reload layers when sev/since change (visibility via ref: no reload storm)
	// biome-ignore lint/correctness/useExhaustiveDependencies: sev/since are trigger-only; values read from stRef
	useEffect(() => {
		const map = mapRef.current;
		if (!map?.isStyleLoaded()) return;
		const st = stRef.current;
		void loadAll(map, LAYER_NAMES, {
			sev: st.sev,
			since: st.since,
			visible: st.visible,
			onSelect: (p) => {
				preview(p);
			},
			onFull: (p) => {
				selectFull(p);
			},
		});
	}, [sev, since]);

	function toggleLayer(l: string, st?: boolean) {
		setVisible((v) => {
			const nv = { ...v, [l]: st ?? !v[l] };
			const map = mapRef.current;
			if (map) setVis(map, l, nv);
			return nv;
		});
		refreshStats();
	}
	function handleMode(m: string) {
		if (m === "globe") {
			setGlobe((g) => !g);
			return;
		}
		setMode(m === "dark" ? "default" : m);
	}
	async function flyTheater(key: string) {
		if (!key) return;
		try {
			const t = (await api.theaters()).theaters[key];
			if (!t) return;
			// theater config center is [lat, lng] → map needs [lng, lat]
			mapRef.current?.flyTo({
				center: [t.center[1], t.center[0]],
				zoom: Math.max(3, t.zoom - 1),
				duration: 2500,
			});
		} catch {
			/* keep */
		}
	}

	// Theater names for the palette (the explorer has its own copy).
	useEffect(() => {
		if (!palOpen || theaterList.length) return;
		api
			.theaters()
			.then((t) =>
				setTheaterList(
					Object.entries(t.theaters).map(([k, v]) => [
						k,
						(v as { label?: string }).label ?? k,
					]),
				),
			)
			.catch(() => {});
	}, [palOpen, theaterList.length]);

	// Built on render while the palette is open: it only reads current state.
	function buildActions(): Action[] {
		const tabs: Tab[] = [
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
		];
		const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
		return [
			...tabs.map((t) => ({
				id: `tab-${t}`,
				group: "Open",
				label: `${cap(t)} tab`,
				run: () => {
					setTab(t);
					setPanel("insp", false);
					document.getElementById("inspector")?.classList.add("open");
				},
			})),
			...LAYER_NAMES.map((l) => ({
				id: `layer-${l}`,
				group: "Layer",
				label: `${visible[l] ? "Hide" : "Show"} ${l}`,
				run: () => toggleLayer(l),
			})),
			...(
				[
					["default", "Dark map"],
					["sat", "Satellite imagery"],
					["nvg", "Night vision"],
					["cinema", "Cinema (auto-rotate)"],
				] as const
			).map(([m, label]) => ({
				id: `mode-${m}`,
				group: "Mode",
				label,
				hint: m === "default" ? "s" : undefined,
				run: () => setMode(m),
			})),
			{
				id: "mode-globe",
				group: "Mode",
				label: globe ? "Flat map" : "Globe",
				hint: "g",
				run: () => setGlobe((g) => !g),
			},
			...Object.keys(MISSIONS).map((m) => ({
				id: `mission-${m}`,
				group: "Mission",
				label: cap(m),
				run: () => applyMission(m),
			})),
			{
				id: "mission-all",
				group: "Mission",
				label: "All layers",
				run: () => applyMission(""),
			},
			...theaterList.map(([k, label]) => ({
				id: `theater-${k}`,
				group: "Fly to",
				label,
				run: () => void flyTheater(k),
			})),
			{
				id: "view-clear",
				group: "View",
				label: clear ? "Show all panels" : "Clear view (hide all panels)",
				hint: "\\",
				run: toggleClear,
			},
			{
				id: "view-insp",
				group: "View",
				label: hidden.insp ? "Show inspector" : "Hide inspector",
				hint: "i",
				run: () => togglePanel("insp"),
			},
			{
				id: "view-expl",
				group: "View",
				label: hidden.expl ? "Show layers panel" : "Hide layers panel",
				run: () => togglePanel("expl"),
			},
			{
				id: "view-focus",
				group: "View",
				label: "Focus mode",
				hint: "f",
				run: () => setFocus((f) => !f),
			},
			{
				id: "view-replay",
				group: "View",
				label: replayOn
					? "Leave time replay (live)"
					: "Time replay — last 72 h",
				run: () => setReplayOn((r) => !r),
			},
			{
				id: "view-graph",
				group: "View",
				label: "Entity graph",
				hint: "e",
				run: () => setGraph((g) => !g),
			},
			{
				id: "cmd-line",
				group: "Go",
				label: "Command line",
				hint: "/",
				run: () => {
					setPanel("dock", false);
					requestAnimationFrame(() => document.getElementById("cmd")?.focus());
				},
			},
			{
				id: "keys",
				group: "Help",
				label: "Keyboard shortcuts",
				hint: "?",
				run: () => setKeysOpen(true),
			},
		];
	}

	return (
		<main className="app">
			<CommandPalette
				open={palOpen}
				onClose={() => setPalOpen(false)}
				actions={palOpen ? buildActions() : []}
			/>
			<ShortcutSheet open={keysOpen} onClose={() => setKeysOpen(false)} />
			<Ticker
				mode={mode}
				setMode={(m) => setMode(m === "dark" ? "default" : m)}
				globe={globe}
				setGlobe={setGlobe}
				sse={sse}
				onMonitor={() => setTab("monitor")}
				focus={focus}
				setFocus={setFocus}
				clear={clear}
				onClear={toggleClear}
			/>
			<div className="main" id="main">
				<Explorer
					counts={counts}
					visible={visible}
					onToggle={(l) => toggleLayer(l)}
					sev={sev}
					setSev={setSev}
					onMonitor={() => setTab("monitor")}
					mission={mission}
					setMission={applyMission}
					onTheater={flyTheater}
				/>
				<MapView
					visible={visible}
					sev={sev}
					since={since}
					mode={mode}
					globe={globe}
					onSelect={(p) => {
						preview(p);
					}}
					onFull={(p) => {
						selectFull(p);
					}}
					onArea={() => setTab("area")}
					overlay={
						<>
							<MiniMap getMap={getMap} />
							{graph && (
								<EntityGraph
									getMap={getMap}
									sel={sel}
									onSelect={(p) => {
										selectFull(p);
									}}
									onClose={() => setGraph(false)}
								/>
							)}
						</>
					}
					mapCb={(m) => {
						mapRef.current = m;
						syncPadding();
						// shareable URL state: #c=lng,lat,z (world-dashboard urlstate pattern)
						m.on("moveend", () => {
							try {
								const c = m.getCenter();
								window.location.hash = `c=${c.lng.toFixed(2)},${c.lat.toFixed(2)},${m.getZoom().toFixed(1)}`;
							} catch {
								/* keep */
							}
						});
					}}
				/>
				<Inspector
					tab={tab}
					setTab={setTab}
					sel={sel}
					osint={osint}
					onClose={() =>
						document.getElementById("inspector")?.classList.remove("open")
					}
					onOsint={(kind, arg) => {
						setOsint({ kind, arg });
						setTab("object");
					}}
				/>
			</div>
			<div className="bottom" id="bottom">
				<div className="tl-row">
					<ThreatClock />
					<div style={{ flex: 1, minWidth: 0 }}>
						{replayOn ? (
							<Replay getMap={getMap} />
						) : (
							<Timeline since={since} setSince={setSince} />
						)}
					</div>
					<button
						type="button"
						id="replay-btn"
						className={`ghost-btn${replayOn ? " on" : ""}`}
						title={
							replayOn
								? "back to the live picture"
								: "time replay: scrub or play the last 72 hours"
						}
						aria-label={replayOn ? "leave replay" : "time replay"}
						onClick={() => setReplayOn((r) => !r)}
						style={{ alignSelf: "center" }}
					>
						{replayOn ? "LIVE" : "REPLAY"}
					</button>
					<button
						className={`ghost-btn${graph ? " on" : ""}`}
						title="entity graph (e)"
						onClick={() => setGraph((g) => !g)}
						style={{ alignSelf: "center" }}
					>
						GRAPH
					</button>
				</div>
				<CmdBar
					onLayer={(l, st) => toggleLayer(l, st)}
					onMode={handleMode}
					onDossier={() => setTab("area")}
					onSdn={() => setTab("sdn")}
					onAlerts={() => setTab("alerts")}
					onTab={(t) => setTab(t as Tab)}
					onOsint={(kind, arg) => {
						setOsint({ kind, arg });
						setTab("object");
					}}
					onChangelog={() => setChangelog(true)}
					onFocus={() => setFocus((f) => !f)}
				/>
			</div>
			<PopWindows getMap={getMap} onFull={selectFull} />
			{/* Edge handles: a slim grip on each panel's inner edge; when the
			panel is hidden it becomes a labelled tab on the screen edge. */}
			{(["expl", "insp", "dock"] as const).map((k) => (
				<button
					key={k}
					type="button"
					id={`pt-${k}`}
					className={`ptoggle pt-${k}${hidden[k] ? " is-hidden" : ""}`}
					aria-expanded={!hidden[k]}
					aria-label={`${hidden[k] ? "Show" : "Hide"} ${PANEL_LABEL[k].toLowerCase()} panel`}
					title={`${hidden[k] ? "Show" : "Hide"} ${PANEL_LABEL[k].toLowerCase()} (\\ hides all)`}
					onClick={() => togglePanel(k)}
				>
					<svg className="pt-chev" viewBox="0 0 24 24" aria-hidden="true">
						<path d="m15 18-6-6 6-6" />
					</svg>
					<span className="pt-label">{PANEL_LABEL[k]}</span>
				</button>
			))}
			{toasts.length > 0 && (
				<div className="toasts">
					{toasts.map((t) => (
						<div key={t.id} className="toast">
							<b style={{ color: "var(--red)" }}>● CRITICAL</b> · {t.title}
						</div>
					))}
				</div>
			)}
			{full && <CompleteView sel={full} onClose={() => setFull(null)} />}
			{changelog && (
				<div className="modal-veil" onClick={() => setChangelog(false)}>
					<div className="modal" onClick={(e) => e.stopPropagation()}>
						<h3>CHANGELOG</h3>
						<div className="ibody" style={{ maxHeight: "60vh" }}>
							<div className="item">
								<b>Phase 4</b> · NEWS/MARKETS/CYBER tabs · toasts · shortcuts ·
								changelog
							</div>
							<div className="item">
								<b>Phase 3</b> · Next.js rebuild, parity with terminal
							</div>
							<div className="item">
								<b>Phase 2</b> · freeze alarms · SSE resume · video wall
							</div>
							<div className="item">
								<b>Phase 1</b> · 25 layers · 36 feeds · 11 static datasets · 7
								OSINT endpoints
							</div>
							<div className="item">
								<b>Phase 0</b> · 7 PORT docs · primitives + responsive contract
							</div>
						</div>
						<button className="go" onClick={() => setChangelog(false)}>
							Close
						</button>
					</div>
				</div>
			)}
		</main>
	);
}

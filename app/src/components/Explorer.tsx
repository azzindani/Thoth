"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
	groupedLayers,
	LAYER_NAMES,
	LAYERS,
	MISSIONS,
} from "../lib/layer-catalog";
import { SheetHead } from "../lib/sheet";
import { Chip, Field, fmtCadence, LayerRow, Switch } from "../lib/ui";
import { LAYER_STATUS_EVENT, layerErrors, loadedCount } from "./MapView";

export default function Explorer({
	counts,
	visible,
	onToggle,
	onSetLayers,
	onClose,
	onTheater,
	sev,
	setSev,
	onMonitor,
	mission,
	setMission,
}: {
	counts: Map<string, string>;
	visible: Record<string, boolean>;
	onToggle: (l: string) => void;
	onSetLayers: (ls: string[], on: boolean) => void;
	onClose: () => void;
	sev: string;
	setSev: (s: string) => void;
	onMonitor: () => void;
	mission: string;
	setMission: (m: string) => void;
	onTheater: (key: string) => void;
}) {
	const [find, setFind] = useState("");
	// Tablet: the rail expands into the full panel (labels, filters,
	// missions, search) over the map; a tap outside folds it back.
	const [expanded, setExpanded] = useState(false);
	useEffect(() => {
		if (!expanded) return;
		const off = (e: PointerEvent) => {
			if (!(e.target as HTMLElement).closest?.("#explorer")) setExpanded(false);
		};
		document.addEventListener("pointerdown", off);
		return () => document.removeEventListener("pointerdown", off);
	}, [expanded]);
	const [errors, setErrors] = useState<Map<string, string>>(new Map());
	// bumps on every layer load, so severity-filtered counts stay current
	const [, setTick] = useState(0);
	useEffect(() => {
		const on = () => {
			setErrors(new Map(layerErrors));
			setTick((t) => t + 1);
		};
		window.addEventListener(LAYER_STATUS_EVENT, on);
		return () => window.removeEventListener(LAYER_STATUS_EVENT, on);
	}, []);
	const shown = LAYER_NAMES.filter((l) =>
		l.includes(find.trim().toLowerCase()),
	);
	const [theaters, setTheaters] = useState<Record<string, { label: string }>>(
		{},
	);
	useEffect(() => {
		api
			.theaters()
			.then((t) => setTheaters(t.theaters))
			.catch(() => {});
	}, []);
	return (
		<div className={`explorer${expanded ? " expanded" : ""}`} id="explorer">
			<button
				type="button"
				className="rail-expand tab-only"
				aria-expanded={expanded}
				aria-label={expanded ? "collapse layers panel" : "expand layers panel"}
				title={expanded ? "collapse" : "layers, filters and missions"}
				onClick={() => setExpanded((x) => !x)}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					{expanded ? (
						<path d="m15 18-6-6 6-6" />
					) : (
						<path d="M4 6h16M4 12h16M4 18h16" />
					)}
				</svg>
			</button>
			<SheetHead title="Layers" onClose={onClose} closeButton />
			<div className="expl-body">
				<h3>View</h3>
				{Object.keys(theaters).length > 0 && (
					<div className="row2 theater" style={{ marginBottom: 8 }}>
						<select
							defaultValue=""
							onChange={(e) => {
								onTheater(e.target.value);
								e.target.value = "";
							}}
						>
							<option value="">Theater · fly to…</option>
							{Object.entries(theaters).map(([k, t]) => (
								<option key={k} value={k}>
									{t.label}
								</option>
							))}
						</select>
					</div>
				)}
				<div className="row2 mission" style={{ marginBottom: 8 }}>
					<select value={mission} onChange={(e) => setMission(e.target.value)}>
						<option value="">Mission · all</option>
						<option value="crisis">Crisis desk</option>
						<option value="cyber">Cyber watch</option>
						<option value="markets">Markets</option>
						<option value="disaster">Disaster response</option>
						<option value="intel">Intel map</option>
						<option value="wartime">Wartime</option>
					</select>
				</div>
				<div className="chips" id="sev-chips">
					{["", "critical", "watch", "info"].map((s) => (
						<Chip key={s} active={sev === s} onClick={() => setSev(s)}>
							{s === ""
								? "All"
								: s === "critical"
									? "Critical"
									: s[0].toUpperCase() + s.slice(1)}
						</Chip>
					))}
				</div>
				<div className="legend" aria-label="map legend">
					<span>
						<i className="lg-ring" style={{ borderColor: "var(--red)" }} />
						critical
					</span>
					<span>
						<i className="lg-ring" style={{ borderColor: "var(--amber)" }} />
						watch
					</span>
					<span>
						<i className="lg-ring" />
						info
					</span>
					<span>
						<i className="lg-count">12</i>
						grouped
					</span>
				</div>
				<h3 style={{ marginTop: 16 }}>
					Layers
					{sev && <span className="h3-note"> · {sev} in view</span>}
				</h3>
				<div className="findbox" style={{ marginBottom: 2 }}>
					<Field
						placeholder="Find layers…"
						value={find}
						onChange={(e) => setFind(e.target.value)}
					/>
				</div>
				<div id="layer-rows">
					{shown.length === 0 && (
						<div className="dim lrow-none">
							No layer matches “{find.trim()}”.
						</div>
					)}
					{groupedLayers(shown).map(([group, layers]) => {
						const on = layers.filter((l) => visible[l]).length;
						const all = on === layers.length;
						return (
							<div key={group} className="lgroup-wrap">
								<div
									className="lgroup"
									role="switch"
									aria-checked={all ? true : on ? "mixed" : false}
									aria-label={`all ${group} layers`}
									tabIndex={0}
									title={all ? `hide all ${group}` : `show all ${group}`}
									onClick={() => onSetLayers(layers, !all)}
									onKeyDown={(e) => {
										if (e.key === " " || e.key === "Enter") {
											e.preventDefault();
											onSetLayers(layers, !all);
										}
									}}
								>
									<span className="lg-nm">{group}</span>
									<span className="lg-n">
										{on}/{layers.length}
									</span>
									<Switch on={on > 0} mixed={on > 0 && !all} />
								</div>
								{layers.map((l) => {
									// With a severity filter the stored 24 h totals would not
									// match the map: count what the map holds instead.
									const c = sev
										? String(loadedCount(l))
										: (counts.get(l) ?? "0");
									const cad = LAYERS[l]
										? fmtCadence(LAYERS[l].intervalSec)
										: "?";
									return (
										<LayerRow
											key={l}
											name={l}
											count={c}
											visible={visible[l]}
											onToggle={() => onToggle(l)}
											error={errors.get(l)}
											title={`${l} · ${c} events · refresh every ${cad}${LAYERS[l]?.polygon ? " · polygon" : ""}`}
										/>
									);
								})}
							</div>
						);
					})}
				</div>
				{/* Feed health moved to the MONITOR inspector tab (tabular,
			grouped by collector with period + stale depth). This link keeps
			the production surface clean: layers here, servers there. */}
				<div className="explorer-foot">
					<button
						className="tbtn"
						id="monitor-link"
						onClick={onMonitor}
						title="open server monitor"
					>
						SERVER MONITOR
					</button>
					<div className="credit">
						Symbols: Lucide (ISC) · {Object.keys(MISSIONS).length} missions
					</div>
				</div>
			</div>
		</div>
	);
}

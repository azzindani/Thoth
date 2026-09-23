"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
	groupedLayers,
	LAYER_NAMES,
	LAYERS,
	MISSIONS,
} from "../lib/layer-catalog";
import { Chip, Field, fmtCadence, LayerRow } from "../lib/ui";

export default function Explorer({
	counts,
	visible,
	onToggle,
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
	sev: string;
	setSev: (s: string) => void;
	onMonitor: () => void;
	mission: string;
	setMission: (m: string) => void;
	onTheater: (key: string) => void;
}) {
	const [find, setFind] = useState("");
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
		<div className="explorer" id="explorer">
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
			<h3 style={{ marginTop: 16 }}>Layers</h3>
			<div className="findbox" style={{ marginBottom: 2 }}>
				<Field
					placeholder="Find layers…"
					value={find}
					onChange={(e) => setFind(e.target.value)}
				/>
			</div>
			<div id="layer-rows">
				{groupedLayers(shown).map(([group, layers]) => (
					<div key={group} className="lgroup-wrap">
						<div className="lgroup">{group}</div>
						{layers.map((l) => {
							const c = counts.get(l) ?? "0";
							const cad = LAYERS[l] ? fmtCadence(LAYERS[l].intervalSec) : "?";
							return (
								<LayerRow
									key={l}
									name={l}
									count={c}
									visible={visible[l]}
									onToggle={() => onToggle(l)}
									title={`${l} · ${c} events · refresh every ${cad}${LAYERS[l]?.polygon ? " · polygon" : ""}`}
								/>
							);
						})}
					</div>
				))}
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
	);
}

"use client";
// Incidents + anomalies (ROADMAP P4) as data tables. INCIDENTS: events
// from different layers/sources that cluster in space and time, one row
// each (expand for the timeline). ANOMALIES: map cells whose activity
// left their 7-day baseline (spikes and drops). Rows fly the map there.
// Both are ordinary layers (`incidents`, `anomalies`) built by the worker.
import { useEffect, useMemo, useState } from "react";
import { api, type LayerItem } from "../lib/api";
import { ageStr } from "../lib/ui";
import { type Column, DataTable } from "./DataTable";
import { flyTo } from "./MapView";

const REFRESH_MS = 30000;
type View = "incidents" | "anomalies";
const SEV_RANK: Record<string, number> = { critical: 0, watch: 1, info: 2 };

type Timeline = {
	id: string;
	ts: string;
	layer: string;
	source: string;
	severity: string;
	title: string | null;
	dups: number;
}[];
type IncMeta = {
	started?: string;
	updated?: string;
	events?: number;
	reports?: number;
	layers?: string[];
	sources?: string[];
	radius_km?: number;
	timeline?: Timeline;
};
type AnoMeta = {
	layer?: string;
	dir?: "drop" | "spike";
	n?: number;
	median?: number;
	z?: number;
	samples?: number;
};

/** Point or polygon → [lat, lon] to fly to. */
function where(i: LayerItem): [number, number] | null {
	const g = i.geom as {
		type: string;
		coordinates: unknown;
	} | null;
	if (!g) return null;
	if (g.type === "Point") {
		const [lon, lat] = g.coordinates as number[];
		return [lat, lon];
	}
	if (g.type === "Polygon") {
		const ring = (g.coordinates as number[][][])[0] ?? [];
		if (!ring.length) return null;
		const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
		const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
		return [lat, lon];
	}
	return null;
}

function Sev({ s }: { s?: string }) {
	return (
		<span className={`sev-${s || "info"}`}>{(s || "info").toUpperCase()}</span>
	);
}

function TimelineView({ t }: { t: Timeline }) {
	return (
		<div className="mon-detail inc-timeline">
			<div className="mon-sub">Timeline · oldest first</div>
			{t.map((e) => (
				<div key={e.id} className="mon-dline">
					<span className="mono dim">{ageStr(e.ts)}</span> ·{" "}
					<Sev s={e.severity} /> · <b>{e.layer}</b> · {e.title ?? e.id}
					<span className="dim">
						{" "}
						· {e.source}
						{e.dups
							? ` · +${e.dups} duplicate report${e.dups > 1 ? "s" : ""}`
							: ""}
					</span>
				</div>
			))}
		</div>
	);
}

export function IncidentsTab() {
	const [view, setView] = useState<View>("incidents");
	const [inc, setInc] = useState<LayerItem[] | null>(null);
	const [ano, setAno] = useState<LayerItem[] | null>(null);
	const [open, setOpen] = useState<string | null>(null);

	useEffect(() => {
		let stop = false;
		const load = () => {
			api
				.layer("incidents")
				.then((j) => !stop && setInc(j.items))
				.catch(() => !stop && setInc((v) => v ?? []));
			api
				.layer("anomalies")
				.then((j) => !stop && setAno(j.items))
				.catch(() => !stop && setAno((v) => v ?? []));
		};
		load();
		const t = setInterval(load, REFRESH_MS);
		return () => {
			stop = true;
			clearInterval(t);
		};
	}, []);

	const go = (i: LayerItem) => {
		const w = where(i);
		if (w) flyTo(w[0], w[1], i.layer === "anomalies" ? 4 : 6);
	};

	const incCols = useMemo<Column<LayerItem>[]>(
		() => [
			{
				key: "sev",
				label: "Severity",
				sort: (i) => SEV_RANK[i.severity ?? "info"] ?? 3,
				render: (i) => <Sev s={i.severity} />,
			},
			{
				key: "title",
				label: "Incident",
				sort: (i) => i.title ?? "",
				render: (i) => (
					<span className="dt-clip dt-key" title={i.title}>
						{(i.title ?? i.id).split(" — ")[0]}
					</span>
				),
			},
			{
				key: "reports",
				label: "Reports",
				num: true,
				sort: (i) => (i.meta as IncMeta)?.reports ?? 0,
				render: (i) => (i.meta as IncMeta)?.reports ?? "—",
			},
			{
				key: "layers",
				label: "Layers",
				sort: (i) => (i.meta as IncMeta)?.layers?.length ?? 0,
				render: (i) => (i.meta as IncMeta)?.layers?.join(", ") ?? "—",
			},
			{
				key: "sources",
				label: "Sources",
				wide: true,
				render: (i) => (i.meta as IncMeta)?.sources?.join(", ") ?? "—",
			},
			{
				key: "radius",
				label: "Spread",
				num: true,
				wide: true,
				sort: (i) => (i.meta as IncMeta)?.radius_km ?? 0,
				render: (i) => `${(i.meta as IncMeta)?.radius_km ?? 0} km`,
			},
			{
				key: "started",
				label: "Started",
				num: true,
				wide: true,
				sort: (i) => Date.parse((i.meta as IncMeta)?.started ?? "") || null,
				render: (i) => ageStr((i.meta as IncMeta)?.started),
			},
			{
				key: "updated",
				label: "Latest",
				num: true,
				sort: (i) => Date.parse(i.ts) || null,
				render: (i) => ageStr(i.ts),
			},
		],
		[],
	);

	const anoCols = useMemo<Column<LayerItem>[]>(
		() => [
			{
				key: "sev",
				label: "Severity",
				sort: (i) => SEV_RANK[i.severity ?? "info"] ?? 3,
				render: (i) => <Sev s={i.severity} />,
			},
			{
				key: "what",
				label: "Anomaly",
				sort: (i) => i.title ?? "",
				render: (i) => (
					<span className="dt-clip dt-key" title={i.title}>
						{(i.title ?? i.id).split(":")[0]}
					</span>
				),
			},
			{
				key: "now",
				label: "Last hour",
				num: true,
				sort: (i) => (i.meta as AnoMeta)?.n ?? 0,
				render: (i) => (i.meta as AnoMeta)?.n ?? "—",
			},
			{
				key: "usual",
				label: "Usual",
				num: true,
				sort: (i) => (i.meta as AnoMeta)?.median ?? 0,
				render: (i) => Math.round((i.meta as AnoMeta)?.median ?? 0),
			},
			{
				key: "z",
				label: "Score",
				num: true,
				wide: true,
				title: "robust z-score against the 7-day baseline",
				sort: (i) => Math.abs((i.meta as AnoMeta)?.z ?? 0),
				render: (i) => (i.meta as AnoMeta)?.z ?? "—",
			},
			{
				key: "layer",
				label: "Layer",
				wide: true,
				sort: (i) => (i.meta as AnoMeta)?.layer ?? "",
				render: (i) => (i.meta as AnoMeta)?.layer ?? "—",
			},
			{
				key: "seen",
				label: "Checked",
				num: true,
				sort: (i) => Date.parse(i.ts) || null,
				render: (i) => ageStr(i.ts),
			},
		],
		[],
	);

	const crit = (xs: LayerItem[] | null) =>
		(xs ?? []).filter((x) => x.severity === "critical").length;

	return (
		<div className="inc-tab">
			<div className="mon-head">
				<h3>
					Incidents · {inc?.length ?? "…"} · anomalies · {ano?.length ?? "…"}
				</h3>
			</div>
			<div className="mon-kpis" id="inc-kpis">
				<span className={`mon-kpi${crit(inc) ? " bad" : ""}`}>
					{crit(inc)} critical incidents
				</span>
				<span className={`mon-kpi${crit(ano) ? " bad" : ""}`}>
					{crit(ano)} critical anomalies
				</span>
			</div>
			<div className="mon-tools">
				<fieldset className="seg" aria-label="incident view">
					{(["incidents", "anomalies"] as View[]).map((v) => (
						<button
							key={v}
							type="button"
							className={`tbtn${view === v ? " mode-on" : ""}`}
							onClick={() => setView(v)}
						>
							{v.toUpperCase()}
						</button>
					))}
				</fieldset>
			</div>
			{view === "incidents" &&
				(inc === null ? (
					<div className="dim dt-empty">Loading…</div>
				) : (
					<DataTable
						label="Incidents"
						rows={inc}
						cols={incCols}
						rowKey={(i) => i.id}
						rowClass={() => "inc-row"}
						rowTitle={(i) => i.title}
						initialSort={{ key: "sev", dir: "asc" }}
						expanded={open}
						onRowClick={(i) => {
							setOpen(open === i.id ? null : i.id);
							go(i);
						}}
						renderExpanded={(i) => (
							<TimelineView t={(i.meta as IncMeta)?.timeline ?? []} />
						)}
						empty="No incidents: nothing corroborated across layers or sources in the last 48 hours."
					/>
				))}
			{view === "anomalies" &&
				(ano === null ? (
					<div className="dim dt-empty">Loading…</div>
				) : (
					<DataTable
						label="Anomalies"
						rows={ano}
						cols={anoCols}
						rowKey={(i) => i.id}
						rowClass={() => "ano-row"}
						rowTitle={(i) => i.title}
						initialSort={{ key: "sev", dir: "asc" }}
						onRowClick={go}
						empty="No anomalies: every watched layer is within its usual range (baselines need a day of history)."
					/>
				))}
		</div>
	);
}

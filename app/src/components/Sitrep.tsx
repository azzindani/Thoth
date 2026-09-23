"use client";
// Sitrep export (ROADMAP P5): a one-page situation report of what is on the
// screen — a snapshot of the map as drawn, then critical and watch items
// (last 24 h), the top incidents and the analyst's map notes, all limited
// to the current view (the world below zoom 3), plus feed gaps. PRINT
// goes through the browser's print dialog (Save as PDF); .MD downloads
// the same report as Markdown tables. Built in the browser from the
// public API: nothing is stored.
import type * as maplibregl from "maplibre-gl";
import { useEffect, useState } from "react";
import { api, type LayerItem } from "../lib/api";
import { where } from "./IncidentsTab";
import { snapshotMap } from "./MapView";

type Box = [number, number, number, number];
export type SitrepRow = {
	ts: string;
	severity: string;
	layer: string;
	source: string;
	title: string;
	lat: number | null;
	lon: number | null;
};
export type SitrepIncident = SitrepRow & {
	events: number;
	layers: string[];
};
export type SitrepNote = {
	title: string;
	body: string;
	lat: number;
	lon: number;
	ts: string;
};
export type SitrepData = {
	at: string;
	/** w,s,e,n of the view, or null for the world. */
	bbox: Box | null;
	image: string | null;
	critical: SitrepRow[];
	watch: SitrepRow[];
	incidents: SitrepIncident[];
	notes: SitrepNote[];
	gaps: { source: string; error: string | null }[];
};

const MAX_ROWS = 25;
const MAX_INCIDENTS = 10;

/** Inside w,s,e,n (w > e crosses the antimeridian); null box = world. */
export function inBox(lat: number, lon: number, b: Box | null): boolean {
	if (!b) return true;
	const [w, s, e, n] = b;
	if (lat < s || lat > n) return false;
	return w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
}

/** The view as a box, or null when it spans the world. */
function viewBox(map: maplibregl.Map): Box | null {
	if (map.getZoom() < 3) return null;
	const b = map.getBounds();
	if (b.getEast() - b.getWest() >= 360) return null;
	const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
	return [
		wrap(b.getWest()),
		Math.max(-90, b.getSouth()),
		wrap(b.getEast()),
		Math.min(90, b.getNorth()),
	];
}

function toRow(i: LayerItem): SitrepRow {
	const p = where(i);
	return {
		ts: i.ts,
		severity: i.severity ?? "info",
		layer: i.layer,
		source: i.source,
		title: i.title ?? i.id,
		lat: p?.[0] ?? null,
		lon: p?.[1] ?? null,
	};
}
const placed = (r: { lat: number | null; lon: number | null }, b: Box | null) =>
	!b || (r.lat != null && r.lon != null && inBox(r.lat, r.lon, b));

const SEV_RANK: Record<string, number> = { critical: 0, watch: 1, info: 2 };

/** Pure: raw API rows → the report (exported for tests). */
export function buildSitrep(input: {
	at: string;
	bbox: Box | null;
	image: string | null;
	alerts: LayerItem[];
	incidents: LayerItem[];
	notes: {
		title: string;
		body: string;
		lat: number | null;
		lon: number | null;
		updated_at?: string;
	}[];
	gaps: { source: string; error: string | null }[];
}): SitrepData {
	const rows = input.alerts.map(toRow).filter((r) => placed(r, input.bbox));
	const incidents = input.incidents
		.map((i) => {
			const m = (i.meta ?? {}) as { events?: number; layers?: string[] };
			return { ...toRow(i), events: m.events ?? 0, layers: m.layers ?? [] };
		})
		.filter((r) => placed(r, input.bbox))
		.sort(
			(a, b) =>
				(SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3) ||
				b.events - a.events ||
				b.ts.localeCompare(a.ts),
		)
		.slice(0, MAX_INCIDENTS);
	const notes = input.notes
		.filter(
			(n): n is typeof n & { lat: number; lon: number } =>
				n.lat != null && n.lon != null && inBox(n.lat, n.lon, input.bbox),
		)
		.map((n) => ({
			title: n.title,
			body: n.body,
			lat: n.lat,
			lon: n.lon,
			ts: n.updated_at ?? "",
		}));
	return {
		at: input.at,
		bbox: input.bbox,
		image: input.image,
		critical: rows.filter((r) => r.severity === "critical").slice(0, MAX_ROWS),
		watch: rows.filter((r) => r.severity === "watch").slice(0, MAX_ROWS),
		incidents,
		notes,
		gaps: input.gaps,
	};
}

const utc = (ts: string) =>
	ts ? `${new Date(ts).toISOString().slice(0, 16).replace("T", " ")}Z` : "";
const ll = (lat: number | null, lon: number | null) =>
	lat == null || lon == null ? "" : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
export function scopeLabel(b: Box | null): string {
	return b
		? `view ${b.map((v) => v.toFixed(1)).join(", ")} (W, S, E, N)`
		: "world";
}

/** The report as Markdown (exported for tests). */
export function sitrepMarkdown(d: SitrepData): string {
	const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
	const table = (head: string[], rows: string[][]) =>
		rows.length
			? [
					`| ${head.join(" | ")} |`,
					`| ${head.map(() => "---").join(" | ")} |`,
					...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
				].join("\n")
			: "_none_";
	const items = (rs: SitrepRow[]) =>
		table(
			["Time (UTC)", "Layer", "Item", "Source", "Lat, lon"],
			rs.map((r) => [utc(r.ts), r.layer, r.title, r.source, ll(r.lat, r.lon)]),
		);
	return [
		"# THOTH SITREP",
		"",
		`Generated ${utc(d.at)} · scope: ${scopeLabel(d.bbox)}`,
		"",
		`**${d.critical.length} critical · ${d.watch.length} watch · ${d.incidents.length} incidents · ${d.notes.length} map notes · ${d.gaps.length} feed gaps**`,
		"",
		"## Critical (24 h)",
		"",
		items(d.critical),
		"",
		"## Watch (24 h)",
		"",
		items(d.watch),
		"",
		"## Incidents",
		"",
		table(
			["Severity", "Incident", "Events", "Layers", "Lat, lon", "Updated"],
			d.incidents.map((i) => [
				i.severity.toUpperCase(),
				i.title,
				String(i.events),
				i.layers.join(", "),
				ll(i.lat, i.lon),
				utc(i.ts),
			]),
		),
		"",
		"## Map notes",
		"",
		table(
			["Note", "Lat, lon", "Detail"],
			d.notes.map((n) => [n.title, ll(n.lat, n.lon), n.body]),
		),
		"",
		"## Feed gaps",
		"",
		table(
			["Source", "Error"],
			d.gaps.map((g) => [g.source, g.error ?? "stale"]),
		),
		"",
	].join("\n");
}

function RowsTable({ rows, label }: { rows: SitrepRow[]; label: string }) {
	if (!rows.length) return <p className="dim">none</p>;
	return (
		<table className="sitrep-table" aria-label={label}>
			<thead>
				<tr>
					<th>Time (UTC)</th>
					<th>Layer</th>
					<th>Item</th>
					<th>Source</th>
					<th>Lat, lon</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((r, k) => (
					<tr key={`${r.ts}:${k}`}>
						<td className="mono">{utc(r.ts)}</td>
						<td>{r.layer}</td>
						<td>{r.title}</td>
						<td>{r.source}</td>
						<td className="mono">{ll(r.lat, r.lon)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

export default function Sitrep({
	getMap,
	onClose,
}: {
	getMap: () => maplibregl.Map | null;
	onClose: () => void;
}) {
	const [d, setD] = useState<SitrepData | null>(null);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		let stop = false;
		const m = getMap();
		const bbox = m ? viewBox(m) : null;
		Promise.all([
			m ? snapshotMap(m) : Promise.resolve(null),
			api.alerts(500, 24).catch(() => ({ items: [] as LayerItem[] })),
			api.layer("incidents").catch(() => ({ items: [] as LayerItem[] })),
			api.notes().catch(() => ({ items: [] })),
			api.brief().catch(() => ({ gaps: [] })),
		])
			.then(([image, a, inc, notes, brief]) => {
				if (stop) return;
				setD(
					buildSitrep({
						at: new Date().toISOString(),
						bbox,
						image,
						alerts: a.items,
						incidents: inc.items,
						notes: notes.items,
						gaps: brief.gaps,
					}),
				);
			})
			.catch((e: unknown) => !stop && setErr(String(e)));
		document.body.classList.add("sitrep-open");
		return () => {
			stop = true;
			document.body.classList.remove("sitrep-open");
		};
	}, [getMap]);

	useEffect(() => {
		const k = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", k);
		return () => window.removeEventListener("keydown", k);
	}, [onClose]);

	const download = () => {
		if (!d) return;
		const blob = new Blob([sitrepMarkdown(d)], { type: "text/markdown" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `sitrep-${d.at.slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}Z.md`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	};

	return (
		<section className="sitrep" id="sitrep" aria-label="sitrep report">
			<div className="sitrep-bar no-print">
				<b>SITREP</b>
				<span className="dim">
					{d ? `${utc(d.at)} · ${scopeLabel(d.bbox)}` : "building…"}
				</span>
				<span style={{ flex: 1 }} />
				<button
					type="button"
					className="ghost-btn"
					id="sitrep-print"
					disabled={!d}
					onClick={() => window.print()}
				>
					PRINT / PDF
				</button>
				<button
					type="button"
					className="ghost-btn"
					id="sitrep-md"
					disabled={!d}
					onClick={download}
				>
					.MD
				</button>
				<button
					type="button"
					className="ghost-btn"
					aria-label="close sitrep"
					onClick={onClose}
				>
					CLOSE
				</button>
			</div>
			<div className="sitrep-page">
				{err && <p className="sev-critical">{err}</p>}
				{d && (
					<>
						<h1>THOTH SITREP</h1>
						<p className="dim">
							Generated {utc(d.at)} · scope: {scopeLabel(d.bbox)}
						</p>
						<div className="mon-kpis" id="sitrep-kpis">
							<span className={`mon-kpi${d.critical.length ? " bad" : ""}`}>
								{d.critical.length} critical
							</span>
							<span className="mon-kpi">{d.watch.length} watch</span>
							<span className="mon-kpi">{d.incidents.length} incidents</span>
							<span className="mon-kpi">{d.notes.length} map notes</span>
							<span className={`mon-kpi${d.gaps.length ? " bad" : ""}`}>
								{d.gaps.length} feed gaps
							</span>
						</div>
						{d.image ? (
							// biome-ignore lint/performance/noImgElement: a data: URL snapshot, nothing for next/image to optimize
							<img
								className="sitrep-map"
								id="sitrep-map"
								src={d.image}
								alt="map snapshot at the time of the report"
							/>
						) : (
							<p className="dim">map snapshot unavailable</p>
						)}
						<h2>Critical · 24 h</h2>
						<RowsTable rows={d.critical} label="critical items" />
						<h2>Watch · 24 h</h2>
						<RowsTable rows={d.watch} label="watch items" />
						<h2>Incidents</h2>
						{d.incidents.length ? (
							<table className="sitrep-table" aria-label="incidents">
								<thead>
									<tr>
										<th>Severity</th>
										<th>Incident</th>
										<th>Events</th>
										<th>Layers</th>
										<th>Lat, lon</th>
									</tr>
								</thead>
								<tbody>
									{d.incidents.map((i, k) => (
										<tr key={`${i.ts}:${k}`}>
											<td className={`sev-${i.severity}`}>
												{i.severity.toUpperCase()}
											</td>
											<td>{i.title}</td>
											<td className="mono">{i.events}</td>
											<td>{i.layers.join(", ")}</td>
											<td className="mono">{ll(i.lat, i.lon)}</td>
										</tr>
									))}
								</tbody>
							</table>
						) : (
							<p className="dim">none</p>
						)}
						<h2>Map notes</h2>
						{d.notes.length ? (
							<table
								className="sitrep-table"
								aria-label="map notes"
								id="sitrep-notes"
							>
								<thead>
									<tr>
										<th>Note</th>
										<th>Lat, lon</th>
										<th>Detail</th>
									</tr>
								</thead>
								<tbody>
									{d.notes.map((n, k) => (
										<tr key={`${n.title}:${k}`}>
											<td>{n.title}</td>
											<td className="mono">{ll(n.lat, n.lon)}</td>
											<td>{n.body}</td>
										</tr>
									))}
								</tbody>
							</table>
						) : (
							<p className="dim">none in view</p>
						)}
						<h2>Feed gaps</h2>
						{d.gaps.length ? (
							<p>
								{d.gaps
									.map((g) => `${g.source}${g.error ? ` (${g.error})` : ""}`)
									.join(" · ")}
							</p>
						) : (
							<p className="dim">none</p>
						)}
					</>
				)}
			</div>
		</section>
	);
}

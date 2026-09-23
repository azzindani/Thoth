"use client";
// "Since you last looked" (ROADMAP P5). The browser keeps a snapshot of the
// critical/watch items it showed (id, severity, time). On return it diffs
// the current 72 h alert window against it:
//   new       — not in the snapshot
//   escalated — was watch, is critical now
//   resolved  — in the snapshot, still inside the window, gone now (a
//               cleared warning, an ended incident, a merged duplicate)
// The snapshot follows you while the tab is visible, so the diff is what
// changed while you were away. Nothing leaves the browser.
import { useEffect, useMemo, useState } from "react";
import { api, type LayerItem } from "../lib/api";
import { ageStr } from "../lib/ui";
import { type Column, DataTable } from "./DataTable";
import { flyTo } from "./MapView";

const SNAP_KEY = "thoth.lastLooked";
const WINDOW_H = 72;
const MIN_AWAY_MS = 10 * 60e3;
const SAVE_MS = 60e3;
const CAP = 1500;

/** id, severity, observed (ms), title, layer — enough to describe a resolved item. */
type Snap = { at: number; items: [string, string, number, string, string][] };
type Change = {
	id: string;
	kind: "new" | "escalated" | "resolved";
	severity: string;
	title: string;
	layer: string;
	ts: number;
	geom?: LayerItem["geom"];
};

function readSnap(): Snap | null {
	try {
		const s = JSON.parse(localStorage.getItem(SNAP_KEY) ?? "null") as Snap;
		return s && typeof s.at === "number" && Array.isArray(s.items) ? s : null;
	} catch {
		return null;
	}
}
function writeSnap(items: LayerItem[]) {
	try {
		const snap: Snap = {
			at: Date.now(),
			items: items
				.slice(0, CAP)
				.map((i) => [
					i.id,
					i.severity ?? "info",
					Date.parse(i.ts) || 0,
					(i.title ?? "").slice(0, 160),
					i.layer,
				]),
		};
		localStorage.setItem(SNAP_KEY, JSON.stringify(snap));
	} catch {
		/* private window: no digest next time, nothing breaks */
	}
}

/** Pure diff (exported for tests). */
export function diffSince(
	prev: Snap,
	cur: LayerItem[],
	now = Date.now(),
): Change[] {
	const before = new Map(
		prev.items.map(([id, sev, ts, title, layer]) => [
			id,
			{ sev, ts, title, layer },
		]),
	);
	const seen = new Set<string>();
	const out: Change[] = [];
	for (const i of cur) {
		seen.add(i.id);
		const was = before.get(i.id);
		const base = {
			id: i.id,
			severity: i.severity ?? "info",
			title: i.title ?? i.id,
			layer: i.layer,
			ts: Date.parse(i.ts) || 0,
			geom: i.geom,
		};
		if (!was) out.push({ ...base, kind: "new" });
		else if (was.sev === "watch" && i.severity === "critical")
			out.push({ ...base, kind: "escalated" });
	}
	const lo = now - WINDOW_H * 3600e3;
	for (const [id, { sev, ts, title, layer }] of before)
		if (!seen.has(id) && ts > lo)
			out.push({
				id,
				kind: "resolved",
				severity: sev,
				title: title || id,
				layer: layer ?? "",
				ts,
			});
	return out;
}

const KIND_RANK = { escalated: 0, new: 1, resolved: 2 } as const;

export default function SinceDigest() {
	const [changes, setChanges] = useState<Change[] | null>(null);
	const [away, setAway] = useState(0);

	useEffect(() => {
		let stop = false;
		let latest: LayerItem[] = [];
		const prev = readSnap();
		const load = () =>
			api
				.alerts(500, WINDOW_H)
				.then((j) => {
					latest = j.items;
					return j.items;
				})
				.catch(() => latest);
		load().then((items) => {
			if (stop) return;
			if (prev && Date.now() - prev.at >= MIN_AWAY_MS) {
				const d = diffSince(prev, items);
				if (d.length) {
					setAway(Date.now() - prev.at);
					setChanges(d);
				}
			}
			writeSnap(items);
		});
		// The snapshot follows you while you are looking.
		const t = setInterval(() => {
			if (document.visibilityState === "visible") void load().then(writeSnap);
		}, SAVE_MS);
		const onHide = () => {
			if (document.visibilityState === "hidden" && latest.length)
				writeSnap(latest);
		};
		document.addEventListener("visibilitychange", onHide);
		return () => {
			stop = true;
			clearInterval(t);
			document.removeEventListener("visibilitychange", onHide);
		};
	}, []);

	const cols = useMemo<Column<Change>[]>(
		() => [
			{
				key: "kind",
				label: "Change",
				sort: (c) => KIND_RANK[c.kind],
				render: (c) => <span className={`since-${c.kind}`}>{c.kind}</span>,
			},
			{
				key: "sev",
				label: "Severity",
				sort: (c) => (c.severity === "critical" ? 0 : 1),
				render: (c) => (
					<span className={`sev-${c.severity}`}>
						{c.severity.toUpperCase()}
					</span>
				),
			},
			{
				key: "title",
				label: "Item",
				sort: (c) => c.title,
				render: (c) => (
					<span className="dt-clip dt-key" title={c.title}>
						{c.title}
					</span>
				),
			},
			{
				key: "when",
				label: "When",
				num: true,
				sort: (c) => c.ts,
				render: (c) => ageStr(new Date(c.ts).toISOString()),
			},
		],
		[],
	);

	if (!changes) return null;
	const n = (k: Change["kind"]) => changes.filter((c) => c.kind === k).length;
	return (
		<section className="since" id="since" aria-label="since you last looked">
			<div className="since-head">
				<h3 className="since-title">
					Since you last looked ·{" "}
					{ageStr(new Date(Date.now() - away).toISOString()).replace(
						" ago",
						"",
					)}{" "}
					away
				</h3>
				<button
					type="button"
					className="ghost-btn"
					onClick={() => setChanges(null)}
					aria-label="dismiss digest"
				>
					DISMISS
				</button>
			</div>
			<div className="mon-kpis">
				<span className={`mon-kpi${n("escalated") ? " bad" : ""}`}>
					{n("escalated")} escalated
				</span>
				<span className="mon-kpi">{n("new")} new</span>
				<span className="mon-kpi">{n("resolved")} resolved</span>
			</div>
			<div className="since-body">
				<DataTable
					label="Changes since you last looked"
					rows={changes}
					cols={cols}
					rowKey={(c) => `${c.kind}:${c.id}`}
					initialSort={{ key: "kind", dir: "asc" }}
					onRowClick={(c) => {
						const g = c.geom as { type: string; coordinates: number[] } | null;
						if (g?.type === "Point")
							flyTo(g.coordinates[1], g.coordinates[0], 5);
					}}
				/>
			</div>
		</section>
	);
}

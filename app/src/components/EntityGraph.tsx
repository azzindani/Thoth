"use client";
import type maplibregl from "maplibre-gl";
import { useEffect, useState } from "react";
import { LAYER_NAMES, LAYERS } from "../lib/layer-catalog";
import type { ObjProps } from "./MapView";

interface Node {
	id: string;
	label: string;
	layer: string;
	color: string;
	x: number;
	y: number;
	lng: number;
	lat: number;
	props: ObjProps;
	center?: boolean;
}

// EntityGraph — relation view over REAL viewport data: the focused feature at
// the center, up to 11 co-visible unclustered features on the ring, colored by
// layer. Click a node to fly + select. No invented edges: co-visibility only.
export default function EntityGraph({
	getMap,
	sel,
	onSelect,
	onClose,
}: {
	getMap: () => maplibregl.Map | null;
	sel: ObjProps | null;
	onSelect: (p: ObjProps) => void;
	onClose: () => void;
}) {
	const [nodes, setNodes] = useState<Node[]>([]);
	const [note, setNote] = useState("scanning viewport…");
	const W = 320;
	const H = 300;

	useEffect(() => {
		function scan() {
			const map = getMap();
			if (!map) return;
			const feats: { p: ObjProps; layer: string; lng: number; lat: number }[] =
				[];
			try {
				const ids = [...LAYER_NAMES, ...LAYER_NAMES.map((n) => `${n}-c`)];
				const rendered = map.queryRenderedFeatures({ layers: ids });
				for (const f of rendered) {
					const g = f.geometry as unknown as { coordinates?: unknown };
					const coords = g?.coordinates;
					if (!Array.isArray(coords) || typeof coords[0] !== "number") continue;
					const p = f.properties as unknown as ObjProps;
					const lid =
						(f as unknown as { layer?: { id?: string } }).layer?.id ?? "?";
					const layer = lid.endsWith("-c") ? lid.slice(0, -2) : lid;
					const count = (p as unknown as { point_count?: number }).point_count;
					feats.push({
						p: {
							...p,
							title: p.title ?? (count ? `${layer} ×${count}` : undefined),
						},
						layer,
						lng: coords[0] as number,
						lat: coords[1] as number,
					});
					if (feats.length >= 60) break;
				}
			} catch {
				/* keep */
			}
			const cx = W / 2;
			const cy = H / 2;
			const out: Node[] = [];
			if (sel) {
				out.push({
					id: "sel",
					label: sel.title ?? sel.id ?? "selected",
					layer: "",
					color: "#fff",
					x: cx,
					y: cy,
					lng: 0,
					lat: 0,
					props: sel,
					center: true,
				});
			}
			const seen = new Set<string>();
			const ring = feats
				.filter((f) => {
					const k = `${f.p.id ?? f.p.title}`;
					if (sel && k === `${sel.id ?? sel.title}`) return false;
					if (seen.has(k)) return false;
					seen.add(k);
					return true;
				})
				.slice(0, sel ? 11 : 12);
			ring.forEach((f, i) => {
				const a = (2 * Math.PI * i) / Math.max(ring.length, 1) - Math.PI / 2;
				const R = Math.min(W, H) / 2 - 34;
				out.push({
					id: `n${i}`,
					label: (f.p.title ?? f.p.id ?? f.layer).slice(0, 18),
					layer: f.layer,
					color: (LAYERS[f.layer]?.color as string) ?? "var(--amber)",
					x: cx + R * Math.cos(a),
					y: cy + R * Math.sin(a),
					lng: f.lng,
					lat: f.lat,
					props: f.p,
				});
			});
			setNodes(out);
			setNote(
				out.length <= (sel ? 1 : 0)
					? "viewport empty — zoom in or enable layers"
					: `${out.length - (sel ? 1 : 0)} co-visible entities`,
			);
		}
		scan();
		const map = getMap();
		map?.on("moveend", scan);
		return () => {
			map?.off("moveend", scan);
		};
	}, [sel, getMap]);

	function fly(n: Node) {
		if (n.center) return;
		// clusters zoom in, singles select
		if (n.label.includes("×")) {
			getMap()?.flyTo({ center: [n.lng, n.lat], duration: 1200 });
			return;
		}
		getMap()?.flyTo({ center: [n.lng, n.lat], zoom: 5, duration: 1200 });
		onSelect(n.props);
	}

	const center = nodes.find((n) => n.center) ?? {
		x: W / 2,
		y: H / 2,
		label: "viewport",
		color: "#fff",
	};
	return (
		<div className="entitygraph">
			<div className="eg-head">
				<b>Entity graph</b>
				<span className="dim">{note}</span>
				<button className="go" onClick={onClose}>
					X
				</button>
			</div>
			<svg width={W} height={H} role="img">
				<title>co-visible entities around selection</title>
				{nodes
					.filter((n) => !n.center)
					.map((n) => (
						<line
							key={n.id}
							x1={center.x}
							y1={center.y}
							x2={n.x}
							y2={n.y}
							stroke={n.color}
							strokeWidth="1"
							opacity="0.5"
						/>
					))}
				{nodes.map((n) =>
					n.center ? (
						<g key={n.id}>
							<circle cx={n.x} cy={n.y} r="9" fill="#fff" />
							<text
								x={n.x}
								y={n.y + 22}
								textAnchor="middle"
								fill="#fff"
								fontSize="10"
							>
								{(n.label ?? "").slice(0, 22)}
							</text>
						</g>
					) : (
						<g key={n.id} onClick={() => fly(n)} style={{ cursor: "pointer" }}>
							<title>
								{n.label} · {n.layer}
							</title>
							<circle cx={n.x} cy={n.y} r="6" fill={n.color} />
							<text
								x={n.x}
								y={n.y - 10}
								textAnchor="middle"
								fill="var(--dim)"
								fontSize="9"
							>
								{n.label}
							</text>
						</g>
					),
				)}
				{!sel && (
					<text
						x={W / 2}
						y={H / 2}
						textAnchor="middle"
						fill="#fff"
						fontSize="10"
					>
						viewport
					</text>
				)}
			</svg>
		</div>
	);
}

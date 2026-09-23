"use client";
import * as maplibregl from "maplibre-gl";
import "../lib/maplibre"; // setWorkerUrl before any Map is built
import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, type LayerItem } from "../lib/api";
import { bakeIcon, LAYER_NAMES, LAYERS } from "../lib/layer-catalog";
import { PALETTE, SEV_INK } from "../lib/palette";
import {
	armThumb,
	ensurePickHandler,
	esc,
	hoverCard,
	type ObjProps,
	pickedRecently,
	type SelectFn,
	setPickSinks,
	steadyHover,
} from "./map-popups";

export type { ObjProps };

interface Props {
	visible: Record<string, boolean>;
	sev: string;
	since: string | null;
	mode: string;
	globe: boolean;
	onSelect: SelectFn;
	onFull: SelectFn;
	onArea: (lat: number, lng: number) => void;
	mapCb: (m: maplibregl.Map) => void;
	overlay?: React.ReactNode;
}

function toGeoJSON(items: LayerItem[], sev: string) {
	return {
		type: "FeatureCollection" as const,
		features: (items || [])
			.filter((i) => i.geom && (!sev || i.severity === sev))
			.map((i) => ({
				type: "Feature" as const,
				geometry: i.geom as { type: string; coordinates: number[] },
				properties: {
					id: i.id,
					title: i.title || i.id,
					url: i.url || "",
					layer: i.layer,
					severity: i.severity || "",
					source: i.source,
					ts: i.ts,
					lon: i.geom?.coordinates?.[0],
					lat: i.geom?.coordinates?.[1],
					airline: (i.meta?.airline as string) || "",
					rot: Number(i.meta?.track ?? 0) || 0,
				},
			})),
	};
}

type LoadOpts = {
	sev: string;
	since: string | null;
	visible: Record<string, boolean>;
	/** preview sink: pins the card, opens nothing. */
	onSelect: Props["onSelect"];
	/** explicit full-view sink: pinned "Full view" button, panel clicks. */
	onFull: Props["onSelect"];
};

/** Popups (hover/pin/picker) live in map-popups.ts — outside React.
 * This file owns layers: sources, paint, icons, overlays. */

/** Limited-parallel layer loading (pool of 6): boot drops ~25s → ~5s.
 *  Layers are independent — order of completion doesn't matter. */
export async function loadAll(
	map: maplibregl.Map,
	names: string[],
	opts: LoadOpts,
): Promise<void> {
	const POOL = 6;
	const queue = [...names];
	await Promise.all(
		Array.from({ length: Math.min(POOL, queue.length) }, async () => {
			while (queue.length) {
				const n = queue.shift();
				if (!n) return;
				try {
					await loadLayer(map, n, opts);
				} catch {
					/* per-layer errors stay silent; health pill reports feeds */
				}
			}
		}),
	);
}

export function setVis(
	map: maplibregl.Map,
	n: string,
	visible: Record<string, boolean>,
) {
	for (const id of [
		n,
		`${n}-c`,
		`${n}-n`,
		`${n}-o`,
		`${n}-o-crit`,
		`${n}-o-watch`,
		`${n}-o-info`,
	])
		if (map.getLayer(id))
			map.setLayoutProperty(id, "visibility", visible[n] ? "visible" : "none");
}

export async function loadLayer(
	map: maplibregl.Map,
	name: string,
	opts: {
		sev: string;
		since: string | null;
		visible: Record<string, boolean>;
		onSelect: Props["onSelect"];
		onFull: Props["onSelect"];
	},
) {
	const j = await api.layer(name, opts.since ?? undefined);
	const data = toGeoJSON(j.items, opts.sev);
	const src = map.getSource(name) as maplibregl.GeoJSONSource | undefined;
	if (src) {
		src.setData(data as never);
	} else if (LAYERS[name]?.polygon) {
		// Overlapping fills stack opacity (three nested SIGMETs read as one
		// dark blob). Fix at the paint level, not the data level: every
		// polygon layer renders as ONE translucent underlay wash (fills never
		// composite) + severity-coded dashed outlines that stay legible when
		// stacked. Fill sits below the route/terminator chrome via no extra
		// ordering — fills were already added before symbols.
		const tone = SEV_INK.info;
		map.addSource(name, { type: "geojson", data: data as never });
		map.addLayer({
			id: name,
			type: "fill",
			source: name,
			paint: {
				"fill-color": tone,
				// zoom-scaled wash: whisper at globe, readable when zoomed in
				"fill-opacity": [
					"interpolate",
					["linear"],
					["zoom"],
					1,
					0.05,
					4,
					0.08,
					8,
					0.14,
				],
			},
		} as never);
		// One outline per severity so stacked hazards stay distinguishable:
		// critical solid red, watch amber dashed, info thin dotted.
		const outlines: {
			id: string;
			sev: string;
			color: string;
			width: number;
			dash: number[];
			opacity: number;
		}[] = [
			{
				id: `${name}-o-crit`,
				sev: "critical",
				color: PALETTE.critical,
				width: 2,
				dash: [],
				opacity: 0.95,
			},
			{
				id: `${name}-o-watch`,
				sev: "watch",
				color: PALETTE.watch,
				width: 1.5,
				dash: [5, 3],
				opacity: 0.85,
			},
			{
				id: `${name}-o-info`,
				sev: "info",
				color: tone,
				width: 1,
				dash: [2, 3],
				opacity: 0.6,
			},
		];
		for (const o of outlines) {
			map.addLayer({
				id: o.id,
				type: "line",
				source: name,
				filter: ["==", ["get", "severity"], o.sev],
				paint: {
					"line-color": o.color,
					"line-width": o.width,
					"line-opacity": o.opacity,
					...(o.dash.length ? { "line-dasharray": o.dash } : {}),
				},
			} as never);
		}
		setPickSinks(opts.onSelect, opts.onFull);
		ensurePickHandler(map);
		const phov = new maplibregl.Popup({
			closeButton: false,
			closeOnClick: false,
			offset: 12,
			className: "hov-pop",
		});
		const phovCtl = steadyHover(map, phov, (p) => {
			phov.setHTML(hoverCard(p as ObjProps & { ts?: string }, name));
			armThumb(phov, p);
		});
		map.on("mousemove", name, (e) => {
			const f = e.features?.[0];
			if (!f) return;
			map.getCanvas().style.cursor = "pointer";
			phovCtl.move(f.properties as unknown as ObjProps, name, e.lngLat);
		});
		map.on("mouseleave", name, () => {
			phovCtl.leave();
			map.getCanvas().style.cursor = "";
		});
	} else {
		map.addSource(name, {
			type: "geojson",
			data: data as never,
			cluster: true,
			clusterMaxZoom: 12,
			clusterRadius: 40,
			clusterProperties: {
				nc: ["+", ["case", ["==", ["get", "severity"], "critical"], 1, 0]],
				nw: ["+", ["case", ["==", ["get", "severity"], "watch"], 1, 0]],
			},
		});
		// One sprite per severity: shape = layer, ink = severity.
		for (const [suffix, ink] of [
			["", SEV_INK.info],
			["-watch", SEV_INK.watch],
			["-crit", SEV_INK.critical],
		] as const) {
			const id = `th-${name}${suffix}`;
			if (!map.hasImage(id)) map.addImage(id, await bakeIcon(name, ink));
		}
		map.addLayer({
			id: name,
			type: "symbol",
			source: name,
			filter: ["!", ["has", "point_count"]],
			layout: {
				"icon-image": [
					"match",
					["get", "severity"],
					"critical",
					`th-${name}-crit`,
					"watch",
					`th-${name}-watch`,
					`th-${name}`,
				],
				"icon-size": [
					"case",
					["==", ["get", "severity"], "critical"],
					0.5,
					0.38,
				],
				"icon-allow-overlap": true,
				"icon-rotation-alignment": "map",
				"icon-rotate": ["coalesce", ["get", "rot"], 0],
			} as never,
			paint: { "icon-opacity": 0.95 },
		});
		map.addLayer({
			id: `${name}-c`,
			type: "circle",
			source: name,
			filter: ["has", "point_count"],
			paint: {
				// Neutral disc; the ring carries the worst severity inside.
				"circle-color": PALETTE.raise,
				"circle-opacity": 0.92,
				"circle-stroke-width": [
					"case",
					[">", ["get", "nc"], 0],
					1.75,
					[">", ["get", "nw"], 0],
					1.5,
					1,
				],
				"circle-stroke-color": [
					"case",
					[">", ["get", "nc"], 0],
					PALETTE.critical,
					[">", ["get", "nw"], 0],
					PALETTE.watch,
					PALETTE.dim,
				],
				"circle-radius": [
					"step",
					["get", "point_count"],
					9,
					50,
					12,
					200,
					15,
					1000,
					19,
				],
			} as never,
		});
		map.addLayer({
			id: `${name}-n`,
			type: "symbol",
			source: name,
			filter: ["has", "point_count"],
			layout: {
				"text-field": ["get", "point_count_abbreviated"],
				"text-size": 9,
				"text-allow-overlap": true,
				"text-ignore-placement": true,
			} as never,
			paint: { "text-color": PALETTE.txt },
		});
		map.on("click", `${name}-c`, (e) => {
			// A picker just opened on this pixel — it owns the click, not zoom.
			if (pickedRecently()) return;
			const f = e.features?.[0];
			if (!f) return;
			(map.getSource(name) as maplibregl.GeoJSONSource)
				.getClusterExpansionZoom(
					(f.properties as { cluster_id: number }).cluster_id,
				)
				.then((z: number) =>
					map.easeTo({
						center: (f.geometry as unknown as { coordinates: [number, number] })
							.coordinates,
						zoom: z,
					}),
				)
				.catch(() => {});
		});
		// Selection rides the unified map-level picker (ensurePickHandler):
		// single hits select, stacks open the disambiguation card.
		setPickSinks(opts.onSelect, opts.onFull);
		ensurePickHandler(map);
		const hov = new maplibregl.Popup({
			closeButton: false,
			closeOnClick: false,
			offset: 12,
			className: "hov-pop",
		});
		const hovCtl = steadyHover(map, hov, (p) => {
			hov.setHTML(hoverCard(p as ObjProps & { ts?: string }, name));
			armThumb(hov, p);
		});
		map.on("mousemove", name, (e) => {
			const f = e.features?.[0];
			if (!f) return;
			map.getCanvas().style.cursor = "pointer";
			hovCtl.move(f.properties as unknown as ObjProps, name, e.lngLat);
		});
		map.on("mouseleave", name, () => {
			hovCtl.leave();
			map.getCanvas().style.cursor = "";
		});
		// Cluster hover: composition summary (aggregated at the source).
		const chov = new maplibregl.Popup({
			closeButton: false,
			closeOnClick: false,
			offset: 14,
			className: "hov-pop",
		});
		const chovCtl = steadyHover(map, chov, (p) => {
			const c = p as unknown as {
				point_count: number;
				nc?: number;
				nw?: number;
			};
			chov.setHTML(
				`<div class="hov"><div class="hov-t">${c.point_count} points · ${esc(name)}</div>` +
					`<div class="hov-m dim">` +
					`${c.nc ? `<span style="color:var(--red)">● ${c.nc} critical</span> · ` : ""}` +
					`${c.nw ? `<span style="color:var(--amber)">● ${c.nw} watch</span> · ` : ""}` +
					`click to zoom</div></div>`,
			);
		});
		map.on("mousemove", `${name}-c`, (e) => {
			const f = e.features?.[0];
			if (!f) return;
			map.getCanvas().style.cursor = "zoom-in";
			chovCtl.move(f.properties as unknown as ObjProps, `${name}-c`, e.lngLat);
		});
		map.on("mouseleave", `${name}-c`, () => {
			chovCtl.leave();
			map.getCanvas().style.cursor = "";
		});
	}
	setVis(map, name, opts.visible);
	return j.total;
}

/* Day/night terminator (world-dashboard pattern): night-side fill around the
   antipode of the subsolar point, refreshed every 10 min. Pure solar math. */
function subsolar(dateMs: number): { lat: number; lon: number } {
	const jd = dateMs / 864e5 + 2440587.5;
	const n = jd - 2451545.0;
	const L = (280.46 + 0.9856474 * n) % 360;
	const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
	const lambda =
		(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
	const eps = (23.439 - 0.0000004 * n) * (Math.PI / 180);
	const lat = Math.asin(Math.sin(eps) * Math.sin(lambda)) / (Math.PI / 180);
	const gmst =
		((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360) *
		(Math.PI / 180);
	const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
	let lon = (ra - gmst) / (Math.PI / 180);
	lon = ((((lon + 540) % 360) - 180 + 540) % 360) - 180;
	return { lat, lon };
}
function destPoint(
	lat: number,
	lon: number,
	brng: number,
	distKm: number,
): [number, number] {
	const R = 6371;
	const d = distKm / R;
	const la1 = (lat * Math.PI) / 180;
	const lo1 = (lon * Math.PI) / 180;
	const br = (brng * Math.PI) / 180;
	const la2 = Math.asin(
		Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br),
	);
	const lo2 =
		lo1 +
		Math.atan2(
			Math.sin(br) * Math.sin(d) * Math.cos(la1),
			Math.cos(d) - Math.sin(la1) * Math.sin(la2),
		);
	return [(la2 * 180) / Math.PI, (((lo2 * 180) / Math.PI + 540) % 360) - 180];
}
function addTerminator(map: maplibregl.Map) {
	function paint() {
		const sun = subsolar(Date.now());
		const night: [number, number][] = [];
		for (let b = 0; b < 360; b += 6) {
			const [la, lo] = destPoint(-sun.lat, sun.lon + 180, b, 10000);
			night.push([lo, la]);
		}
		night.push(night[0]);
		const fc = {
			type: "FeatureCollection" as const,
			features: [
				{
					type: "Feature" as const,
					properties: {},
					geometry: { type: "Polygon" as const, coordinates: [night] },
				},
			],
		};
		const src = map.getSource("terminator") as
			| maplibregl.GeoJSONSource
			| undefined;
		if (src) src.setData(fc as never);
		else {
			map.addSource("terminator", { type: "geojson", data: fc as never });
			map.addLayer({
				id: "terminator",
				type: "fill",
				source: "terminator",
				paint: { "fill-color": PALETTE.bg, "fill-opacity": 0.4 },
			} as never);
		}
	}
	paint();
	const t = setInterval(paint, 600000);
	map.once("remove", () => clearInterval(t));
}

/* Trunk trade routes (schematic great-circle connectors, not live AIS tracks):
   Europe–Asia via Suez, Hormuz energy run, transpacific, Panama, Cape alternate. */
const ROUTES: [number, number][][] = [
	[
		[4.5, 51.9],
		[-6, 36],
		[32.3, 30.5],
		[43.3, 12.6],
		[80, 6],
		[101.8, 2.5],
		[103.8, 1.26],
		[121.5, 31.2],
	],
	[
		[56.3, 26.6],
		[65, 12],
		[80, 6],
		[101.8, 2.5],
	],
	[
		[-118, 33.7],
		[-150, 30],
		[170, 35],
		[139.7, 35.5],
	],
	[
		[-79.7, 9],
		[-90, 5],
		[-120, 0],
		[-150, -5],
	],
	[
		[4.5, 51.9],
		[-10, 30],
		[-5, 0],
		[18, -34],
		[40, -20],
		[80, -10],
		[103.8, 1.26],
	],
	[
		[121.5, 31.2],
		[119.5, 24.5],
		[114, 15],
		[103.8, 1.26],
	],
];
function addRoutes(map: maplibregl.Map) {
	if (map.getSource("routes")) return;
	map.addSource("routes", {
		type: "geojson",
		data: {
			type: "FeatureCollection",
			features: ROUTES.map((r) => ({
				type: "Feature",
				properties: {},
				geometry: { type: "LineString", coordinates: r },
			})),
		} as never,
	});
	map.addLayer({
		id: "routes",
		type: "line",
		source: "routes",
		paint: {
			"line-color": PALETTE.txt2,
			"line-opacity": 0.22,
			"line-width": 1,
			"line-dasharray": [3, 3],
		},
	} as never);
}

const SAT_SOURCE = {
	type: "raster",
	tiles: [
		"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
	],
	tileSize: 256,
	attribution: "Esri World Imagery",
} as unknown as maplibregl.RasterSourceSpecification;
const SAT_LAYER = {
	id: "sat",
	type: "raster",
	source: "sat",
} as unknown as maplibregl.LayerSpecification;

export default function MapView(props: Props) {
	const divRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);
	const propsRef = useRef(props);
	propsRef.current = props;

	function initialView(): { center: [number, number]; zoom: number } {
		try {
			const h = new URLSearchParams(window.location.hash.slice(1));
			const c = (h.get("c") ?? "").split(",").map(Number);
			if (c.length === 3 && c.every(Number.isFinite))
				return { center: [c[0], c[1]], zoom: c[2] };
		} catch {
			/* keep defaults */
		}
		return { center: [20, 30], zoom: 1.6 };
	}
	// mount-once: map construction reads the URL hash a single time
	// biome-ignore lint/correctness/useExhaustiveDependencies: map init must run exactly once; initialView/mapCb are mount-time inputs
	useEffect(() => {
		const init = initialView();
		const map = new maplibregl.Map({
			container: divRef.current as HTMLDivElement,
			style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
			center: init.center,
			zoom: init.zoom,
			canvasContextAttributes: { antialias: true },
			attributionControl: { compact: true },
		});
		mapRef.current = map;
		(window as unknown as { __thothMap?: maplibregl.Map }).__thothMap = map;
		// right-click sets area dossier
		map.on("contextmenu", (e) => {
			e.preventDefault();
			propsRef.current.onArea(e.lngLat.lat, e.lngLat.lng);
		});
		map.on("load", async () => {
			try {
				map.setProjection({ type: "globe" });
			} catch {
				/* style without projection support */
			}
			addTerminator(map);
			addRoutes(map);
			props.mapCb(map);
			const p = propsRef.current;
			await loadAll(map, LAYER_NAMES, {
				sev: p.sev,
				since: p.since,
				visible: p.visible,
				onSelect: p.onSelect,
				onFull: p.onFull,
			});
		});
		return () => {
			map.remove();
			mapRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// modes + projection follow props
	useEffect(() => {
		const m = mapRef.current;
		if (!m) return;
		const map: maplibregl.Map = m;
		try {
			map.setProjection({ type: props.globe ? "globe" : "mercator" });
		} catch {
			/* older style */
		}
		const hasSat = !!map.getSource("sat");
		if ((props.mode === "sat" || props.mode === "cinema") && !hasSat) {
			map.addSource("sat", SAT_SOURCE);
			map.addLayer(SAT_LAYER);
		} else if (props.mode !== "sat" && props.mode !== "cinema" && hasSat) {
			if (map.getLayer("sat")) map.removeLayer("sat");
			map.removeSource("sat");
		}
		document.body.classList.toggle("nvg", props.mode === "nvg");
		if (props.mode !== "cinema") return;
		let stop = false;
		let timer: ReturnType<typeof setTimeout>;
		function spin() {
			if (stop) return;
			map.easeTo({
				center: [map.getCenter().lng + 20, 20],
				duration: 4000,
				easing: (t) => t,
			});
			timer = setTimeout(spin, 4100);
		}
		spin();
		return () => {
			stop = true;
			clearTimeout(timer);
		};
	}, [props.mode, props.globe]);

	// visibility follows state
	useEffect(() => {
		const map = mapRef.current;
		if (!map) return;
		for (const n of LAYER_NAMES) setVis(map, n, props.visible);
	}, [props.visible]);

	return (
		<div className="mapwrap">
			<div ref={divRef} className="map" id="map" />
			{props.overlay}
		</div>
	);
}

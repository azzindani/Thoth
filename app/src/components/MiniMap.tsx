"use client";
import type * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { PALETTE } from "../lib/palette";

// MiniMap — floating world overview. Follows the main camera, draws the
// viewport rectangle, click-to-fly. Hidden on phone (responsive contract).
export default function MiniMap({
	getMap,
}: {
	getMap: () => maplibregl.Map | null;
}) {
	const divRef = useRef<HTMLDivElement>(null);
	const miniRef = useRef<maplibregl.Map | null>(null);

	useEffect(() => {
		let stop = false;
		let mini: maplibregl.Map | null = null;
		let timer: ReturnType<typeof setInterval>;
		(async () => {
			const { default: ml } = await import("../lib/maplibre");
			if (stop || !divRef.current) return;
			const m = new ml.Map({
				container: divRef.current,
				style:
					"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
				center: [10, 30],
				zoom: 1,
				interactive: false,
				attributionControl: false,
			});
			mini = m;
			miniRef.current = m;
			m.on("load", () => {
				m.addSource("view", {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] },
				});
				m.addLayer({
					id: "view",
					type: "line",
					source: "view",
					paint: { "line-color": PALETTE.accent, "line-width": 1.25 },
				});
				m.addSource("dot", {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] },
				});
				m.addLayer({
					id: "dot",
					type: "circle",
					source: "dot",
					paint: { "circle-color": PALETTE.accent, "circle-radius": 2.5 },
				});
			});
			timer = setInterval(() => {
				const main = getMap();
				if (!main || !m.isStyleLoaded()) return;
				try {
					const c = main.getCenter();
					m.setCenter([c.lng, c.lat]);
					const b = main.getBounds();
					const ring = [
						[b.getWest(), b.getSouth()],
						[b.getEast(), b.getSouth()],
						[b.getEast(), b.getNorth()],
						[b.getWest(), b.getNorth()],
						[b.getWest(), b.getSouth()],
					];
					(m.getSource("view") as maplibregl.GeoJSONSource)?.setData({
						type: "Feature",
						properties: {},
						geometry: { type: "Polygon", coordinates: [ring] },
					} as never);
					(m.getSource("dot") as maplibregl.GeoJSONSource)?.setData({
						type: "Feature",
						properties: {},
						geometry: { type: "Point", coordinates: [c.lng, c.lat] },
					} as never);
				} catch {
					/* keep */
				}
			}, 800);
		})();
		return () => {
			stop = true;
			clearInterval(timer);
			mini?.remove();
			miniRef.current = null;
		};
	}, [getMap]);

	function onClick(e: React.MouseEvent) {
		const main = getMap();
		const mini = miniRef.current;
		if (!main || !mini) return;
		const r = (e.target as HTMLElement).getBoundingClientRect();
		const ll = mini.unproject([
			e.clientX - r.left,
			e.clientY - r.top,
		]) as unknown as { lng: number; lat: number };
		main.flyTo({ center: [ll.lng, ll.lat], duration: 1200 });
	}

	return (
		<div className="minimap" title="overview — click to fly">
			<div
				ref={divRef}
				style={{ width: 168, height: 100, cursor: "crosshair" }}
				onClick={onClick}
			/>
		</div>
	);
}

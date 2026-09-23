"use client";
// Map popups live outside React: rich hover/pin/picker cards rendered as
// popup HTML, actions dispatched through one delegated document listener
// against stored records (no per-button closures).
import * as maplibregl from "maplibre-gl";
import "../lib/maplibre"; // setWorkerUrl before any Map is built
import { api } from "../lib/api";
import { LAYERS } from "../lib/layer-catalog";
import { ageStr } from "../lib/ui";

export interface ObjProps {
	id: string;
	title: string;
	url: string;
	layer: string;
	severity: string;
	source: string;
	ts: string;
	lon: number;
	lat: number;
	airline: string;
	rot: number;
}

export type SelectFn = (p: ObjProps, ll: unknown) => void;

/** Escape feed-supplied text before injecting into popup HTML. */
export function esc(s: unknown): string {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Rich preview card: severity stripe + identity + meta grid + freshness +
 * fixed-height satellite slot (never reflows when the thumbnail lands) +
 * optional action row (pinned previews only — hover stays hover).
 * The .hov-t / .hov-m lines stay plain text so tests can match titles. */
export function hoverCard(
	p: ObjProps & { ts?: string },
	fallbackLayer: string,
	pinId?: number,
): string {
	const layer = p.layer || fallbackLayer;
	const sev = (p.severity || "info").toLowerCase();
	const sevCol =
		sev === "critical"
			? "var(--red)"
			: sev === "watch"
				? "var(--amber)"
				: "var(--dim)";
	const lat = Number(p.lat);
	const lon = Number(p.lon);
	const geo = Number.isFinite(lat) && Number.isFinite(lon);
	return (
		`<div class="hov"><div class="hov-bar" style="background:${sevCol}"></div>` +
		`<div class="hov-t">${esc(p.title || p.id || layer)}</div>` +
		`<div class="hov-m"><span class="sev-tag" style="color:${sevCol}">${esc(sev.toUpperCase())}</span>` +
		` · ${esc(layer)}${p.airline ? ` · ${esc(p.airline)}` : ""}</div>` +
		`<div class="hov-grid">` +
		`<span>SRC</span><span>${esc(p.source || "?")}</span>` +
		`<span>AGE</span><span>${esc(ageStr(p.ts))}</span>` +
		(geo
			? `<span>POS</span><span>${lat.toFixed(2)}, ${lon.toFixed(2)}</span>`
			: "") +
		`</div>` +
		(geo ? `<div class="hov-shot"><img data-hovimg alt="" /></div>` : "") +
		(pinId != null
			? `<div class="hov-act"><button class="primary" data-act="full:${pinId}">Full view</button>` +
				`<button class="ghost" data-act="zoom:${pinId}">Zoom</button></div>`
			: `<div class="hov-h">Click to pin preview</div>`) +
		`</div>`
	);
}

// Lazy satellite thumbnail for hover previews: one earth-search lookup per
// ~1km cell, cached (URL or known-empty). Patches the still-open popup only.
const thumbCache = new Map<string, string | null>();
const thumbPending = new Set<string>();
/** Arm the satellite thumbnail for an already-attached popup. */
export function armThumb(pop: maplibregl.Popup, p: ObjProps): void {
	const lat = Number(p.lat);
	const lon = Number(p.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
	const key = `${lon.toFixed(2)},${lat.toFixed(2)}`;
	const el = pop
		.getElement()
		?.querySelector<HTMLImageElement>("img[data-hovimg]");
	if (!el) return;
	el.dataset.hovkey = key;
	function paint(img: HTMLImageElement, url: string | null): void {
		if (!img.isConnected || img.dataset.hovkey !== key) return;
		if (url) {
			img.src = url;
			img.classList.add("on");
		} else {
			img.closest(".hov-shot")?.classList.add("empty");
		}
	}
	const hit = thumbCache.get(key);
	if (hit !== undefined) {
		paint(el, hit);
		return;
	}
	if (thumbPending.has(key)) return;
	thumbPending.add(key);
	api
		.imagery(lon, lat)
		.then((j) => {
			const url = j.scene?.thumbnail ?? null;
			thumbCache.set(key, url);
			paint(el, url);
		})
		.catch(() => {
			thumbCache.set(key, null);
			paint(el, null);
		})
		.finally(() => {
			thumbPending.delete(key);
		});
}

// Stacked-point disambiguation + pinned-preview actions dispatch through one
// delegated document listener (popups live outside React, so no closures).
const pickStore = new Map<
	number,
	{
		cands: ObjProps[];
		preview: SelectFn;
		full: SelectFn;
		map: maplibregl.Map;
		lngLat: unknown;
		pop: maplibregl.Popup;
	}
>();
/** Pinned previews: click pins the card, buttons act on the stored record. */
const pinStore = new Map<
	number,
	{
		p: ObjProps;
		key: string;
		map: maplibregl.Map;
		pop: maplibregl.Popup;
		full: SelectFn;
	}
>();
let pickSeq = 0;
let pinSeq = 0;
if (typeof document !== "undefined") {
	document.addEventListener("click", (e) => {
		const el = e.target as HTMLElement;
		const pk = el.closest?.("[data-pick]");
		if (pk) {
			const [id, i] = String((pk as HTMLElement).dataset.pick ?? "")
				.split(":")
				.map(Number);
			const rec = pickStore.get(id);
			if (!rec) return;
			const c = rec.cands[i];
			pickStore.delete(id);
			rec.pop.remove();
			if (!c) return;
			rec.preview(c, null);
			showPinned(rec.map, c, c.layer, rec.lngLat, rec.full);
			return;
		}
		const ac = el.closest?.("[data-act]");
		if (!ac) return;
		const [act, id] = String((ac as HTMLElement).dataset.act ?? "").split(":");
		const rec = pinStore.get(Number(id));
		if (!rec) return;
		if (act === "full") {
			pinStore.delete(Number(id));
			rec.pop.remove();
			rec.full(rec.p, null);
		} else if (act === "zoom") {
			const lat = Number(rec.p.lat);
			const lon = Number(rec.p.lon);
			if (Number.isFinite(lat) && Number.isFinite(lon)) {
				rec.map.flyTo({
					center: [lon, lat],
					zoom: Math.max(rec.map.getZoom() + 2, 6),
					speed: 1.4,
				});
			}
		}
	});
}

/** Click pins the rich preview — hover stays hover, nothing opens by itself.
 * Full view is one explicit button tap away. Replaces any previous pin. */
export function showPinned(
	map: maplibregl.Map,
	p: ObjProps,
	layer: string,
	lngLat: unknown,
	full: SelectFn,
): void {
	// Claim the id first: the replaced pin's close handler must see that it
	// is no longer the current card (and leave the click's mute alone).
	const id = ++pinSeq;
	for (const old of [...pinStore.keys()]) {
		pinStore.get(old)?.pop.remove();
		pinStore.delete(old);
	}
	// The pin replaces the hover, never joins it.
	closeHovers();
	const pop = new maplibregl.Popup({
		closeButton: true,
		closeOnClick: false,
		offset: 14,
		className: "hov-pop pin-pop",
		maxWidth: "320px",
	});
	pinStore.set(id, {
		p,
		key: `${layer}:${String(p.id ?? p.title ?? "")}`,
		map,
		pop,
		full,
	});
	pop.on("close", () => {
		pinStore.delete(id);
		// The current card was dismissed: hover is welcome again.
		if (id === pinSeq) muted.clear();
	});
	pop
		.setLngLat(lngLat as never)
		.setHTML(hoverCard(p as ObjProps & { ts?: string }, layer, id))
		.addTo(map);
	armThumb(pop, p);
}

/** Latest sinks (identical behavior across layers, refreshed per load):
 * preview pins the card, full opens the complete view. */
let pickPreview: SelectFn = () => {};
let pickFull: SelectFn = () => {};
let lastPickAt = 0;

/** Refresh the click sinks after every layer (re)load. */
export function setPickSinks(preview: SelectFn, full: SelectFn): void {
	pickPreview = preview;
	pickFull = full;
}

/** True while a picker owns the click (cluster zoom stands down). */
export function pickedRecently(): boolean {
	return Date.now() - lastPickAt < 500;
}

/** Every hover popup currently on the map. A click or a pin clears them:
 * hover + picker/pin for the same dot rendered as a "double hover". */
const openHovers = new Set<maplibregl.Popup>();
function closeHovers(): void {
	for (const h of openHovers) h.remove();
	openHovers.clear();
}

/** Hover rules that outlive a single controller:
 * - `muted`: the features under the last click. A click answers "what is
 *   this?" with a pin or picker; the hover must not come back for them
 *   while the pointer stays on them (it used to re-attach on the next
 *   mousemove — the double hover, and "clicking doesn't dismiss it" on
 *   near-invisible polygon washes). Cleared once the pointer moves on.
 * - `moving`: the camera is animating (drag, zoom, flyTo). Cards are
 *   anchored to the globe and would drift away from the pointer; no
 *   layer mouseleave fires during a move, so they'd strand. */
let muted = new Set<string>();
let moving = false;
const hoverKey = (layer: string, p: ObjProps) =>
	`${layer}:${String(p.id ?? p.title ?? "")}`;
/** An open stacked-items picker owns the pointer: no hover over it. */
function pickerOpen(): boolean {
	for (const r of pickStore.values()) if (r.pop.isOpen()) return true;
	return false;
}

/** De-jittered hover: mousemove fires per pixel, but rebuilding popup HTML
 * per pixel is layout thrash (the visible stutter). Coalesce to one frame
 * and skip setHTML while the pointer stays on the same feature — the card
 * just follows via setLngLat, which is cheap. */
export function steadyHover(
	map: maplibregl.Map,
	pop: maplibregl.Popup,
	render: (p: ObjProps, layer: string) => void,
): {
	move: (p: ObjProps, layer: string, ll: unknown) => void;
	leave: () => void;
} {
	let key = "";
	let raf = 0;
	let q: { p: ObjProps; layer: string; ll: unknown } | null = null;
	const flush = () => {
		raf = 0;
		const cur = q;
		q = null;
		if (!cur || moving || pickerOpen()) return;
		const k = hoverKey(cur.layer, cur.p);
		if (muted.has(k)) {
			// Still on what was just clicked: stay quiet, and remember it so
			// moving within the same feature doesn't re-trigger a render.
			key = k;
			return;
		}
		// Pointer reached something else: the click's mute has done its job.
		muted.clear();
		pop.setLngLat(cur.ll as never);
		// The pinned feature needs no hover echo on top of its own card.
		for (const [, r] of pinStore) if (r.key === k) return;
		if (k === key) {
			// Same feature — but another layer's card may have stood ours
			// down since (closeHovers removes without resetting our key).
			// Re-attach instead of stranding the pointer with no card.
			if (!pop.isOpen()) {
				pop.addTo(map);
				render(cur.p, cur.layer);
				openHovers.add(pop);
			}
			return;
		}
		key = k;
		// One hover at a time: overlapping layers (fill + dot) used to stack
		// two cards for one pixel. Stand the others down first, then attach
		// (render queries the live element for the satellite thumbnail).
		closeHovers();
		if (!pop.isOpen()) pop.addTo(map);
		render(cur.p, cur.layer);
		openHovers.add(pop);
	};
	return {
		move(p: ObjProps, layer: string, ll: unknown) {
			q = { p, layer, ll };
			if (!raf) raf = requestAnimationFrame(flush);
		},
		leave() {
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			q = null;
			// Leaving the clicked feature ends its mute: coming back is a
			// fresh hover.
			muted.delete(key);
			key = "";
			openHovers.delete(pop);
			pop.remove();
		},
	};
}

/** Our data layers only — no basemap, routes, terminator, labels. */
function pickBase(layerId: string): string | null {
	if (!layerId || layerId === "routes" || layerId === "terminator") return null;
	if (layerId === "sat" || layerId.endsWith("-n") || layerId.endsWith("-c"))
		return null;
	const base =
		layerId.endsWith("-o") || layerId.endsWith("-p")
			? layerId.slice(0, -2)
			: layerId;
	return LAYERS[base] ? base : null;
}

/**
 * One map-level click handler for every point/polygon layer (registered once).
 * Collects ALL of our features under the pixel: 0 → nothing, 1 → pin,
 * ≥2 (same-layer OR cross-layer stacks) → disambiguation card. This is the
 * "unclickable dot" fix: overlapping symbols no longer hide each other and
 * the winner is never load-order luck.
 */
export function ensurePickHandler(map: maplibregl.Map): void {
	const m = map as maplibregl.Map & { __thothPickBound?: boolean };
	if (m.__thothPickBound) return;
	m.__thothPickBound = true;
	// Grabbing, zooming or flying the globe drops every hover card; a new
	// one appears on the next pointer move once the camera settles.
	map.on("mousedown", closeHovers);
	map.on("touchstart", closeHovers);
	map.on("movestart", () => {
		moving = true;
		closeHovers();
	});
	map.on("moveend", () => {
		moving = false;
	});
	// Pointer left the canvas (onto a floating panel): layer mouseleave
	// never fires for that path, so the card would strand.
	map.on("mouseout", closeHovers);
	map.on("click", (e) => {
		// Click decides what is shown: any hover in flight stands down so
		// the picker/pin never renders on top of (or under) a hover card.
		closeHovers();
		muted = new Set();
		const feats: ObjProps[] = [];
		try {
			// ±10px tap box: icons render small, fingers and test pixels
			// still land. Single isolated hits stay single.
			const all = map.queryRenderedFeatures(
				[
					[e.point.x - 10, e.point.y - 10],
					[e.point.x + 10, e.point.y + 10],
				],
				{},
			);
			const seen = new Set<string>();
			for (const f of all) {
				const base = pickBase(
					(f.layer as { id?: string } | undefined)?.id ?? "",
				);
				if (!base) continue;
				const p = f.properties as unknown as ObjProps;
				const key = `${base}:${p.id ?? ""}`;
				if (seen.has(key)) continue;
				seen.add(key);
				feats.push({ ...p, layer: p.layer || base });
				// Hover keys use the layer the handler was bound with.
				muted.add(hoverKey(base, p));
			}
		} catch {
			return;
		}
		if (!feats.length) return;
		if (feats.length === 1) {
			const p = feats[0];
			pickPreview(p, e.lngLat);
			showPinned(map, p, p.layer, e.lngLat, pickFull);
			return;
		}
		lastPickAt = Date.now();
		showPickCard(
			map,
			feats.slice(0, 8),
			feats.length,
			e.lngLat,
			pickPreview,
			pickFull,
		);
	});
}

function showPickCard(
	map: maplibregl.Map,
	cands: ObjProps[],
	total: number,
	lngLat: maplibregl.LngLat,
	preview: SelectFn,
	full: SelectFn,
): void {
	const id = ++pickSeq;
	const pop = new maplibregl.Popup({
		closeButton: true,
		offset: 14,
		className: "pick-pop",
		maxWidth: "320px",
	});
	pickStore.set(id, { cands, preview, full, map, lngLat, pop });
	pop.on("close", () => {
		pickStore.delete(id);
		if (id === pickSeq) muted.clear();
	});
	const rows = cands
		.map(
			(c, i) =>
				`<button class="pick-row" data-pick="${id}:${i}"><b>${esc(c.title || c.id)}</b>` +
				`<span class="dim">${esc(c.layer)} · ${esc((c.severity || "info").toUpperCase())} · ${esc(ageStr((c as { ts?: string }).ts))}</span></button>`,
		)
		.join("");
	const more =
		total > cands.length
			? `<div class="hov-m dim">+${total - cands.length} more — zoom in</div>`
			: "";
	pop
		.setLngLat(lngLat)
		.setHTML(
			`<div class="hov pick"><div class="hov-t">${total} stacked — pick one</div>${rows}${more}</div>`,
		)
		.addTo(map);
}

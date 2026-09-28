// Precise imagery for a point: a 3×3 mosaic of Esri World Imagery tiles
// (the same source as the SAT basemap) offset so the object sits exactly in
// the centre of the frame, under a crosshair. Replaces the Sentinel-2 scene
// thumbnail in previews, which shows the whole ~110 km scene the point
// falls in, not the point itself.

const TILE = 256;
const URL =
	"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

/** Objects that move: imagery under them says nothing about them. */
export const MOVING_LAYERS = new Set([
	"flights",
	"vessels",
	"satellites",
	"drones",
]);

/** Fixed sites read at street level; area events need context. */
const SITE_LAYERS = new Set([
	"cctv",
	"bases",
	"ports",
	"airports",
	"datacenters",
	"energy",
	"transit",
	"signals",
	"radiation",
]);

export function satZoom(layer: string, polygon = false): number {
	if (polygon) return 9;
	if (SITE_LAYERS.has(layer)) return 16;
	return 12;
}

export type MosaicTile = { url: string; left: number; top: number };

/** Tiles to place with `left: calc(50% + left px)` / `top: calc(50% + top px)`. */
export function mosaic(lat: number, lon: number, z: number): MosaicTile[] {
	const n = 2 ** z;
	const la = Math.max(-85.0511, Math.min(85.0511, lat));
	const x = ((lon + 180) / 360) * n * TILE;
	const r = (la * Math.PI) / 180;
	const y =
		((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * TILE;
	const tx = Math.floor(x / TILE);
	const ty = Math.floor(y / TILE);
	const out: MosaicTile[] = [];
	for (let dy = -1; dy <= 1; dy++) {
		const row = ty + dy;
		if (row < 0 || row >= n) continue;
		for (let dx = -1; dx <= 1; dx++) {
			const col = tx + dx;
			const wrapped = ((col % n) + n) % n;
			out.push({
				url: `${URL}/${z}/${row}/${wrapped}`,
				left: Math.round(col * TILE - x),
				top: Math.round(row * TILE - y),
			});
		}
	}
	return out;
}

/** Ground width of the 256px centre tile, for the scale caption. */
export function tileKm(lat: number, z: number): number {
	return (40075 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

export function fmtKm(km: number): string {
	return km >= 10
		? `${Math.round(km)} km`
		: km >= 1
			? `${km.toFixed(1)} km`
			: `${Math.round(km * 1000)} m`;
}

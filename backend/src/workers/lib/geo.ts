// Geometry → one map point, for point layers fed by area geometries
// (warning polygons, incident GeometryCollections). The map renders point
// layers as markers, so a polygon stored there would draw a dot per vertex.

export type LonLat = { lon: number; lat: number };

/** Mean of every coordinate pair in the geometry — rough, but never lands
 * far outside a warning area the way a bbox corner can. */
export function centroid(g: unknown): LonLat | null {
	try {
		const flat: Array<[number, number]> = [];
		const walk = (c: unknown): void => {
			if (
				Array.isArray(c) &&
				typeof c[0] === "number" &&
				typeof c[1] === "number"
			) {
				flat.push([c[0], c[1]]);
			} else if (Array.isArray(c)) {
				c.forEach(walk);
			}
		};
		walk((g as { coordinates?: unknown } | null)?.coordinates);
		if (!flat.length) return null;
		let x = 0;
		let y = 0;
		for (const [lon, lat] of flat) {
			x += lon;
			y += lat;
		}
		return { lon: x / flat.length, lat: y / flat.length };
	} catch {
		return null;
	}
}

type Geom = { type?: string; coordinates?: unknown; geometries?: unknown };

/** The publisher's own marker when a GeometryCollection carries a Point
 * (incident feeds pair an origin point with burn-area polygons), otherwise
 * the centroid of the first member that has one. */
export function pointOf(g: unknown): LonLat | null {
	const geom = g as Geom | null;
	if (!geom || typeof geom !== "object") return null;
	if (geom.type !== "GeometryCollection") return centroid(geom);
	const members = Array.isArray(geom.geometries) ? geom.geometries : [];
	for (const m of members)
		if ((m as Geom)?.type === "Point") {
			const p = centroid(m);
			if (p) return p;
		}
	for (const m of members) {
		const p = pointOf(m);
		if (p) return p;
	}
	return null;
}

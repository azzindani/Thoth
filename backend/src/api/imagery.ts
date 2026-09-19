// Latest Sentinel-2 true-color over a point, via the earth-search STAC API
// (Element84, keyless). Returns the freshest low-cloud scene: preview
// thumbnail + true-color COG href. No scene (polar night, persistent cloud)
// is an honest null, never a placeholder.

export interface ImageryScene {
	id: string;
	datetime: string;
	cloud_cover: number | null;
	thumbnail: string;
	tci: string;
}

interface StacItem {
	id?: string;
	properties?: { datetime?: string; "eo:cloud_cover"?: number };
	assets?: Record<string, { href?: string } | undefined>;
}

export async function queryImagery(
	lon: number,
	lat: number,
	fetchImpl: typeof fetch = fetch,
): Promise<ImageryScene | null> {
	const end = new Date().toISOString();
	const start = new Date(Date.now() - 60 * 864e5).toISOString();
	// earth-search rejects zero-area bboxes — ±0.01° (~1km) box around the point.
	const e = 0.01;
	const u =
		"https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items" +
		`?bbox=${lon - e},${lat - e},${lon + e},${lat + e}&datetime=${encodeURIComponent(`${start}/${end}`)}` +
		"&limit=10&sortby=-properties.datetime";
	const r = await fetchImpl(u, { signal: AbortSignal.timeout(20000) });
	if (!r.ok) throw new Error(`earth-search HTTP ${r.status}`);
	const j = (await r.json()) as { features?: StacItem[] };
	const feats = Array.isArray(j.features) ? j.features : [];
	const usable = feats.filter(
		(f) => f.assets?.thumbnail?.href && f.assets?.visual?.href,
	);
	if (!usable.length) return null;
	const clear =
		usable.find((f) => (f.properties?.["eo:cloud_cover"] ?? 100) < 30) ??
		usable[0];
	return {
		id: String(clear.id ?? "unknown"),
		datetime: String(clear.properties?.datetime ?? ""),
		cloud_cover: clear.properties?.["eo:cloud_cover"] ?? null,
		thumbnail: String(clear.assets?.thumbnail?.href),
		tci: String(clear.assets?.visual?.href),
	};
}

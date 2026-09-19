import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// neptun.in.ua — Ukrainian open air-raid/drone track feed, keyless (ironsight pattern).
// Threat tracks with lat/lng, type, and confirmation confidence.
const URL = "https://neptun.in.ua/api/data";

const Track = z.object({
	track_id: z.string().optional(),
	id: z.string().optional(),
	lat: z.union([z.string(), z.number()]).nullable().optional(),
	lng: z.union([z.string(), z.number()]).nullable().optional(),
	threat_type: z.string().nullable().optional(),
	text: z.string().nullable().optional(),
	place: z.string().nullable().optional(),
	region: z.string().nullable().optional(),
	date: z.string().nullable().optional(),
	confidence_0_100: z.union([z.string(), z.number()]).nullable().optional(),
});

export function threatSeverity(t?: string | null): "critical" | "watch" {
	const s = (t ?? "").toLowerCase();
	if (s.includes("raketa") || s.includes("missile") || s.includes("ballistic"))
		return "critical";
	return "watch";
}

export async function collect() {
	const source = "neptun";
	const layer = "drones";
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { tracks?: unknown };
		const tracks = z.array(Track).parse(json.tracks ?? []);
		await storeRaw(source, layer, res.status, { n: tracks.length });
		let n = 0;
		for (const t of tracks.slice(0, 150)) {
			const lat = Number(t.lat);
			const lon = Number(t.lng);
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
			const ts = Date.parse(t.date ?? "");
			await storeNormalized({
				id: `neptun:${String(t.track_id ?? t.id ?? `${lat},${lon}`)}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source,
				layer,
				title: `${t.threat_type ?? "threat"} — ${t.place ?? "?"} (${t.region ?? "?"})`,
				body: (t.text ?? "").slice(0, 300),
				severity: threatSeverity(t.threat_type),
				confidence: Math.min(
					1,
					Math.max(0.3, Number(t.confidence_0_100 ?? 60) / 100),
				),
				lon,
				lat,
				entities: {},
				meta: { threat: t.threat_type, region: t.region },
			});
			n++;
		}
		await markHealth(source, true);
		return { ok: true, count: n };
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

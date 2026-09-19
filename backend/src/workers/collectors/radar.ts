// RainViewer global radar index (keyless): past + nowcast frame timestamps
// and tile host → `weather` layer as non-geo index rows (ticker/counts/
// timeline pattern). The map overlay itself reads the tile URLs client-side;
// the collector records index freshness so STALE is honest.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const URL = "https://api.rainviewer.com/public/weather-maps.json";

const Index = z.object({
	version: z.union([z.string(), z.number()]).optional(),
	generated: z.number().optional(),
	host: z.string().optional(),
	radar: z
		.object({
			past: z
				.array(z.object({ time: z.number(), path: z.string() }))
				.optional(),
			nowcast: z
				.array(z.object({ time: z.number(), path: z.string() }))
				.optional(),
		})
		.passthrough()
		.optional(),
	satellite: z
		.object({
			infrared: z
				.array(z.object({ time: z.number(), path: z.string() }))
				.optional(),
		})
		.passthrough()
		.optional(),
});

export async function collect() {
	const source = "rainviewer";
	const layer = "weather";
	let n = 0;
	const errors: string[] = [];
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const idx = Index.parse(await res.json());
		const past = idx.radar?.past ?? [];
		const nowcast = idx.radar?.nowcast ?? [];
		await storeRaw(source, layer, res.status, {
			past: past.length,
			nowcast: nowcast.length,
		});
		if (!past.length && !nowcast.length) throw new Error("empty index");
		const newest = Math.max(
			...past.map((f) => f.time),
			...nowcast.map((f) => f.time),
		);
		const ts = new Date(newest * 1000).toISOString();
		await storeNormalized({
			id: `rainviewer:index:${newest}`,
			ts,
			source,
			layer,
			title: `Global radar index: ${past.length} past + ${nowcast.length} nowcast frames`,
			severity: "info",
			confidence: 0.9,
			entities: {},
			meta: {
				host: idx.host,
				past: past.length,
				nowcast: nowcast.length,
				frame: newest,
			},
		});
		n++;
		await markHealth(source, true);
		// RainViewer satellite infrared index (same payload, `satellite`
		// key): cloud-cover frames next to radar — the IR leg, honest-green
		// even when the host serves zero frames. Probe-verified 2026-09-17
		// (key present, 0 frames right now).
		const ir = idx.satellite?.infrared ?? [];
		await storeRaw("rainviewer-ir", layer, res.status, { n: ir.length });
		if (ir.length > 0) {
			await storeNormalized({
				id: `rainviewer:ir:${ir[ir.length - 1].time}`,
				ts: new Date(ir[ir.length - 1].time * 1000).toISOString(),
				source: "rainviewer-ir",
				layer,
				title: `Satellite IR index: ${ir.length} frames`,
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: { frames: ir.length, host: idx.host },
			});
			n++;
		}
		await markHealth("rainviewer-ir", true);
	} catch (e: unknown) {
		errors.push(`${source}: ${errMsg(e)}`);
		await markHealth(source, false, errors[errors.length - 1]);
		await markHealth("rainviewer-ir", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

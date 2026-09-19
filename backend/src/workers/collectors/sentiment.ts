// Crypto Fear & Greed Index (alternative.me, keyless) → `markets` enrich.
// One datapoint a day: greed tops and fear bottoms are the contrarian tells
// next to price rows. Daily poll; sparse-by-design.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const FNG_URL = "https://api.alternative.me/fng/?limit=7&format=json";

const Fng = z.object({
	data: z.array(
		z.object({
			value: z.string(),
			value_classification: z.string(),
			timestamp: z.string(),
		}),
	),
});

export function fngSeverity(v: number): "info" | "watch" | "critical" {
	if (v <= 15 || v >= 90) return "critical"; // extreme fear / greed
	if (v <= 30 || v >= 70) return "watch";
	return "info";
}

export async function collect() {
	const source = "fng";
	const layer = "markets";
	try {
		assertSafeUrl(FNG_URL);
		const res = await stealthFetch(FNG_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = Fng.parse(await res.json()).data;
		await storeRaw(source, layer, res.status, { n: rows.length });
		let n = 0;
		for (const r of rows) {
			const v = Number(r.value);
			if (!Number.isFinite(v)) continue;
			const ts = Number(r.timestamp) * 1000;
			await storeNormalized({
				id: `fng:${r.timestamp}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source,
				layer,
				title: `Fear & Greed ${v} — ${r.value_classification}`,
				severity: fngSeverity(v),
				confidence: 0.8,
				entities: {},
				meta: { value: v, class: r.value_classification },
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

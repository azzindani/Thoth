// Manifold prediction markets (keyless search API): statecraft/conflict/
// macro questions with volume + probability. Polymarket/Kalshi complement —
// the leg that actually answered from this sandbox.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const TERMS = ["war", "election", "ceasefire", "recession", "nuclear"];

const Market = z
	.object({
		id: z.string().optional(),
		question: z.string().optional(),
		url: z.string().optional(),
		volume: z.number().nullable().optional(),
		volume24Hours: z.number().nullable().optional(),
		outcomeType: z.string().optional(),
		probability: z.number().nullable().optional(),
		mechanism: z.string().optional(),
		closeTime: z.number().nullable().optional(),
	})
	.passthrough();

export async function collect() {
	const source = "manifold";
	const layer = "markets";
	let n = 0;
	const errors: string[] = [];

	for (const term of TERMS) {
		try {
			const url = `https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(term)}&limit=8`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const mks = z.array(Market).parse(await res.json());
			await storeRaw(source, layer, res.status, { term, n: mks.length });
			for (const m of mks) {
				if (!m.id || !m.question) continue;
				const prob =
					typeof m.probability === "number"
						? `${Math.round(m.probability * 100)}%`
						: "";
				await storeNormalized({
					id: `manifold:${m.id}`,
					ts: new Date().toISOString(),
					source,
					layer,
					title: `${m.question}${prob ? ` — ${prob}` : ""}`.slice(0, 280),
					url: m.url,
					severity: (m.volume ?? 0) > 100000 ? "watch" : "info",
					confidence: 0.7,
					entities: {},
					meta: {
						term,
						volume: m.volume,
						vol24: m.volume24Hours,
						outcome: m.outcomeType,
					},
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`${term}: ${errMsg(e)}`);
		}
	}

	await markHealth(
		source,
		n > 0,
		n > 0 ? undefined : errors.slice(0, 3).join("; "),
	);
	if (n === 0) return { ok: false, error: errors.slice(0, 5).join("; ") };
	return { ok: true, count: n };
}

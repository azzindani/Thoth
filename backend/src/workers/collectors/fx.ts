// ECB euro reference rates via Frankfurter (keyless, daily). USD-base majors
// into the markets layer — FX depth without a Finnhub key.

import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const SYMBOLS = ["EUR", "GBP", "UAH", "JPY", "CNY", "CHF", "PLN", "SEK"];

// EUR-base cross (keyless, same Frankfurter host): the reverse view —
// USD/GBP/JPY/CHF per euro. Probe-verified 2026-09-17.
const EUR_SYMBOLS = ["USD", "GBP", "JPY", "CHF"];

export async function collect() {
	const source = "frankfurter";
	const layer = "markets";
	let n = 0;
	const errors: string[] = [];
	try {
		const url = `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${SYMBOLS.join(",")}`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as {
			date?: string;
			rates?: Record<string, number>;
		};
		const rates = json.rates ?? {};
		const day = String(json.date ?? new Date().toISOString().slice(0, 10));
		await storeRaw(source, layer, res.status, { n: Object.keys(rates).length });
		for (const sym of SYMBOLS) {
			const rate = rates[sym];
			if (typeof rate !== "number") continue;
			await storeNormalized({
				id: `fx:USD${sym}:${day}`,
				ts: new Date().toISOString(),
				source,
				layer,
				title: `USD/${sym} ${rate}`,
				severity: "info",
				confidence: 0.95,
				entities: { pair: `USD/${sym}` },
				meta: { rate, date: day },
			});
			n++;
		}
		await markHealth(source, true);
	} catch (e: unknown) {
		errors.push(`${source}: ${errMsg(e)}`);
		await markHealth(source, false, errors[errors.length - 1]);
	}
	// EUR-base cross leg: independent poll, own ids/health.
	try {
		const url = `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${EUR_SYMBOLS.join(",")}`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as {
			date?: string;
			rates?: Record<string, number>;
		};
		const rates = json.rates ?? {};
		const day = String(json.date ?? new Date().toISOString().slice(0, 10));
		await storeRaw("frankfurter-eur", layer, res.status, {
			n: Object.keys(rates).length,
		});
		for (const sym of EUR_SYMBOLS) {
			const rate = rates[sym];
			if (typeof rate !== "number") continue;
			await storeNormalized({
				id: `fx:EUR${sym}:${day}`,
				ts: new Date().toISOString(),
				source: "frankfurter-eur",
				layer,
				title: `EUR/${sym} ${rate}`,
				severity: "info",
				confidence: 0.95,
				entities: { pair: `EUR/${sym}` },
				meta: { rate, date: day },
			});
			n++;
		}
		await markHealth("frankfurter-eur", true);
	} catch (e: unknown) {
		errors.push(`frankfurter-eur: ${errMsg(e)}`);
		await markHealth("frankfurter-eur", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

// Finnhub earnings calendar (markets depth). Free-signup key in FINNHUB_KEY.
// Unset → honest disabled, zero fake data (same contract as OTX).

import { config } from "../../config.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

interface Earning {
	date?: string;
	epsActual?: number | null;
	epsEstimate?: number | null;
	hour?: string;
	symbol?: string;
	year?: number;
	quarter?: number;
}

export async function collect() {
	const source = "finnhub";
	const layer = "markets";
	if (!config.FINNHUB_KEY) {
		await markHealth(
			source,
			false,
			"disabled: FINNHUB_KEY unset (free signup)",
		);
		return { ok: false, error: "disabled: FINNHUB_KEY unset" };
	}
	try {
		const from = new Date().toISOString().slice(0, 10);
		const to = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
		const url =
			`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}` +
			`&token=${encodeURIComponent(config.FINNHUB_KEY)}`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { earningsCalendar?: unknown };
		const rows = (
			Array.isArray(json.earningsCalendar) ? json.earningsCalendar : []
		) as Earning[];
		await storeRaw(source, layer, res.status, { n: rows.length });
		let n = 0;
		for (const e of rows.slice(0, 100)) {
			if (!e.symbol) continue;
			await storeNormalized({
				id: `earnings:${e.symbol}:${e.date ?? from}`,
				ts: new Date().toISOString(),
				source,
				layer,
				title: `${e.symbol} earnings ${e.date ?? ""}`.trim(),
				severity: "info",
				confidence: 0.7,
				entities: { symbol: e.symbol },
				meta: {
					epsActual: e.epsActual ?? null,
					epsEstimate: e.epsEstimate ?? null,
					quarter: e.quarter ?? null,
				},
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

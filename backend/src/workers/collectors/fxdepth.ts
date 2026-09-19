// FX redundancy: ECB official reference rates (daily XML, the source
// Frankfurter mirrors) + fxratesapi keyless JSON fallback. Frankfurter stays
// primary in fx.ts; this is the second and third opinion when it 429s.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const WANT = ["USD", "GBP", "JPY", "CHF", "CNY", "UAH", "PLN", "SEK"];

export function parseEcb(xml: string): {
	day: string;
	rates: Record<string, number>;
} {
	const day = xml.match(/time='([\d-]+)'/)?.[1] ?? "";
	const rates: Record<string, number> = {};
	for (const m of xml.matchAll(/currency='([A-Z]{3})' rate='([\d.]+)'/g)) {
		const v = Number(m[2]);
		if (Number.isFinite(v)) rates[m[1]] = v;
	}
	return { day, rates };
}

const FxRates = z.object({
	base: z.string().optional(),
	date: z.string().optional(),
	rates: z.record(z.number()).optional(),
});

export async function collect() {
	const layer = "markets";
	let n = 0;
	const errors: string[] = [];

	// ECB direct: EUR-base official rates, inverted to USD-base for parity
	// with the frankfurter USD rows. Own fxecb: id prefix (fixed 2026-09-18:
	// shared fx:USDXXX ids collided across ecb/nbp/frankfurter sources —
	// ON CONFLICT updated title without updating source).
	try {
		assertSafeUrl(ECB_URL);
		const res = await stealthFetch(ECB_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const { day, rates } = parseEcb(await res.text());
		if (!day || !rates.USD) throw new Error("no ECB cube");
		await storeRaw("ecb", layer, res.status, {
			day,
			n: Object.keys(rates).length,
		});
		for (const sym of WANT) {
			const eurRate = rates[sym];
			if (typeof eurRate !== "number" || !eurRate) continue;
			const usd = rates.USD / eurRate; // USD/sym via EUR cross
			await storeNormalized({
				id: `fxecb:USD${sym}:${day}`,
				ts: new Date().toISOString(),
				source: "ecb",
				layer,
				title: `USD/${sym} ${Math.round(usd * 10000) / 10000} (ECB ${day})`,
				severity: "info",
				confidence: 0.95,
				entities: { pair: `USD/${sym}` },
				meta: { rate: usd, date: day, via: "ECB" },
			});
			n++;
		}
		await markHealth("ecb", true);
	} catch (e: unknown) {
		errors.push(`ecb: ${errMsg(e)}`);
		await markHealth("ecb", false, errors[errors.length - 1]);
	}

	// fxratesapi: plain USD-base JSON, keyless.
	try {
		const url = `https://api.fxratesapi.com/latest?base=USD&currencies=${WANT.join(",")}`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = FxRates.parse(await res.json());
		const rates = j.rates ?? {};
		const day =
			String(j.date ?? "").slice(0, 10) ||
			new Date().toISOString().slice(0, 10);
		await storeRaw("fxrates", layer, res.status, {
			n: Object.keys(rates).length,
		});
		for (const sym of WANT) {
			const rate = rates[sym];
			if (typeof rate !== "number") continue;
			await storeNormalized({
				id: `fxr:USD${sym}:${day}`,
				ts: new Date().toISOString(),
				source: "fxrates",
				layer,
				title: `USD/${sym} ${rate}`,
				severity: "info",
				confidence: 0.85,
				entities: { pair: `USD/${sym}` },
				meta: { rate, date: day },
			});
			n++;
		}
		await markHealth("fxrates", true);
	} catch (e: unknown) {
		errors.push(`fxrates: ${errMsg(e)}`);
		await markHealth("fxrates", false, errors[errors.length - 1]);
	}

	// NBP Polish FX table (keyless, daily): PLN-base majors inverted to
	// USD-base for parity with the frankfurter USD rows. Own fxnbp: prefix.
	try {
		const url = "https://api.nbp.pl/api/exchangerates/tables/a/?format=json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const tables = (await res.json()) as {
			effectiveDate?: string;
			rates?: { code?: string; mid?: number }[];
		}[];
		const t0 = tables[0];
		const day = String(t0?.effectiveDate ?? "").slice(0, 10);
		const byCode = new Map((t0?.rates ?? []).map((r) => [r.code, r.mid]));
		const usdPln = byCode.get("USD");
		if (!day || typeof usdPln !== "number" || !usdPln)
			throw new Error("no NBP table");
		await storeRaw("nbp", layer, res.status, {
			day,
			n: byCode.size,
		});
		for (const sym of WANT) {
			if (sym === "USD") continue;
			const plnPer = byCode.get(sym);
			if (typeof plnPer !== "number" || !plnPer) continue;
			const usd = usdPln / plnPer; // USD/sym via PLN cross
			await storeNormalized({
				id: `fxnbp:USD${sym}:${day}`,
				ts: new Date().toISOString(),
				source: "nbp",
				layer,
				title: `USD/${sym} ${Math.round(usd * 10000) / 10000} (NBP ${day})`,
				severity: "info",
				confidence: 0.9,
				entities: { pair: `USD/${sym}` },
				meta: { rate: usd, date: day, via: "NBP" },
			});
			n++;
		}
		await markHealth("nbp", true);
	} catch (e: unknown) {
		errors.push(`nbp: ${errMsg(e)}`);
		await markHealth("nbp", false, errors[errors.length - 1]);
	}

	// ER-API USD + EUR tables (keyless, no signup): fourth FX opinion.
	for (const [base, src] of [
		["USD", "erapi-usd"],
		["EUR", "erapi-eur"],
	] as const) {
		try {
			const url = `https://open.er-api.com/v6/latest/${base}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const j = (await res.json()) as {
				result?: string;
				time_last_update_utc?: string;
				rates?: Record<string, number>;
			};
			if (j.result !== "success") throw new Error("not success");
			const rates = j.rates ?? {};
			// time_last_update_utc is RFC2822 ("Fri, 18 Sep 2026 00:02:31
			// +0000") — slice(0,10) yields "Fri, 18 Se" (seen live
			// 2026-09-18). Parse to ISO date instead.
			const rawDay = j.time_last_update_utc ?? "";
			const parsed = rawDay ? new Date(rawDay) : null;
			const day = (
				parsed && !Number.isNaN(+parsed)
					? parsed.toISOString()
					: new Date().toISOString()
			).slice(0, 10);
			await storeRaw(src, layer, res.status, {
				n: Object.keys(rates).length,
			});
			let m = 0;
			for (const sym of WANT) {
				if (sym === base) continue;
				// EUR-base × sym=USD degenerates to eurUsd/eurUsd = 1
				// (the live USD/USD 1 row). EUR/USD itself is covered by
				// ecb/frankfurter/yahoo — skip it here.
				if (base === "EUR" && sym === "USD") continue;
				let usd: number | null = null;
				if (base === "USD") usd = rates[sym] ?? null;
				else {
					// EUR-base → USD/sym via EURUSD cross.
					const eurSym = rates[sym];
					const eurUsd = rates.USD;
					if (
						typeof eurSym === "number" &&
						typeof eurUsd === "number" &&
						eurSym
					)
						usd = eurUsd / eurSym;
				}
				if (typeof usd !== "number" || !usd) continue;
				// EUR-base rows mirror USD-base pairs (per-euro maths in usd);
				// the via tag carries the base. EUR/USD skipped above (it
				// degenerates to 1 and is covered by ecb/frankfurter/yahoo).
				const pair = `USD/${sym}`;
				await storeNormalized({
					id: `${src === "erapi-usd" ? "fxe" : "fxee"}:${pair.replace("/", "")}:${day || new Date().toISOString().slice(0, 10)}`,
					ts: new Date().toISOString(),
					source: src,
					layer,
					title: `${pair} ${Math.round(usd * 10000) / 10000} (ER-API ${base} ${day || "?"})`,
					severity: "info",
					confidence: 0.8,
					entities: { pair },
					meta: { rate: usd, via: `ER-API/${base}` },
				});
				m++;
			}
			if (!m) throw new Error("no pairs");
			n += m;
			await markHealth(src, true);
		} catch (e: unknown) {
			errors.push(`${src}: ${errMsg(e)}`);
			await markHealth(src, false, errors[errors.length - 1]);
		}
	}

	// CoinLore tickers (keyless): BTC/ETH/SOL third crypto opinion.
	try {
		const url = "https://api.coinlore.net/api/tickers/?start=0&limit=10";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			data?: {
				symbol?: string;
				price_usd?: string;
				percent_change_24h?: string;
			}[];
		};
		const rows = (j.data ?? []).filter((c) =>
			["BTC", "ETH", "SOL"].includes(c.symbol ?? ""),
		);
		await storeRaw("coinlore", layer, res.status, { n: rows.length });
		for (const c of rows) {
			const px = Number(c.price_usd ?? NaN);
			const chg = Number(c.percent_change_24h ?? NaN);
			if (!Number.isFinite(px)) continue;
			await storeNormalized({
				id: `coinlore:${c.symbol}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "coinlore",
				layer,
				title: `${c.symbol} $${px.toLocaleString()} (${Number.isFinite(chg) ? `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 24h` : "24h"}, CoinLore)`,
				severity: Number.isFinite(chg) && Math.abs(chg) > 5 ? "watch" : "info",
				confidence: 0.8,
				entities: {},
				meta: { coin: c.symbol, px, chg24: Number.isFinite(chg) ? chg : null },
			});
			n++;
		}
		await markHealth("coinlore", true);
	} catch (e: unknown) {
		errors.push(`coinlore: ${errMsg(e)}`);
		await markHealth("coinlore", false, errors[errors.length - 1]);
	}

	// CoinPaprika per-coin (keyless): BTC/ETH/SOL fourth crypto opinion.
	for (const [slug, sym] of [
		["btc-bitcoin", "BTC"],
		["eth-ethereum", "ETH"],
		["sol-solana", "SOL"],
	] as const) {
		try {
			const url = `https://api.coinpaprika.com/v1/tickers/${slug}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${sym}`);
			const j = (await res.json()) as {
				quotes?: { USD?: { price?: number; percent_change_24h?: number } };
			};
			const px = j.quotes?.USD?.price;
			if (typeof px !== "number") throw new Error("no price");
			const chg = j.quotes?.USD?.percent_change_24h;
			await storeRaw("paprika", layer, res.status, { sym });
			await storeNormalized({
				id: `paprika:${sym}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "paprika",
				layer,
				title: `${sym} $${px.toLocaleString()} (${typeof chg === "number" ? `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 24h` : "24h"}, Paprika)`,
				severity:
					typeof chg === "number" && Math.abs(chg) > 5 ? "watch" : "info",
				confidence: 0.8,
				entities: {},
				meta: { coin: sym, px, chg24: chg ?? null },
			});
			n++;
		} catch (e: unknown) {
			errors.push(`paprika/${sym}: ${errMsg(e)}`);
		}
	}
	const paprikaOk = !errors.some((e) => e.startsWith("paprika/"));
	await markHealth(
		"paprika",
		paprikaOk,
		paprikaOk
			? undefined
			: errors.filter((e) => e.startsWith("paprika")).join("; "),
	);

	// Bitfinex tickers (keyless v2): BTC/ETH fifth + sixth opinion.
	// v2 ticker array: [SYM, BID, BID_SIZE, ASK, ASK_SIZE, DAILY_CHANGE,
	// DAILY_CHANGE_REL, LAST_PRICE, VOLUME, HIGH, LOW] — price is LAST_PRICE
	// at index 7, change is the DAILY_CHANGE_REL ratio at index 6 (fixed
	// 2026-09-18: was reading r[6]/r[5], producing $0.002 / +430% rows).
	for (const sym of ["tBTCUSD", "tETHUSD"] as const) {
		try {
			const url = `https://api-pub.bitfinex.com/v2/tickers?symbols=${sym}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${sym}`);
			const rows = (await res.json()) as unknown[][];
			const r = rows[0] ?? [];
			const px = Number(r[7] ?? NaN);
			if (!Number.isFinite(px)) throw new Error("no price");
			const chgPct = Number(r[6] ?? NaN) * 100;
			const coin = sym === "tBTCUSD" ? "BTC" : "ETH";
			await storeRaw("bitfinex", layer, res.status, { sym });
			await storeNormalized({
				id: `bitfinex:${coin}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "bitfinex",
				layer,
				title: `${coin} $${px.toLocaleString()} (${Number.isFinite(chgPct) ? `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(1)}% 24h` : "24h"}, Bitfinex)`,
				severity:
					Number.isFinite(chgPct) && Math.abs(chgPct) > 5 ? "watch" : "info",
				confidence: 0.8,
				entities: {},
				meta: { coin, px, chg24: Number.isFinite(chgPct) ? chgPct : null },
			});
			n++;
		} catch (e: unknown) {
			errors.push(`bitfinex/${sym}: ${errMsg(e)}`);
		}
	}
	const bfxOk = !errors.some((e) => e.startsWith("bitfinex/"));
	await markHealth(
		"bitfinex",
		bfxOk,
		bfxOk
			? undefined
			: errors.filter((e) => e.startsWith("bitfinex")).join("; "),
	);

	// KuCoin level-1 (keyless): BTC spot best bid/ask pulse.
	try {
		const url =
			"https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			code?: string;
			data?: { price?: string; bestBid?: string; bestAsk?: string };
		};
		if (j.code !== "200000") throw new Error(`code ${j.code}`);
		const px = Number(j.data?.price ?? NaN);
		if (!Number.isFinite(px)) throw new Error("no price");
		await storeRaw("kucoin", layer, res.status, { px });
		await storeNormalized({
			id: `kucoin:BTC:${new Date().toISOString().slice(0, 13)}`,
			ts: new Date().toISOString(),
			source: "kucoin",
			layer,
			title: `BTC $${px.toLocaleString()} (KuCoin spot)`,
			severity: "info",
			confidence: 0.8,
			entities: {},
			meta: { coin: "BTC", px, bid: j.data?.bestBid, ask: j.data?.bestAsk },
		});
		n++;
		await markHealth("kucoin", true);
	} catch (e: unknown) {
		errors.push(`kucoin: ${errMsg(e)}`);
		await markHealth("kucoin", false, errors[errors.length - 1]);
	}

	// ECB-via-Frankfurter daily (keyless, frankfurter.dev mirrors the ECB
	// reference rates): USD-base snapshot, 29 pairs incl EUR/GBP/JPY/CNY.
	try {
		const url = "https://api.frankfurter.dev/v1/latest?base=USD";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			date?: string;
			base?: string;
			rates?: Record<string, number>;
		};
		const rates = j.rates ?? {};
		await storeRaw("frankfurter", layer, res.status, {
			n: Object.keys(rates).length,
		});
		for (const c of ["EUR", "GBP", "JPY", "CNY"]) {
			const v = rates[c];
			if (typeof v !== "number") continue;
			await storeNormalized({
				id: `frankfurter:USD${c}:${j.date ?? new Date().toISOString().slice(0, 10)}`,
				ts: j.date ?? new Date().toISOString(),
				source: "frankfurter",
				layer,
				title: `USD/${c} ${v} (ECB ref ${j.date ?? "?"})`,
				severity: "info",
				confidence: 0.9,
				entities: {},
				meta: { pair: `USD/${c}`, rate: v, date: j.date },
			});
			n++;
		}
		await markHealth("frankfurter", true);
	} catch (e: unknown) {
		errors.push(`frankfurter: ${errMsg(e)}`);
		await markHealth("frankfurter", false, errors[errors.length - 1]);
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

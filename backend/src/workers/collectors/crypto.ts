// Keyless crypto depth: Binance 24h tickers (per-symbol stats) + Coinbase
// exchange rates (full fiat table). CoinGecko stays as the third opinion;
// Binance is the one that answers when CoinGecko 429s.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

const Ticker = z
	.object({
		symbol: z.string().optional(),
		lastPrice: z.string().optional(),
		priceChangePercent: z.string().optional(),
		highPrice: z.string().optional(),
		lowPrice: z.string().optional(),
		volume: z.string().optional(),
		quoteVolume: z.string().optional(),
	})
	.passthrough();

const Rates = z.object({
	data: z.object({
		currency: z.string().optional(),
		rates: z.record(z.string()).optional(),
	}),
});

export async function collect() {
	const layer = "markets";
	let n = 0;
	const errors: string[] = [];

	// Binance 24h tickers: one request per symbol, well under limits.
	for (const sym of SYMBOLS) {
		try {
			const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const t = Ticker.parse(await res.json());
			await storeRaw("binance", layer, res.status, { sym });
			const px = Number(t.lastPrice ?? NaN);
			const chg = Number(t.priceChangePercent ?? NaN);
			if (!Number.isFinite(px)) throw new Error("no price");
			const coin = sym.replace(/USDT$/, "");
			await storeNormalized({
				id: `binance:${coin}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "binance",
				layer,
				title: `${coin} $${px.toLocaleString()} (${Number.isFinite(chg) ? `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 24h` : "24h"})`,
				severity: Number.isFinite(chg) && Math.abs(chg) > 5 ? "watch" : "info",
				confidence: 0.95,
				entities: {},
				meta: {
					coin,
					px,
					chg24: Number.isFinite(chg) ? chg : null,
					high: t.highPrice,
					low: t.lowPrice,
					vol: t.volume,
				},
			});
			n++;
		} catch (e: unknown) {
			errors.push(`binance/${sym}: ${errMsg(e)}`);
		}
	}
	if (n > 0) await markHealth("binance", true);
	else
		await markHealth(
			"binance",
			false,
			errors.filter((e) => e.startsWith("binance")).join("; "),
		);

	// Kraken: OHLC/volume second opinion (XBT/ETH USD pairs).
	try {
		const url = "https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			result?: Record<
				string,
				{ c?: string[]; h?: string[]; l?: string[]; v?: string[] }
			>;
		};
		const pairs: [string, string][] = [
			["XXBTZUSD", "BTC"],
			["XETHZUSD", "ETH"],
		];
		let stored = 0;
		for (const [key, coin] of pairs) {
			const px = Number(j.result?.[key]?.c?.[0] ?? NaN);
			if (!Number.isFinite(px)) continue;
			await storeNormalized({
				id: `kraken:${coin}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "kraken",
				layer,
				title: `${coin} $${px.toLocaleString()} (Kraken)`,
				severity: "info",
				confidence: 0.9,
				entities: {},
				meta: {
					coin,
					px,
					high: j.result?.[key]?.h?.[1],
					low: j.result?.[key]?.l?.[1],
					vol: j.result?.[key]?.v?.[1],
				},
			});
			stored++;
		}
		if (!stored) throw new Error("no kraken pairs");
		n += stored;
		await markHealth("kraken", true);
	} catch (e: unknown) {
		errors.push(`kraken: ${errMsg(e)}`);
		await markHealth("kraken", false, errors[errors.length - 1]);
	}

	// Bitstamp: vwap + bid/ask third opinion (BTC only, one call).
	try {
		const url = "https://www.bitstamp.net/api/v2/ticker/btcusd/";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			last?: string;
			vwap?: string;
			volume?: string;
		};
		const px = Number(j.last ?? NaN);
		if (!Number.isFinite(px)) throw new Error("no price");
		await storeRaw("bitstamp", layer, res.status, { px });
		await storeNormalized({
			id: `bitstamp:BTC:${new Date().toISOString().slice(0, 13)}`,
			ts: new Date().toISOString(),
			source: "bitstamp",
			layer,
			title: `BTC $${px.toLocaleString()} (Bitstamp vwap ${j.vwap ?? "?"})`,
			severity: "info",
			confidence: 0.9,
			entities: {},
			meta: { coin: "BTC", px, vwap: j.vwap, vol: j.volume },
		});
		n++;
		await markHealth("bitstamp", true);
	} catch (e: unknown) {
		errors.push(`bitstamp: ${errMsg(e)}`);
		await markHealth("bitstamp", false, errors[errors.length - 1]);
	}

	// mempool.space: chain head + fee pressure (Bitcoin on-chain pulse).
	try {
		const hUrl = "https://mempool.space/api/blocks/tip/height";
		const fUrl = "https://mempool.space/api/v1/fees/recommended";
		assertSafeUrl(hUrl);
		const hr = await stealthFetch(hUrl);
		if (!hr.ok) throw new Error(`HTTP ${hr.status} height`);
		const height = Number(await hr.text());
		assertSafeUrl(fUrl);
		const fr = await stealthFetch(fUrl);
		if (!fr.ok) throw new Error(`HTTP ${fr.status} fees`);
		const fees = (await fr.json()) as {
			fastestFee?: number;
			hourFee?: number;
		};
		if (!Number.isFinite(height)) throw new Error("no height");
		await storeRaw("mempool", layer, 200, { height, fees });
		await storeNormalized({
			id: `mempool:${height}`,
			ts: new Date().toISOString(),
			source: "mempool",
			layer,
			title: `BTC block ${height} · fastest ${fees.fastestFee ?? "?"} sat/vB`,
			severity: "info",
			confidence: 0.9,
			entities: {},
			meta: { height, fastestFee: fees.fastestFee, hourFee: fees.hourFee },
		});
		n++;
		await markHealth("mempool", true);
	} catch (e: unknown) {
		errors.push(`mempool: ${errMsg(e)}`);
		await markHealth("mempool", false, errors[errors.length - 1]);
	}

	// Coinbase: one call returns the whole fiat/crypto table — snapshot majors.
	try {
		const url = "https://api.coinbase.com/v2/exchange-rates?currency=BTC";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rates = Rates.parse(await res.json()).data.rates ?? {};
		await storeRaw("coinbase", layer, res.status, {
			n: Object.keys(rates).length,
		});
		const majors = ["USD", "EUR", "GBP", "JPY", "CHF"] as const;
		let stored = 0;
		for (const fiat of majors) {
			const v = Number(rates[fiat] ?? NaN);
			if (!Number.isFinite(v)) continue;
			await storeNormalized({
				id: `coinbase:BTC${fiat}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "coinbase",
				layer,
				title: `BTC/${fiat} ${v.toLocaleString()}`,
				severity: "info",
				confidence: 0.9,
				entities: {},
				meta: { pair: `BTC/${fiat}`, rate: v },
			});
			stored++;
		}
		n += stored;
		await markHealth("coinbase", true);
	} catch (e: unknown) {
		errors.push(`coinbase: ${errMsg(e)}`);
		await markHealth("coinbase", false, errors[errors.length - 1]);
	}

	// Gate.io spot tickers (keyless): fourth exchange opinion (BTC/ETH/SOL).
	for (const [pair, coin] of [
		["BTC_USDT", "BTC"],
		["ETH_USDT", "ETH"],
		["SOL_USDT", "SOL"],
	] as const) {
		try {
			const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${pair}`);
			const j = (await res.json()) as {
				last?: string;
				change_percentage?: string;
				high_24h?: string;
				low_24h?: string;
				base_volume?: string;
			}[];
			const t = j[0];
			const px = Number(t?.last ?? NaN);
			if (!Number.isFinite(px)) throw new Error("no price");
			const chg = Number(t?.change_percentage ?? NaN);
			await storeRaw("gateio", layer, res.status, { pair });
			await storeNormalized({
				id: `gateio:${coin}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "gateio",
				layer,
				title: `${coin} $${px.toLocaleString()} (${Number.isFinite(chg) ? `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 24h` : "24h"}, Gate.io)`,
				severity: Number.isFinite(chg) && Math.abs(chg) > 5 ? "watch" : "info",
				confidence: 0.85,
				entities: {},
				meta: { coin, px, chg24: Number.isFinite(chg) ? chg : null },
			});
			n++;
		} catch (e: unknown) {
			errors.push(`gateio/${pair}: ${errMsg(e)}`);
		}
	}
	const gateOk = !errors.some((e) => e.startsWith("gateio/"));
	await markHealth(
		"gateio",
		gateOk,
		gateOk
			? undefined
			: errors.filter((e) => e.startsWith("gateio")).join("; "),
	);

	// StopForumSpam IP reputation (keyless): spam-signal for a sentinel IP.
	// Poll leg is a heartbeat row (reputation of 1.1.1.1 = clean baseline);
	// real lookups stay on-demand.
	try {
		const url = "https://api.stopforumspam.org/api?ip=1.1.1.1&json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			success?: number;
			ip?: { appears?: number; frequency?: number; asn?: number };
		};
		await storeRaw("spamrep", layer, res.status, { ok: j.success });
		await storeNormalized({
			id: `spamrep:${new Date().toISOString().slice(0, 13)}`,
			ts: new Date().toISOString(),
			source: "spamrep",
			layer,
			title: `Spam-rep heartbeat: API ok=${j.success ?? "?"} (sentinel 1.1.1.1 appears ${j.ip?.appears ?? "?"})`,
			severity: "info",
			confidence: 0.7,
			entities: {},
			meta: { appears: j.ip?.appears ?? null },
		});
		n++;
		await markHealth("spamrep", true);
	} catch (e: unknown) {
		errors.push(`spamrep: ${errMsg(e)}`);
		await markHealth("spamrep", false, errors[errors.length - 1]);
	}

	// Deribit BTC + ETH index (keyless JSON-RPC) + BTC DVOL: institutional
	// options-desk pulse next to spot tickers — index prices + DVOL OHLC.
	for (const [coin, idx] of [
		["BTC", "btc_usd"],
		["ETH", "eth_usd"],
	] as const) {
		try {
			const pxUrl = `https://www.deribit.com/api/v2/public/get_index_price?index_name=${idx}`;
			assertSafeUrl(pxUrl);
			const pxRes = await stealthFetch(pxUrl);
			if (!pxRes.ok) throw new Error(`HTTP ${pxRes.status} ${coin}`);
			const pxJ = (await pxRes.json()) as {
				result?: { index_price?: number };
			};
			const px = Number(pxJ.result?.index_price ?? NaN);
			if (!Number.isFinite(px)) throw new Error(`no index ${coin}`);
			await storeRaw("deribit", layer, pxRes.status, { coin, px });
			await storeNormalized({
				id: `deribit:${coin.toLowerCase()}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "deribit",
				layer,
				title: `Deribit ${coin} index $${px >= 1000 ? Math.round(px).toLocaleString() : Math.round(px * 100) / 100}`,
				severity: "info",
				confidence: 0.9,
				entities: {},
				meta: { coin, px: Math.round(px * 100) / 100 },
			});
			n++;
		} catch (e: unknown) {
			errors.push(`deribit/${coin}: ${errMsg(e)}`);
		}
	}
	try {
		const end = Date.now();
		const volUrl = `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${end - 3 * 864e5}&end_timestamp=${end}&resolution=1D`;
		assertSafeUrl(volUrl);
		const volRes = await stealthFetch(volUrl);
		if (!volRes.ok) throw new Error(`HTTP ${volRes.status} vol`);
		const volJ = (await volRes.json()) as {
			result?: { data?: [number, number, number, number, number][] };
		};
		const days = volJ.result?.data ?? [];
		const last = days[days.length - 1];
		const dvol = last?.[4] ?? null;
		if (dvol !== null) {
			await storeRaw("deribit-dvol", layer, volRes.status, { dvol });
			await storeNormalized({
				id: `deribitdvol:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "deribit-dvol",
				layer,
				title: `Deribit BTC DVOL ${dvol}`,
				severity: "info",
				confidence: 0.9,
				entities: {},
				meta: { dvol },
			});
			n++;
		}
		await markHealth("deribit-dvol", true);
	} catch (e: unknown) {
		errors.push(`deribit-dvol: ${errMsg(e)}`);
		await markHealth("deribit-dvol", false, errors[errors.length - 1]);
	}
	const deribitOk = !errors.some((e) => e.startsWith("deribit/"));
	await markHealth(
		"deribit",
		deribitOk,
		deribitOk ? undefined : errors.join("; "),
	);

	// Deribit BTC funding rate history (keyless JSON-RPC): latest 8h
	// funding rate — the leverage-sentiment leg next to index + DVOL.
	try {
		const end = Date.now();
		const url = `https://www.deribit.com/api/v2/public/get_funding_rate_history?instrument_name=BTC-PERPETUAL&start_timestamp=${end - 864e5}&end_timestamp=${end}`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			result?: { interest_8h?: number; index_price?: number }[];
		};
		const rows = j.result ?? [];
		const last = rows[rows.length - 1];
		const rate = last?.interest_8h ?? null;
		if (rate === null) throw new Error("no funding");
		await storeRaw("deribit-funding", layer, res.status, { rate });
		await storeNormalized({
			id: `deribitfund:${new Date().toISOString().slice(0, 13)}`,
			ts: new Date().toISOString(),
			source: "deribit-funding",
			layer,
			title: `BTC-PERP funding 8h ${(rate * 100).toFixed(4)}% (Deribit)`,
			severity: Math.abs(rate) > 0.0005 ? "watch" : "info",
			confidence: 0.9,
			entities: {},
			meta: { rate, px: last?.index_price ?? null },
		});
		n++;
		await markHealth("deribit-funding", true);
	} catch (e: unknown) {
		errors.push(`deribit-funding: ${errMsg(e)}`);
		await markHealth("deribit-funding", false, errors[errors.length - 1]);
	}

	// Coinbase spot quotes (keyless): BTC/USD+EUR+GBP direct last-trade
	// prices — the executable-price leg next to the exchange-rates table.
	// Probe-verified (BTC-USD spot 200).
	for (const [pair, label] of [
		["BTC-USD", "BTC/USD"],
		["BTC-EUR", "BTC/EUR"],
	] as const) {
		try {
			const url = `https://api.coinbase.com/v2/prices/${pair}/spot`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${pair}`);
			const j = (await res.json()) as {
				data?: { amount?: string; base?: string; currency?: string };
			};
			const px = Number(j.data?.amount ?? NaN);
			if (!Number.isFinite(px)) throw new Error(`no spot ${pair}`);
			await storeRaw("coinbase-spot", layer, res.status, { pair });
			await storeNormalized({
				id: `cbspot:${label.replace("/", "")}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "coinbase-spot",
				layer,
				title: `${label} ${px.toLocaleString("en-US")} (Coinbase spot)`,
				severity: "info",
				confidence: 0.9,
				entities: { pair: label },
				meta: { pair: label, px },
			});
			n++;
			await markHealth("coinbase-spot", true);
		} catch (e: unknown) {
			errors.push(`coinbase-spot/${pair}: ${errMsg(e)}`);
			await markHealth("coinbase-spot", false, errors[errors.length - 1]);
		}
	}

	// Llama protocol TVL spot-checks (keyless): Aave + Lido TVL$ — the
	// DeFi-bluechip leg next to the protocols-dump top-5. Probe-verified
	// (/tvl/aave 18.1B, /tvl/lido 24.2B live).
	for (const [slug, label] of [
		["aave", "Aave"],
		["lido", "Lido"],
	] as const) {
		try {
			const url = `https://api.llama.fi/tvl/${slug}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url, {}, 30000);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${slug}`);
			const tvl = Number(await res.json());
			if (!Number.isFinite(tvl) || tvl <= 0) throw new Error(`no tvl ${slug}`);
			await storeRaw("llama-tvl", layer, res.status, { slug });
			await storeNormalized({
				id: `llama:${slug}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "llama-tvl",
				layer,
				title: `DeFi ${label} TVL $${(tvl / 1e9).toFixed(1)}B (Llama)`,
				severity: "info",
				confidence: 0.8,
				entities: {},
				meta: { protocol: label, tvl },
			});
			n++;
			await markHealth("llama-tvl", true);
		} catch (e: unknown) {
			errors.push(`llama-tvl/${slug}: ${errMsg(e)}`);
			await markHealth("llama-tvl", false, errors[errors.length - 1]);
		}
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// Keyless market pulse: Polymarket Gamma (prediction leading indicators) + CoinGecko free (crypto)
// + Yahoo Finance chart API (BTC/ETH cross-check, S&P 500, gold, EURUSD — no key, UA suffices)
// + Kalshi public markets (CFTC-regulated event contracts; market-data GETs need no key).
const POLY_URL =
	"https://gamma-api.polymarket.com/events?limit=20&closed=false";
const CG_URL =
	"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true";
const KALSHI_URL =
	"https://api.elections.kalshi.com/trade-api/v2/markets?limit=30&status=open";
// Open-book is mostly sports — keep only statecraft/macro/conflict contracts.
const KALSHI_KEEP =
	/elect|president|congress|senat|house|governor|mayor|fed\b|fomc|rate cut|rate hike|cpi|inflation|gdp|recession|unemploy|tariff|trade deal|ceasefire|peace deal|war |troops|nuclear|sanction|supreme court|shutdown|debt/i;

const PolyMarket = z.object({
	question: z.string().optional(),
	outcomes: z.unknown().optional(),
	outcomePrices: z.unknown().optional(),
});
const PolyEvent = z.object({
	id: z.union([z.string(), z.number()]).optional(),
	title: z.string().optional(),
	slug: z.string().optional(),
	volume: z.union([z.string(), z.number()]).nullable().optional(),
	markets: z.array(PolyMarket).optional(),
});

export async function collect() {
	const layer = "markets";
	let n = 0;
	const errors: string[] = [];

	// Polymarket (no geo — terminal/brief surface)
	try {
		assertSafeUrl(POLY_URL);
		const res = await stealthFetch(POLY_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const raw = (await res.json()) as unknown;
		const events = z.array(PolyEvent).parse(Array.isArray(raw) ? raw : []);
		await storeRaw("polymarket", layer, res.status, { n: events.length });
		for (const e of events.slice(0, 20)) {
			const title = e.title ?? e.markets?.[0]?.question ?? "Polymarket event";
			const vol = Number(e.volume ?? 0);
			await storeNormalized({
				id: `poly:${createHash("md5")
					.update(String(e.id ?? title))
					.digest("hex")}`,
				ts: new Date().toISOString(),
				source: "polymarket",
				layer,
				title,
				url: e.slug ? `https://polymarket.com/event/${e.slug}` : undefined,
				severity: vol > 50000 ? "watch" : "info",
				confidence: 0.7,
				entities: {},
				meta: { volume: e.volume },
			});
			n++;
		}
		await markHealth("polymarket", true);
	} catch (e: unknown) {
		errors.push(`polymarket: ${errMsg(e)}`);
		await markHealth("polymarket", false, errors[errors.length - 1]);
	}

	// CoinGecko (respect free rate limits: single call, all three coins)
	try {
		assertSafeUrl(CG_URL);
		await new Promise((r) => setTimeout(r, 2000));
		const res = await stealthFetch(CG_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const prices = (await res.json()) as Record<
			string,
			{ usd?: unknown; usd_24h_change?: unknown }
		>;
		await storeRaw("coingecko", layer, res.status, prices);
		for (const [coin, p] of Object.entries(prices)) {
			const chg = Number(p.usd_24h_change ?? 0);
			await storeNormalized({
				id: `cg:${coin}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "coingecko",
				layer,
				title: `${coin} $${Number(p.usd).toLocaleString()} (${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 24h)`,
				severity: Math.abs(chg) > 5 ? "watch" : "info",
				confidence: 0.95,
				entities: {},
				meta: { coin, usd: p.usd, chg24: p.usd_24h_change },
			});
			n++;
		}
		await markHealth("coingecko", true);
	} catch (e: unknown) {
		errors.push(`coingecko: ${errMsg(e)}`);
		await markHealth("coingecko", false, errors[errors.length - 1]);
	}

	// Yahoo Finance v8 chart (keyless): index/FX/commodity pulse + crypto cross-check
	const YAHOO: { sym: string; label: string }[] = [
		{ sym: "BTC-USD", label: "BTC" },
		{ sym: "ETH-USD", label: "ETH" },
		{ sym: "%5EGSPC", label: "S&P500" },
		{ sym: "GC%3DF", label: "gold" },
		{ sym: "EURUSD%3DX", label: "EURUSD" },
		{ sym: "CL%3DF", label: "WTI" },
		{ sym: "BZ%3DF", label: "Brent" },
		{ sym: "DX-Y.NYB", label: "DXY" },
		{ sym: "AAPL", label: "AAPL" },
		{ sym: "NVDA", label: "NVDA" },
		{ sym: "SI%3DF", label: "silver" },
		{ sym: "NG%3DF", label: "natgas" },
	];
	let yahooOk = 0;
	for (const y of YAHOO) {
		try {
			const url = `https://query1.finance.yahoo.com/v8/finance/chart/${y.sym}?interval=1d&range=2d`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const j = (await res.json()) as {
				chart?: {
					result?: {
						meta?: {
							regularMarketPrice?: unknown;
							previousClose?: unknown;
							chartPreviousClose?: unknown;
							regularMarketChangePercent?: unknown;
						};
					}[];
				};
			};
			const meta = j.chart?.result?.[0]?.meta;
			const px = Number(meta?.regularMarketPrice);
			// previousClose is null on live v8 payloads (seen 2026-09-18:
			// every name printed +0.00% day). Prefer chartPreviousClose,
			// fall back to deriving from regularMarketChangePercent.
			const prevRaw =
				Number(meta?.previousClose) ||
				Number(meta?.chartPreviousClose) ||
				(Number.isFinite(Number(meta?.regularMarketChangePercent)) &&
				Number(meta?.regularMarketChangePercent)
					? px / (1 + Number(meta?.regularMarketChangePercent) / 100)
					: NaN);
			const prev = Number(prevRaw);
			if (!Number.isFinite(px)) throw new Error("no price");
			const chg =
				Number.isFinite(prev) && prev ? ((px - prev) / prev) * 100 : 0;
			await storeNormalized({
				id: `yahoo:${y.label}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "yahoo",
				layer,
				title: `${y.label} ${px.toLocaleString()} (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% day)`,
				severity: Math.abs(chg) > 3 ? "watch" : "info",
				confidence: 0.9,
				entities: {},
				meta: { sym: y.label, px, chg },
			});
			n++;
			yahooOk++;
		} catch (e: unknown) {
			errors.push(`yahoo/${y.label}: ${errMsg(e)}`);
		}
	}
	if (yahooOk > 0) await markHealth("yahoo", true);
	else
		await markHealth(
			"yahoo",
			false,
			errors.filter((e) => e.startsWith("yahoo")).join("; "),
		);

	// Kalshi: public market-data GETs need no key (trading does). Small page,
	// keyword filter, honest-empty when the book is all sports.
	try {
		assertSafeUrl(KALSHI_URL);
		const res = await stealthFetch(KALSHI_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { markets?: unknown };
		const Mk = z.object({
			ticker: z.string().optional(),
			title: z.string().optional(),
			status: z.string().optional(),
			yes_bid: z.union([z.string(), z.number()]).nullable().optional(),
			yes_ask: z.union([z.string(), z.number()]).nullable().optional(),
			volume: z.union([z.string(), z.number()]).nullable().optional(),
		});
		const mks = z
			.array(Mk)
			.parse(json.markets ?? [])
			.filter((m) => KALSHI_KEEP.test(m.title ?? ""));
		await storeRaw("kalshi", layer, res.status, { n: mks.length });
		for (const m of mks.slice(0, 10)) {
			if (!m.ticker || !m.title) continue;
			const bid = Number(m.yes_bid ?? NaN);
			const ask = Number(m.yes_ask ?? NaN);
			// Kalshi quotes cents on the dollar (43 = 43¢), not dollars.
			const mid =
				Number.isFinite(bid) && Number.isFinite(ask)
					? Math.round((bid + ask) / 2)
					: null;
			await storeNormalized({
				id: `kalshi:${m.ticker}`,
				ts: new Date().toISOString(),
				source: "kalshi",
				layer,
				title: `${m.title}${mid !== null ? ` — ${mid}¢` : ""}`,
				url: `https://kalshi.com/markets/${encodeURIComponent(m.ticker)}`,
				severity: "info",
				confidence: 0.7,
				entities: {},
				meta: { ticker: m.ticker, yesBid: m.yes_bid, yesAsk: m.yes_ask },
			});
			n++;
		}
		await markHealth("kalshi", true);
	} catch (e: unknown) {
		errors.push(`kalshi: ${errMsg(e)}`);
		await markHealth("kalshi", false, errors[errors.length - 1]);
	}

	// CoinGecko movers + trending (keyless): top-3 coin 24h board (price
	// + change + rank) + 4 trending names by market-cap rank — the mindshare
	// leg next to the simple-price BTC/ETH/SOL pulse. Probe-verified
	// (coins/markets 200, search/trending 15 coins).
	try {
		const mUrl =
			"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=3&page=1";
		assertSafeUrl(mUrl);
		await new Promise((r) => setTimeout(r, 2000));
		const mRes = await stealthFetch(mUrl);
		if (!mRes.ok) throw new Error(`HTTP ${mRes.status} cg-movers`);
		const coins = (await mRes.json()) as {
			id?: string;
			symbol?: string;
			current_price?: number;
			price_change_percentage_24h?: number;
			market_cap_rank?: number;
		}[];
		await storeRaw("cg-movers", layer, mRes.status, { n: coins.length });
		for (const c of coins.slice(0, 3)) {
			const px = Number(c.current_price ?? NaN);
			if (!c.id || !Number.isFinite(px)) continue;
			const chg = Number(c.price_change_percentage_24h ?? NaN);
			const chgTxt = Number.isFinite(chg)
				? ` (${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 24h)`
				: "";
			await storeNormalized({
				id: `cgm:${c.id}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "cg-movers",
				layer,
				title: `${(c.symbol ?? "?").toUpperCase()} $${px.toLocaleString("en-US")}${chgTxt} · rank #${c.market_cap_rank ?? "?"}`,
				severity: Number.isFinite(chg) && Math.abs(chg) > 8 ? "watch" : "info",
				confidence: 0.85,
				entities: {},
				meta: {
					coin: c.id,
					px,
					chg24: Number.isFinite(chg) ? chg : null,
					rank: c.market_cap_rank ?? null,
				},
			});
			n++;
		}
		await markHealth("cg-movers", true);
	} catch (e: unknown) {
		errors.push(`cg-movers: ${errMsg(e)}`);
		await markHealth("cg-movers", false, errors[errors.length - 1]);
	}
	try {
		const tUrl = "https://api.coingecko.com/api/v3/search/trending";
		assertSafeUrl(tUrl);
		await new Promise((r) => setTimeout(r, 2000));
		const tRes = await stealthFetch(tUrl);
		if (!tRes.ok) throw new Error(`HTTP ${tRes.status} cg-trending`);
		const tj = (await tRes.json()) as {
			coins?: {
				item?: { id?: string; symbol?: string; market_cap_rank?: number };
			}[];
		};
		const items = (tj.coins ?? []).slice(0, 4);
		await storeRaw("cg-trending", layer, tRes.status, { n: items.length });
		for (const { item } of items) {
			if (!item?.id) continue;
			await storeNormalized({
				id: `cgt:${item.id}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "cg-trending",
				layer,
				title: `Trending ${(item.symbol ?? "?").toUpperCase()} (${item.id}, rank #${item.market_cap_rank ?? "?"})`,
				severity: "info",
				confidence: 0.7,
				entities: {},
				meta: { coin: item.id, rank: item.market_cap_rank ?? null },
			});
			n++;
		}
		await markHealth("cg-trending", true);
	} catch (e: unknown) {
		errors.push(`cg-trending: ${errMsg(e)}`);
		await markHealth("cg-trending", false, errors[errors.length - 1]);
	}

	// CoinGecko global + Blockchair chain stats + gold spot: market-wide
	// context in three calls. BlockCypher/Gate.io stay as OSINT fallbacks.
	try {
		const url = "https://api.coingecko.com/api/v3/global";
		assertSafeUrl(url);
		await new Promise((r) => setTimeout(r, 2000));
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			data?: {
				total_market_cap?: Record<string, number>;
				market_cap_change_percentage_24h_usd?: number;
				btc_dominance?: number;
			};
		};
		const d = j.data ?? {};
		const mcap = d.total_market_cap?.usd;
		const chg = d.market_cap_change_percentage_24h_usd;
		await storeRaw("cg-global", layer, res.status, { mcap });
		if (typeof mcap === "number") {
			await storeNormalized({
				id: `cgglobal:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "cg-global",
				layer,
				title: `Crypto mcap $${(mcap / 1e12).toFixed(2)}T (${typeof chg === "number" ? `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 24h` : "24h"}) · BTC dom ${typeof d.btc_dominance === "number" ? `${d.btc_dominance.toFixed(1)}%` : "?"}`,
				severity:
					typeof chg === "number" && Math.abs(chg) > 5 ? "watch" : "info",
				confidence: 0.9,
				entities: {},
				meta: { mcap, chg24: chg ?? null, btcDom: d.btc_dominance ?? null },
			});
			n++;
		}
		await markHealth("cg-global", true);
	} catch (e: unknown) {
		errors.push(`cg-global: ${errMsg(e)}`);
		await markHealth("cg-global", false, errors[errors.length - 1]);
	}
	try {
		const url = "https://api.blockchair.com/bitcoin/stats";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			data?: {
				mempool_transactions?: number;
				transactions_24h?: number;
				best_block_height?: number;
				hashrate_24h?: number;
			};
		};
		const d = j.data ?? {};
		await storeRaw("blockchair", layer, res.status, { h: d.best_block_height });
		if (typeof d.best_block_height === "number") {
			await storeNormalized({
				id: `blockchair:${d.best_block_height}`,
				ts: new Date().toISOString(),
				source: "blockchair",
				layer,
				title: `BTC block ${d.best_block_height} · mempool ${Number(d.mempool_transactions ?? 0).toLocaleString()} tx · 24h ${Number(d.transactions_24h ?? 0).toLocaleString()} tx`,
				severity: "info",
				confidence: 0.9,
				entities: {},
				meta: {
					height: d.best_block_height,
					mempool: d.mempool_transactions ?? null,
					tx24: d.transactions_24h ?? null,
				},
			});
			n++;
		}
		await markHealth("blockchair", true);
	} catch (e: unknown) {
		errors.push(`blockchair: ${errMsg(e)}`);
		await markHealth("blockchair", false, errors[errors.length - 1]);
	}
	try {
		const url = "https://api.gold-api.com/price/XAU";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as { price?: unknown; updatedAt?: string };
		const px = Number(j.price ?? NaN);
		await storeRaw("goldapi", layer, res.status, { px });
		if (Number.isFinite(px)) {
			await storeNormalized({
				id: `goldapi:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: "goldapi",
				layer,
				title: `Gold $${px.toLocaleString()}/oz`,
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: { px, metal: "XAU" },
			});
			n++;
		}
		await markHealth("goldapi", true);
	} catch (e: unknown) {
		errors.push(`goldapi: ${errMsg(e)}`);
		await markHealth("goldapi", false, errors[errors.length - 1]);
	}
	// NY Fed reference rates (SOFR/EFFR): the risk-free pulse.
	try {
		const url =
			"https://markets.newyorkfed.org/api/rates/all/search.json?startDate=09/01/2026";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			refRates?: {
				type?: string;
				percentRate?: number;
				effectiveDate?: string;
			}[];
		};
		const effr = (j.refRates ?? []).find((r) => r.type === "EFFR");
		await storeRaw("nyfed", layer, res.status, { n: j.refRates?.length ?? 0 });
		if (typeof effr?.percentRate === "number") {
			await storeNormalized({
				id: `nyfed:effr:${effr.effectiveDate ?? new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "nyfed",
				layer,
				title: `EFFR ${effr.percentRate}% (${effr.effectiveDate ?? "?"})`,
				severity: "info",
				confidence: 0.95,
				entities: {},
				meta: { effr: effr.percentRate, date: effr.effectiveDate },
			});
			n++;
		}
		await markHealth("nyfed", true);
	} catch (e: unknown) {
		errors.push(`nyfed: ${errMsg(e)}`);
		await markHealth("nyfed", false, errors[errors.length - 1]);
	}
	// Treasury FiscalData: daily operating cash (TGA pulse) + avg rates.
	try {
		const url =
			"https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/deposits_withdrawals_operating_cash?filter=record_date:gte:2026-09-10&sort=-record_date&page%5Bsize%5D=1";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			data?: { record_date?: string; transaction_today_amt?: string }[];
		};
		const row = j.data?.[0];
		await storeRaw("fiscaldata", layer, res.status, { n: j.data?.length ?? 0 });
		if (row?.record_date) {
			await storeNormalized({
				id: `fiscal:${row.record_date}`,
				ts: `${row.record_date}T00:00:00Z`,
				source: "fiscaldata",
				layer,
				title: `US Treasury ops ${row.record_date}: TGA flow $${row.transaction_today_amt ?? "?"}M`,
				severity: "info",
				confidence: 0.9,
				entities: { country: "USA" },
				meta: { date: row.record_date, amt: row.transaction_today_amt },
			});
			n++;
		}
		await markHealth("fiscaldata", true);
	} catch (e: unknown) {
		errors.push(`fiscaldata: ${errMsg(e)}`);
		await markHealth("fiscaldata", false, errors[errors.length - 1]);
	}

	// MOEX IMOEX index (keyless ISS JSON): Russian equity benchmark.
	try {
		const url =
			"https://iss.moex.com/iss/engines/stock/markets/index/securities/IMOEX.json?iss.meta=off";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			marketdata?: { columns?: string[]; data?: unknown[][] };
		};
		const cols = j.marketdata?.columns ?? [];
		const row = j.marketdata?.data?.[0] ?? [];
		const cell = (name: string): number | null => {
			const v = row[cols.indexOf(name)];
			const num = Number(v);
			return Number.isFinite(num) ? num : null;
		};
		const last = cell("LASTVALUE");
		await storeRaw("moex", layer, res.status, { last });
		if (last === null) throw new Error("no IMOEX value");
		const chg = cell("LASTCHANGEPRC");
		await storeNormalized({
			id: `moex:IMOEX:${new Date().toISOString().slice(0, 13)}`,
			ts: new Date().toISOString(),
			source: "moex",
			layer,
			title: `IMOEX ${last.toLocaleString("en-US")}${chg !== null ? ` (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%)` : ""}`,
			severity: chg !== null && Math.abs(chg) > 3 ? "watch" : "info",
			confidence: 0.85,
			entities: { country: "RUS" },
			meta: { index: "IMOEX", value: last, chgPct: chg },
		});
		n++;
		await markHealth("moex", true);
	} catch (e: unknown) {
		errors.push(`moex: ${errMsg(e)}`);
		await markHealth("moex", false, errors[errors.length - 1]);
	}

	// npm weekly downloads (keyless): JS ecosystem pulse for top packages.
	try {
		const url =
			"https://api.npmjs.org/downloads/point/last-week/express,react,typescript";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as Record<
			string,
			{ downloads?: number; package?: string }
		>;
		await storeRaw("npm-dl", layer, res.status, { n: Object.keys(j).length });
		for (const [pkg, row] of Object.entries(j)) {
			const dl = Number(row.downloads ?? NaN);
			if (!Number.isFinite(dl)) continue;
			await storeNormalized({
				id: `npmdl:${pkg}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "npm-dl",
				layer,
				title: `npm ${pkg}: ${(dl / 1e6).toFixed(1)}M weekly downloads`,
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: { package: pkg, downloads: dl },
			});
			n++;
		}
		await markHealth("npm-dl", true);
	} catch (e: unknown) {
		errors.push(`npm-dl: ${errMsg(e)}`);
		await markHealth("npm-dl", false, errors[errors.length - 1]);
	}
	// crates.io trending (keyless): top recent-download crates.
	try {
		const url =
			"https://crates.io/api/v1/crates?page=1&per_page=3&sort=recent-downloads";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {
			headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			crates?: {
				name?: string;
				downloads?: number;
				recent_downloads?: number;
				newest_version?: string;
				description?: string;
			}[];
		};
		const rows = j.crates ?? [];
		await storeRaw("crates-trend", layer, res.status, { n: rows.length });
		for (const c of rows) {
			if (!c.name) continue;
			await storeNormalized({
				id: `crates:${c.name}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "crates-trend",
				layer,
				title:
					`crates ${c.name}@${c.newest_version ?? "?"} — ${Number(c.recent_downloads ?? 0).toLocaleString("en-US")} recent DL`.slice(
						0,
						300,
					),
				severity: "info",
				confidence: 0.8,
				entities: {},
				meta: { crate: c.name, version: c.newest_version ?? null },
			});
			n++;
		}
		await markHealth("crates-trend", true);
	} catch (e: unknown) {
		errors.push(`crates-trend: ${errMsg(e)}`);
		await markHealth("crates-trend", false, errors[errors.length - 1]);
	}

	// DeFi Llama top protocols (keyless): TVL leaders + 1d change.
	// 8MB full dump — parse streaming-light: pull, slice top 5 by tvl.
	try {
		const url = "https://api.llama.fi/protocols";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 60000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			name?: string;
			tvl?: number;
			chain?: string;
			change_1d?: number;
		}[];
		const top = [...rows]
			.filter((p) => typeof p.tvl === "number")
			.sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
			.slice(0, 5);
		await storeRaw("defi", layer, res.status, { n: rows.length });
		for (const p of top) {
			if (!p.name) continue;
			const chg = Number(p.change_1d ?? NaN);
			await storeNormalized({
				id: `defi:${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "defi",
				layer,
				title:
					`DeFi ${p.name} TVL $${((p.tvl ?? 0) / 1e9).toFixed(1)}B (${Number.isFinite(chg) ? `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 24h` : "24h"})`.slice(
						0,
						300,
					),
				severity: Number.isFinite(chg) && Math.abs(chg) > 10 ? "watch" : "info",
				confidence: 0.75,
				entities: {},
				meta: { protocol: p.name, tvl: p.tvl ?? null, chain: p.chain ?? null },
			});
			n++;
		}
		await markHealth("defi", true);
	} catch (e: unknown) {
		errors.push(`defi: ${errMsg(e)}`);
		await markHealth("defi", false, errors[errors.length - 1]);
	}
	// CoinGecko exchange ranking (keyless): top trusted venues by BTC volume.
	try {
		const url = "https://api.coingecko.com/api/v3/exchanges?per_page=2";
		assertSafeUrl(url);
		await new Promise((r) => setTimeout(r, 2000));
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			name?: string;
			trade_volume_24h_btc?: number;
			trust_score?: number;
		}[];
		await storeRaw("cg-exchanges", layer, res.status, { n: rows.length });
		for (const e of rows.slice(0, 2)) {
			if (!e.name) continue;
			await storeNormalized({
				id: `cgex:${e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "cg-exchanges",
				layer,
				title:
					`Venue ${e.name}: ${Number(e.trade_volume_24h_btc ?? 0).toLocaleString("en-US")} BTC/24h (trust ${e.trust_score ?? "?"})`.slice(
						0,
						300,
					),
				severity: "info",
				confidence: 0.8,
				entities: {},
				meta: { venue: e.name, volBtc: e.trade_volume_24h_btc ?? null },
			});
			n++;
		}
		await markHealth("cg-exchanges", true);
	} catch (e: unknown) {
		errors.push(`cg-exchanges: ${errMsg(e)}`);
		await markHealth("cg-exchanges", false, errors[errors.length - 1]);
	}

	// Nasdaq screener (keyless with browser UA, 7k rows): top-5 market-cap
	// heartbeat rows — the broad-equity leg next to Yahoo single names.
	try {
		const url =
			"https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=100&offset=0&download=true";
		assertSafeUrl(url);
		const res = await stealthFetch(
			url,
			{
				headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Thoth/0.1" },
			},
			30000,
		);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			data?: {
				rows?: {
					symbol?: string;
					name?: string;
					lastsale?: string;
					pctchange?: string;
					marketCap?: string;
				}[];
			};
		};
		const rows = (j.data?.rows ?? [])
			.map((r) => ({
				sym: r.symbol ?? "?",
				name: r.name ?? "?",
				px: Number((r.lastsale ?? "").replace(/[$,]/g, "")),
				chg: Number((r.pctchange ?? "").replace("%", "")),
				cap: Number(r.marketCap ?? NaN),
			}))
			.filter(
				(r) => Number.isFinite(r.cap) && r.cap > 0 && Number.isFinite(r.px),
			)
			.sort((a, b) => b.cap - a.cap)
			.slice(0, 5);
		await storeRaw("nasdaq-top", layer, res.status, { n: rows.length });
		for (const r of rows) {
			await storeNormalized({
				id: `nasdaq:${r.sym}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "nasdaq-top",
				layer,
				title: `${r.sym} $${r.px.toLocaleString()} (${r.chg >= 0 ? "+" : ""}${r.chg.toFixed(2)}%) cap $${(r.cap / 1e12).toFixed(2)}T`,
				severity: "info",
				confidence: 0.9,
				entities: {},
				meta: { symbol: r.sym, px: r.px, cap: r.cap, chg: r.chg },
			});
			n++;
		}
		await markHealth("nasdaq-top", true);
	} catch (e: unknown) {
		errors.push(`nasdaq-top: ${errMsg(e)}`);
		await markHealth("nasdaq-top", false, errors[errors.length - 1]);
	}

	// CBOE delayed indices (keyless, fincept digest 2026-09-17): VIX fear
	// gauge + US majors + EU flagships — the volatility leg next to Yahoo
	// chart pulses. Probe-verified (821 US rows, 60 EU rows). NOTE: no
	// ^DJI in this feed (DJ variants are ^DJS/^DJX) — RUT covers small-caps.
	try {
		const url =
			"https://cdn.cboe.com/api/global/delayed_quotes/quotes/all_us_indices.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			timestamp?: string;
			data?: {
				symbol?: string;
				current_price?: number;
				price_change_percent?: number;
			}[];
		};
		const rows = j.data ?? [];
		await storeRaw("cboe", layer, res.status, { n: rows.length });
		for (const sym of ["^VIX", "^SPX", "^NDX", "^RUT"]) {
			const r = rows.find((x) => x.symbol === sym);
			const px = Number(r?.current_price ?? NaN);
			if (!Number.isFinite(px)) continue;
			const chg = Number(r?.price_change_percent ?? 0);
			await storeNormalized({
				id: `cboe:${sym}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "cboe",
				layer,
				title: `CBOE ${sym} ${px.toLocaleString()} (${chg >= 0 ? "+" : ""}${Number.isFinite(chg) ? chg.toFixed(2) : "?"}%)`,
				severity:
					sym === "^VIX" && px >= 30
						? "watch"
						: sym === "^VIX" && px >= 40
							? "critical"
							: "info",
				confidence: 0.9,
				entities: {},
				meta: { symbol: sym, px, chg },
			});
			n++;
		}
		await markHealth("cboe", true);
	} catch (e: unknown) {
		errors.push(`cboe: ${errMsg(e)}`);
		await markHealth("cboe", false, errors[errors.length - 1]);
	}

	// CBOE European flagships (keyless, same host): UK100/DAX40/CAC40/
	// IBEX35/FTSEMIB/ES50 — the EU-hours leg next to US indices.
	try {
		const url =
			"https://cdn.cboe.com/api/global/european_indices/index_quotes/all-indices.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			timestamp?: string;
			data?: {
				index?: string;
				symbol?: string;
				current_price?: number;
				price_change_percent?: number;
			}[];
		};
		const rows = j.data ?? [];
		await storeRaw("cboe-eu", layer, res.status, { n: rows.length });
		for (const [code, label] of [
			["BUK100P", "UK100"],
			["BDE40P", "DAX40"],
			["BFR40P", "CAC40"],
			["BES35P", "IBEX35"],
			["BIT40P", "FTSEMIB"],
			["BDES50P", "ES50"],
		] as const) {
			const r = rows.find((x) => x.index === code);
			const px = Number(r?.current_price ?? NaN);
			if (!Number.isFinite(px)) continue;
			const chg = Number(r?.price_change_percent ?? 0);
			await storeNormalized({
				id: `cboeeu:${code}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "cboe-eu",
				layer,
				title: `CBOE ${label} ${px.toLocaleString()} (${chg >= 0 ? "+" : ""}${Number.isFinite(chg) ? chg.toFixed(2) : "?"}%)`,
				severity: "info",
				confidence: 0.9,
				entities: {},
				meta: { index: code, label, px, chg },
			});
			n++;
		}
		await markHealth("cboe-eu", true);
	} catch (e: unknown) {
		errors.push(`cboe-eu: ${errMsg(e)}`);
		await markHealth("cboe-eu", false, errors[errors.length - 1]);
	}

	// Treasury avg interest rates (keyless FiscalData, fincept digest
	// 2026-09-17): Bills/Notes/Bonds latest prints — the rates-curve leg
	// next to the TGA-flow fiscaldata leg.
	try {
		const url =
			"https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page%5Bsize%5D=10";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			data?: {
				record_date?: string;
				security_desc?: string;
				avg_interest_rate_amt?: string;
			}[];
		};
		const rows = j.data ?? [];
		await storeRaw("fiscal-rates", layer, res.status, { n: rows.length });
		const seen = new Set<string>();
		for (const r of rows) {
			const sec = r.security_desc ?? "?";
			if (!r.record_date || seen.has(sec)) continue;
			seen.add(sec);
			const rate = Number(r.avg_interest_rate_amt ?? NaN);
			if (!Number.isFinite(rate)) continue;
			if (seen.size > 4) break;
			// security_desc arrives as "Treasury Bills/Notes/Bonds" or the
			// long "Treasury Inflation-Protected Securities (TIPS)" — strip
			// the redundant "Treasury " prefix (titles rendered "US Treasury
			// Treasury Bills", seen 2026-09-18) and shorten TIPS.
			const short = sec
				.replace(/^Treasury\s+/, "")
				.replace(/^Inflation-Protected Securities.*$/i, "TIPS");
			await storeNormalized({
				id: `fiscalrate:${sec.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 30)}:${r.record_date}`,
				ts: `${r.record_date}T00:00:00Z`,
				source: "fiscal-rates",
				layer,
				title: `US ${short}: ${rate.toFixed(3)}% (${r.record_date})`,
				severity: "info",
				confidence: 0.9,
				entities: { country: "USA" },
				meta: { security: sec, rate, date: r.record_date },
			});
			n++;
		}
		await markHealth("fiscal-rates", true);
	} catch (e: unknown) {
		errors.push(`fiscal-rates: ${errMsg(e)}`);
		await markHealth("fiscal-rates", false, errors[errors.length - 1]);
	}

	// NBP Polish table A (keyless, daily PLN-base): USD/EUR/GBP/CHF mids —
	// the PLN leg next to BoC-CAD (imf) and Frankfurter-USD (fxdepth).
	try {
		const url = "https://api.nbp.pl/api/exchangerates/tables/A/?format=json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			no?: string;
			effectiveDate?: string;
			rates?: { code?: string; mid?: number }[];
		}[];
		const table = j[0];
		const byCode = new Map((table?.rates ?? []).map((r) => [r.code, r.mid]));
		await storeRaw("nbp-pln", layer, res.status, {
			no: table?.no,
			n: byCode.size,
		});
		for (const c of ["USD", "EUR", "GBP", "CHF"]) {
			const v = byCode.get(c);
			if (typeof v !== "number") continue;
			await storeNormalized({
				id: `nbppln:${c}:${table?.effectiveDate ?? new Date().toISOString().slice(0, 10)}`,
				ts: table?.effectiveDate ?? new Date().toISOString(),
				source: "nbp-pln",
				layer,
				title: `PLN/${c} ${v} (NBP ${table?.no ?? "?"})`,
				severity: "info",
				confidence: 0.95,
				entities: {},
				meta: { pair: `PLN/${c}`, rate: v, table: table?.no },
			});
			n++;
		}
		await markHealth("nbp-pln", true);
	} catch (e: unknown) {
		errors.push(`nbp-pln: ${errMsg(e)}`);
		await markHealth("nbp-pln", false, errors[errors.length - 1]);
	}

	// CBR daily XML (keyless, windows-1251): USD/EUR/CNY nominal-adjusted
	// rates — the RUB leg (comma decimals + Nominal divisor handled).
	try {
		const url = "https://www.cbr.ru/scripts/XML_daily.asp";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const buf = Buffer.from(await res.arrayBuffer());
		const xml = buf.toString("latin1");
		await storeRaw("cbr", layer, res.status, { bytes: xml.length });
		const dateM = xml.match(/Date="(\d{2}\.\d{2}\.\d{4})"/);
		const day = dateM?.[1]
			? `${dateM[1].slice(6, 10)}-${dateM[1].slice(3, 5)}-${dateM[1].slice(0, 2)}`
			: new Date().toISOString().slice(0, 10);
		for (const c of ["USD", "EUR", "CNY"]) {
			const m = xml.match(
				new RegExp(
					`<CharCode>${c}</CharCode><Nominal>(\\d+)</Nominal>.*?<Value>([\\d,]+)</Value>`,
					"s",
				),
			);
			const nom = Number(m?.[1] ?? NaN);
			const raw = (m?.[2] ?? "").replace(",", ".");
			const v = Number(raw) / nom;
			if (!m || !Number.isFinite(v)) continue;
			await storeNormalized({
				id: `cbr:${c}:${day}`,
				ts: day,
				source: "cbr",
				layer,
				title: `RUB/${c} ${Math.round(v * 10000) / 10000} (CBR ${day})`,
				severity: "info",
				confidence: 0.9,
				entities: {},
				meta: {
					pair: `RUB/${c}`,
					rate: Math.round(v * 10000) / 10000,
					date: day,
				},
			});
			n++;
		}
		await markHealth("cbr", true);
	} catch (e: unknown) {
		errors.push(`cbr: ${errMsg(e)}`);
		await markHealth("cbr", false, errors[errors.length - 1]);
	}

	// PyPI top-packages mirror (hugovk ClickHouse dump, keyless,
	// monthly): top downloads — the Python-ecosystem leg next to npm-dl.
	// (pypistats.org 429s this egress; pepy.tech needs a key — parked.)
	try {
		const url =
			"https://hugovk.github.io/top-pypi-packages/top-pypi-packages-30-days.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			rows?: { download_count?: number; project?: string }[];
		};
		const rows = (j.rows ?? []).filter(
			(r) => typeof r.download_count === "number" && r.project,
		);
		await storeRaw("pypi-dl", layer, res.status, { n: rows.length });
		for (const r of rows.slice(0, 10)) {
			const dl = r.download_count as number;
			await storeNormalized({
				id: `pypidl:${r.project}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "pypi-dl",
				layer,
				title: `PyPI ${r.project}: ${(dl / 1e9).toFixed(1)}B monthly downloads`,
				severity: "info",
				confidence: 0.8,
				entities: {},
				meta: { package: r.project, downloads: dl },
			});
			n++;
		}
		await markHealth("pypi-dl", true);
	} catch (e: unknown) {
		errors.push(`pypi-dl: ${errMsg(e)}`);
		await markHealth("pypi-dl", false, errors[errors.length - 1]);
	}

	// RubyGems rails (keyless): total + version downloads — the Ruby leg.
	try {
		const url = "https://rubygems.org/api/v1/gems/rails.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			name?: string;
			downloads?: number;
			version?: string;
			version_downloads?: number;
		};
		const total = Number(j.downloads ?? NaN);
		if (!Number.isFinite(total)) throw new Error("no downloads");
		await storeRaw("rubygems", layer, res.status, { total });
		await storeNormalized({
			id: `rubygems:rails:${new Date().toISOString().slice(0, 10)}`,
			ts: new Date().toISOString(),
			source: "rubygems",
			layer,
			title: `RubyGems rails ${(total / 1e9).toFixed(1)}B total · v${j.version ?? "?"} ${(Number(j.version_downloads ?? 0) / 1e6).toFixed(1)}M`,
			severity: "info",
			confidence: 0.85,
			entities: {},
			meta: { package: "rails", downloads: total, version: j.version ?? null },
		});
		n++;
		await markHealth("rubygems", true);
	} catch (e: unknown) {
		errors.push(`rubygems: ${errMsg(e)}`);
		await markHealth("rubygems", false, errors[errors.length - 1]);
	}

	// jsDelivr express versions (keyless): latest tags — the CDN-version
	// leg next to npm download counts.
	try {
		const url = "https://data.jsdelivr.com/v1/packages/npm/express";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			tags?: { latest?: string };
			versions?: { version?: string }[];
		};
		const latest = j.tags?.latest ?? j.versions?.[0]?.version ?? "";
		if (!latest) throw new Error("no version");
		await storeRaw("jsdelivr", layer, res.status, { latest });
		await storeNormalized({
			id: `jsdelivr:express:${latest}`,
			ts: new Date().toISOString(),
			source: "jsdelivr",
			layer,
			title: `jsDelivr express @ ${latest} (${(j.versions ?? []).length} versions)`,
			severity: "info",
			confidence: 0.8,
			entities: {},
			meta: { package: "express", version: latest },
		});
		n++;
		await markHealth("jsdelivr", true);
	} catch (e: unknown) {
		errors.push(`jsdelivr: ${errMsg(e)}`);
		await markHealth("jsdelivr", false, errors[errors.length - 1]);
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

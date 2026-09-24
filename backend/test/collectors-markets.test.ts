// Collector contract tests, markets: prediction + crypto + equities + FX + ecosystems.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as markets } from "../src/workers/collectors/markets.js";

const realFetch = globalThis.fetch;

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

function ok(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}

function stub(order: [string, (u: string) => unknown][]) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [key, fn] of order) if (u.includes(key)) return fn(u);
		return new Response("no mock", { status: 500 });
	}) as typeof fetch;
}

function stubRe(
	routes: [RegExp, { status?: number; json?: unknown; text?: string }][],
) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [re, r] of routes) {
			if (re.test(u)) {
				if (r.json !== undefined)
					return new Response(JSON.stringify(r.json), {
						status: r.status ?? 200,
					});
				return new Response(r.text ?? "", { status: r.status ?? 200 });
			}
		}
		return new Response("no mock", { status: 500 });
	}) as typeof fetch;
}

describe("markets collect()", () => {
	it("polymarket + coingecko + yahoo combine", async () => {
		stubRe([
			[
				/gamma-api\.polymarket\.com/,
				{
					json: [
						{
							id: 1,
							title: "Test market",
							slug: "t",
							volume: 100,
							markets: [],
						},
					],
				},
			],
			[
				/api\.coingecko\.com\/api\/v3\/simple/,
				{ json: { bitcoin: { usd: 50000, usd_24h_change: 1.2 } } },
			],
			[
				/query1\.finance\.yahoo\.com/,
				{
					json: {
						chart: {
							result: [
								{ meta: { regularMarketPrice: 100, previousClose: 99 } },
							],
						},
					},
				},
			],
		]);
		const r = await markets();
		assert.equal(r.ok, true);
		assert.ok((r.count ?? 0) >= 1 + 1 + 8, `all three rungs ${r.count}`);
	});
});

describe("kalshi", () => {
	it("keeps statecraft contracts, drops sports", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.elections.kalshi.com"))
				return new Response(
					JSON.stringify({
						markets: [
							{
								ticker: "KXPRES-26",
								title: "Presidential election winner 2028?",
								status: "open",
								yes_bid: 43,
								yes_ask: 45,
							},
							{
								ticker: "KXSPORT-1",
								title: "yes Toronto wins by over 3.5 runs",
								status: "open",
								yes_bid: 60,
								yes_ask: 62,
							},
							{ ticker: "", title: "Untitled" },
						],
					}),
					{ status: 200 },
				);
			if (u.includes("polymarket.com"))
				return new Response(JSON.stringify([]), { status: 200 });
			if (u.includes("coingecko.com/api/v3/simple"))
				return new Response(JSON.stringify({}), { status: 200 });
			if (u.includes("coingecko.com/api/v3/coins/markets"))
				return new Response(JSON.stringify([]), { status: 500 });
			if (u.includes("coingecko.com/api/v3/search/trending"))
				return new Response(JSON.stringify({ coins: [] }), { status: 500 });
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await markets();
		assert.equal(r.ok, true);
		assert.equal((r as { count?: number }).count, 1);
		const rows = await query<{ id: string; title: string }>(
			"SELECT id, title FROM events WHERE source='kalshi'",
		);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].id, "kalshi:KXPRES-26");
		assert.match(rows[0].title, /44¢/);
	});
});

describe("markets depth22", () => {
	it("cg-global + blockchair + nyfed + fiscal store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("polymarket")) return ok([], 500);
			if (u.includes("coingecko.com/api/v3/simple")) return ok({}, 500);
			if (u.includes("coingecko.com/api/v3/coins/markets")) return ok([], 500);
			if (u.includes("coingecko.com/api/v3/search/trending"))
				return ok({ coins: [] }, 500);
			if (u.includes("finance.yahoo.com")) return ok({}, 500);
			if (u.includes("kalshi")) return ok({ markets: [] }, 500);
			if (u.includes("coingecko.com/api/v3/global"))
				return ok({
					data: {
						total_market_cap: { usd: 2.5e12 },
						market_cap_change_percentage_24h_usd: 1.2,
						btc_dominance: 55.1,
					},
				});
			if (u.includes("blockchair.com"))
				return ok({
					data: {
						best_block_height: 967213,
						mempool_transactions: 4845,
						transactions_24h: 797159,
					},
				});
			if (u.includes("newyorkfed.org"))
				return ok({
					refRates: [
						{ type: "EFFR", percentRate: 3.63, effectiveDate: "2026-09-14" },
					],
				});
			if (u.includes("avg_interest_rates")) return ok({ data: [] }, 500);
			if (u.includes("fiscaldata.treasury.gov"))
				return ok({
					data: [{ record_date: "2026-09-14", transaction_today_amt: "7" }],
				});
			if (u.includes("cdn.cboe.com/api/global/delayed_quotes"))
				return ok({ timestamp: "x", data: [] }, 500);
			if (u.includes("cdn.cboe.com/api/global/european_indices"))
				return ok({ timestamp: "x", data: [] }, 500);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await markets();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('cg-global','blockchair','nyfed','fiscaldata')",
		);
		assert.equal(rows.length, 4);
	});
});

describe("markets moex", () => {
	it("moex stores IMOEX row", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("polymarket")) return ok([], 500);
			if (u.includes("coingecko.com/api/v3/simple")) return ok({}, 500);
			if (u.includes("coingecko.com/api/v3/coins/markets")) return ok([], 500);
			if (u.includes("coingecko.com/api/v3/search/trending"))
				return ok({ coins: [] }, 500);
			if (u.includes("finance.yahoo.com")) return ok({}, 500);
			if (u.includes("kalshi")) return ok({ markets: [] }, 500);
			if (u.includes("coingecko.com/api/v3/global")) return ok({}, 500);
			if (u.includes("blockchair.com")) return ok({}, 500);
			if (u.includes("newyorkfed.org")) return ok({ refRates: [] }, 500);
			if (u.includes("avg_interest_rates")) return ok({ data: [] }, 500);
			if (u.includes("fiscaldata.treasury.gov")) return ok({ data: [] }, 500);
			if (u.includes("iss.moex.com"))
				return ok({
					marketdata: {
						columns: ["SECID", "LASTVALUE", "LASTCHANGEPRC"],
						data: [["IMOEX", 2361.08, -1.02]],
					},
				});
			if (u.includes("cdn.cboe.com/api/global/delayed_quotes"))
				return ok({ timestamp: "x", data: [] }, 500);
			if (u.includes("cdn.cboe.com/api/global/european_indices"))
				return ok({ timestamp: "x", data: [] }, 500);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await markets();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='moex'",
		);
		assert.equal(rows.length, 1);
	});
});

describe("markets npm/crates (first sample, 2 rows)", () => {
	it("npm-dl + crates-trend store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("polymarket")) return ok([], 500);
			if (u.includes("coingecko.com/api/v3/simple")) return ok({}, 500);
			if (u.includes("coingecko.com/api/v3/coins/markets")) return ok([], 500);
			if (u.includes("coingecko.com/api/v3/search/trending"))
				return ok({ coins: [] }, 500);
			if (u.includes("finance.yahoo.com")) return ok({}, 500);
			if (u.includes("kalshi")) return ok({ markets: [] }, 500);
			if (u.includes("coingecko.com/api/v3/global")) return ok({}, 500);
			if (u.includes("blockchair.com")) return ok({}, 500);
			if (u.includes("newyorkfed.org")) return ok({ refRates: [] }, 500);
			if (u.includes("avg_interest_rates")) return ok({ data: [] }, 500);
			if (u.includes("fiscaldata.treasury.gov")) return ok({ data: [] }, 500);
			if (u.includes("iss.moex.com")) return ok({ marketdata: {} }, 500);
			if (u.includes("api.npmjs.org"))
				return ok({ express: { downloads: 97784379, package: "express" } });
			if (u.includes("crates.io/api/v1/crates"))
				return ok({
					crates: [
						{
							name: "hashbrown",
							downloads: 2439922011,
							recent_downloads: 650324637,
							newest_version: "0.17.1",
						},
					],
				});
			if (u.includes("cdn.cboe.com/api/global/delayed_quotes"))
				return ok({ timestamp: "x", data: [] }, 500);
			if (u.includes("cdn.cboe.com/api/global/european_indices"))
				return ok({ timestamp: "x", data: [] }, 500);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await markets();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('npm-dl','crates-trend')",
		);
		assert.equal(rows.length, 2);
	});
});

describe("markets npm/crates (wider sample, 4 rows)", () => {
	it("npm-dl + crates-trend store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("polymarket")) return ok([], 500);
			if (u.includes("coingecko.com/api/v3/simple")) return ok({}, 500);
			if (u.includes("coingecko.com/api/v3/coins/markets")) return ok([], 500);
			if (u.includes("coingecko.com/api/v3/search/trending"))
				return ok({ coins: [] }, 500);
			if (u.includes("finance.yahoo.com")) return ok({}, 500);
			if (u.includes("kalshi")) return ok({ markets: [] }, 500);
			if (u.includes("coingecko.com/api/v3/global")) return ok({}, 500);
			if (u.includes("blockchair.com")) return ok({}, 500);
			if (u.includes("newyorkfed.org")) return ok({ refRates: [] }, 500);
			if (u.includes("avg_interest_rates")) return ok({ data: [] }, 500);
			if (u.includes("fiscaldata.treasury.gov")) return ok({ data: [] }, 500);
			if (u.includes("iss.moex.com")) return ok({ marketdata: {} }, 500);
			if (u.includes("api.npmjs.org"))
				return ok({
					express: { downloads: 97784379, package: "express" },
					react: { downloads: 128119130, package: "react" },
					typescript: { downloads: 203362610, package: "typescript" },
				});
			if (u.includes("crates.io/api/v1/crates"))
				return ok({
					crates: [
						{
							name: "hashbrown",
							downloads: 2439922011,
							recent_downloads: 650324637,
							newest_version: "0.17.1",
						},
					],
				});
			if (u.includes("cdn.cboe.com/api/global/delayed_quotes"))
				return ok({ timestamp: "x", data: [] }, 500);
			if (u.includes("cdn.cboe.com/api/global/european_indices"))
				return ok({ timestamp: "x", data: [] }, 500);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await markets();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('npm-dl','crates-trend')",
		);
		assert.equal(rows.length, 4);
	});
});

describe("markets defi/exchanges", () => {
	it("defi + cg-exchanges store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("polymarket")) return ok([], 500);
			if (u.includes("coingecko.com/api/v3/simple")) return ok({}, 500);
			if (u.includes("coingecko.com/api/v3/coins/markets")) return ok([], 500);
			if (u.includes("coingecko.com/api/v3/search/trending"))
				return ok({ coins: [] }, 500);
			if (u.includes("finance.yahoo.com")) return ok({}, 500);
			if (u.includes("kalshi")) return ok({ markets: [] }, 500);
			if (u.includes("coingecko.com/api/v3/global")) return ok({}, 500);
			if (u.includes("blockchair.com")) return ok({}, 500);
			if (u.includes("newyorkfed.org")) return ok({ refRates: [] }, 500);
			if (u.includes("avg_interest_rates")) return ok({ data: [] }, 500);
			if (u.includes("fiscaldata.treasury.gov")) return ok({ data: [] }, 500);
			if (u.includes("iss.moex.com")) return ok({ marketdata: {} }, 500);
			if (u.includes("api.npmjs.org")) return ok({}, 500);
			if (u.includes("crates.io/api/v1/crates")) return ok({ crates: [] }, 500);
			if (u.includes("api.llama.fi"))
				return ok([
					{
						name: "Binance CEX",
						tvl: 163712396544.76,
						chain: "Multi-Chain",
						change_1d: -1.79,
					},
				]);
			if (u.includes("api.coingecko.com/api/v3/exchanges"))
				return ok([
					{ name: "Binance", trade_volume_24h_btc: 149068.08, trust_score: 10 },
				]);
			if (u.includes("cdn.cboe.com/api/global/delayed_quotes"))
				return ok({ timestamp: "x", data: [] }, 500);
			if (u.includes("cdn.cboe.com/api/global/european_indices"))
				return ok({ timestamp: "x", data: [] }, 500);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await markets();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('defi','cg-exchanges')",
		);
		assert.equal(rows.length, 2);
	});
});

describe("markets nbp-pln + cbr", () => {
	it("stores PLN and RUB legs", async () => {
		stub([
			["gamma-api.polymarket.com", () => ok([], 500)],
			["api.coingecko.com/api/v3/simple", () => ok({}, 500)],
			["api.coingecko.com/api/v3/coins/markets", () => ok([], 500)],
			[
				"api.coingecko.com/api/v3/search/trending",
				() => ok({ coins: [] }, 500),
			],
			["query1.finance.yahoo.com", () => ok({}, 500)],
			["api.elections.kalshi.com", () => ok({ markets: [] }, 500)],
			["api.coingecko.com/api/v3/global", () => ok({}, 500)],
			["api.blockchair.com", () => ok({}, 500)],
			["markets.newyorkfed.org", () => ok({ rates: {} }, 500)],
			["avg_interest_rates", () => ok({ data: [] }, 500)],
			["fiscaldata.treasury.gov", () => ok({ data: [] }, 500)],
			[
				"cdn.cboe.com/api/global/delayed_quotes",
				() => ok({ timestamp: "x", data: [] }, 500),
			],
			[
				"cdn.cboe.com/api/global/european_indices",
				() => ok({ timestamp: "x", data: [] }, 500),
			],
			["iss.moex.com", () => ok({ marketdata: {} }, 500)],
			["api.npmjs.org", () => ok({}, 500)],
			["crates.io", () => ok({ crates: [] }, 500)],
			["api.llama.fi", () => ok([], 500)],
			["api.coingecko.com/api/v3/exchanges", () => ok([], 500)],
			[
				"api.nbp.pl",
				() =>
					ok([
						{
							no: "180/A/NBP/2026",
							effectiveDate: "2026-09-16",
							rates: [
								{ code: "USD", mid: 3.7639 },
								{ code: "EUR", mid: 4.3435 },
								{ code: "GBP", mid: 5.0703 },
								{ code: "CHF", mid: 4.5968 },
							],
						},
					]),
			],
			[
				"cbr.ru",
				() =>
					ok(
						'<?xml version="1.0"?><ValCurs Date="16.09.2026"><Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>84,1234</Value></Valute><Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>91,5678</Value></Valute><Valute><CharCode>CNY</CharCode><Nominal>10</Nominal><Value>115,4321</Value></Valute></ValCurs>',
					),
			],
		]);
		const r = await markets();
		assert.equal(r.ok, true);
		const pln = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='nbp-pln' ORDER BY id",
		);
		assert.equal(pln.length, 4);
		const cbr = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='cbr' ORDER BY id",
		);
		assert.equal(cbr.length, 3);
		assert.ok(cbr[2].id.startsWith("cbr:USD:2026-09-16"));
	});
});

describe("markets pypi + rubygems + jsdelivr", () => {
	it("stores ecosystem rows", async () => {
		stub([
			["gamma-api.polymarket.com", () => ok([], 500)],
			["api.coingecko.com/api/v3/simple", () => ok({}, 500)],
			["api.coingecko.com/api/v3/coins/markets", () => ok([], 500)],
			[
				"api.coingecko.com/api/v3/search/trending",
				() => ok({ coins: [] }, 500),
			],
			["query1.finance.yahoo.com", () => ok({}, 500)],
			["api.elections.kalshi.com", () => ok({ markets: [] }, 500)],
			["api.coingecko.com/api/v3/global", () => ok({}, 500)],
			["api.blockchair.com", () => ok({}, 500)],
			["markets.newyorkfed.org", () => ok({ rates: {} }, 500)],
			["avg_interest_rates", () => ok({ data: [] }, 500)],
			["fiscaldata.treasury.gov", () => ok({ data: [] }, 500)],
			[
				"cdn.cboe.com/api/global/delayed_quotes",
				() => ok({ timestamp: "x", data: [] }, 500),
			],
			[
				"cdn.cboe.com/api/global/european_indices",
				() => ok({ timestamp: "x", data: [] }, 500),
			],
			["iss.moex.com", () => ok({ marketdata: {} }, 500)],
			["api.npmjs.org", () => ok({}, 500)],
			["crates.io", () => ok({ crates: [] }, 500)],
			["api.llama.fi", () => ok([], 500)],
			["api.coingecko.com/api/v3/exchanges", () => ok([], 500)],
			["api.nbp.pl", () => ok([], 500)],
			["cbr.ru", () => ok("", 500)],
			[
				"hugovk.github.io",
				() =>
					ok({
						rows: [
							{ download_count: 3206668324, project: "boto3" },
							{ download_count: 100, project: "tiny" },
						],
					}),
			],
			[
				"rubygems.org",
				() =>
					ok({
						name: "rails",
						downloads: 788437845,
						version: "8.1.3.1",
						version_downloads: 7699797,
					}),
			],
			[
				"data.jsdelivr.com",
				() =>
					ok({
						tags: { latest: "5.2.1" },
						versions: [{ version: "5.2.1" }, { version: "5.0.0" }],
					}),
			],
		]);
		const r = await markets();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('pypi-dl','rubygems','jsdelivr') ORDER BY id",
		);
		assert.equal(rows.length, 4); // 2 pypi + rails + express
		assert.ok(rows[0].id.startsWith("jsdelivr:express:5.2.1"));
	});
});

describe("markets nasdaq-top", () => {
	it("stores top-5 market-cap rows", async () => {
		stub([
			["gamma-api.polymarket.com", () => ok([], 500)],
			["api.coingecko.com/api/v3/simple", () => ok({}, 500)],
			["api.coingecko.com/api/v3/coins/markets", () => ok([], 500)],
			[
				"api.coingecko.com/api/v3/search/trending",
				() => ok({ coins: [] }, 500),
			],
			["query1.finance.yahoo.com", () => ok({}, 500)],
			["api.elections.kalshi.com", () => ok({ markets: [] }, 500)],
			["api.coingecko.com/api/v3/global", () => ok({}, 500)],
			["api.blockchair.com", () => ok({}, 500)],
			["markets.newyorkfed.org", () => ok({ rates: {} }, 500)],
			["avg_interest_rates", () => ok({ data: [] }, 500)],
			["fiscaldata.treasury.gov", () => ok({ data: [] }, 500)],
			[
				"cdn.cboe.com/api/global/delayed_quotes",
				() => ok({ timestamp: "x", data: [] }, 500),
			],
			[
				"cdn.cboe.com/api/global/european_indices",
				() => ok({ timestamp: "x", data: [] }, 500),
			],
			["iss.moex.com", () => ok({ marketdata: {} }, 500)],
			["api.npmjs.org", () => ok({}, 500)],
			["crates.io", () => ok({ crates: [] }, 500)],
			["api.llama.fi", () => ok([], 500)],
			["api.coingecko.com/api/v3/exchanges", () => ok([], 500)],
			["api.nbp.pl", () => ok([], 500)],
			["cbr.ru", () => ok("", 500)],
			["hugovk.github.io", () => ok({ rows: [] }, 500)],
			["rubygems.org", () => ok({}, 500)],
			["data.jsdelivr.com", () => ok({}, 500)],
			[
				"api.nasdaq.com",
				() =>
					ok({
						data: {
							rows: [
								{
									symbol: "NVDA",
									name: "NVIDIA",
									lastsale: "$214.10",
									pctchange: "0.91%",
									marketCap: "5160000000000.00",
								},
								{
									symbol: "AAPL",
									name: "Apple",
									lastsale: "$331.98",
									pctchange: "0.19%",
									marketCap: "4840000000000.00",
								},
								{
									symbol: "X",
									name: "Bad",
									lastsale: "n/a",
									pctchange: "n/a",
									marketCap: "",
								},
							],
						},
					}),
			],
		]);
		const r = await markets();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='nasdaq-top' ORDER BY id",
		);
		assert.equal(rows.length, 2); // bad row filtered
		assert.ok(rows[0].id.startsWith("nasdaq:AAPL:"));
	});
});

describe("markets cboe + fiscal-rates", () => {
	it("stores VIX/majors, EU flagships, Treasury rates", async () => {
		stub([
			["gamma-api.polymarket.com", () => ok([], 500)],
			["api.coingecko.com/api/v3/simple", () => ok({}, 500)],
			["api.coingecko.com/api/v3/coins/markets", () => ok([], 500)],
			[
				"api.coingecko.com/api/v3/search/trending",
				() => ok({ coins: [] }, 500),
			],
			["query1.finance.yahoo.com", () => ok({}, 500)],
			["api.elections.kalshi.com", () => ok({ markets: [] }, 500)],
			["api.coingecko.com/api/v3/global", () => ok({}, 500)],
			["api.blockchair.com", () => ok({}, 500)],
			["markets.newyorkfed.org", () => ok({ rates: {} }, 500)],
			[
				"fiscaldata.treasury.gov/services/api/fiscal_service/v1",
				() => ok({ data: [] }, 500),
			],
			["iss.moex.com", () => ok({ marketdata: {} }, 500)],
			["api.npmjs.org", () => ok({}, 500)],
			["crates.io", () => ok({ crates: [] }, 500)],
			["api.llama.fi", () => ok([], 500)],
			["api.coingecko.com/api/v3/exchanges", () => ok([], 500)],
			["api.nbp.pl", () => ok([], 500)],
			["cbr.ru", () => ok("", 500)],
			["hugovk.github.io", () => ok({ rows: [] }, 500)],
			["rubygems.org", () => ok({}, 500)],
			["data.jsdelivr.com", () => ok({}, 500)],
			["api.nasdaq.com", () => ok({ data: {} }, 500)],
			[
				"cdn.cboe.com/api/global/delayed_quotes",
				() =>
					ok({
						timestamp: "2026-09-17 12:08:20",
						data: [
							{
								symbol: "^VIX",
								current_price: 15.92,
								price_change_percent: -10.1,
							},
							{
								symbol: "^SPX",
								current_price: 7551.81,
								price_change_percent: -0.45,
							},
							{
								symbol: "^NDX",
								current_price: 28945.06,
								price_change_percent: 0.03,
							},
							{
								symbol: "^RUT",
								current_price: 2858.81,
								price_change_percent: -0.4,
							},
						],
					}),
			],
			[
				"cdn.cboe.com/api/global/european_indices",
				() =>
					ok({
						timestamp: "16:59:54",
						data: [
							{
								index: "BUK100P",
								symbol: "^BUK100P-SL",
								current_price: 1075.98,
								price_change_percent: 1.16,
							},
							{
								index: "BDE40P",
								symbol: "^BDE40P-SL",
								current_price: 897.62,
								price_change_percent: 0.72,
							},
						],
					}),
			],
			[
				"avg_interest_rates",
				() =>
					ok({
						data: [
							{
								record_date: "2026-08-31",
								security_desc: "Treasury Bills",
								avg_interest_rate_amt: "3.788",
							},
							{
								record_date: "2026-08-31",
								security_desc: "Treasury Notes",
								avg_interest_rate_amt: "3.345",
							},
						],
					}),
			],
		]);
		const r = await markets();
		assert.equal(r.ok, true);
		const us = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='cboe' ORDER BY id",
		);
		assert.equal(us.length, 4);
		assert.ok(us.some((x) => x.id.startsWith("cboe:^VIX:")));
		const eu = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='cboe-eu' ORDER BY id",
		);
		assert.equal(eu.length, 2);
		const rt = await query<{ id: string; title: string }>(
			"SELECT id, title FROM events WHERE source='fiscal-rates' ORDER BY id",
		);
		assert.equal(rt.length, 2);
		assert.ok(
			rt.every((x) => !x.title.includes("Treasury Treasury")),
			"no doubled Treasury prefix",
		);
		assert.ok(rt.some((x) => x.title.startsWith("US Bills:")));
		assert.ok(rt.some((x) => x.title.startsWith("US Notes:")));
	});
});

describe("markets cg-movers/trending", () => {
	it("movers board + trending names store rows", async () => {
		stub([
			["gamma-api.polymarket.com", () => ok([], 500)],
			["api.coingecko.com/api/v3/simple", () => ok({}, 500)],
			[
				"api.coingecko.com/api/v3/coins/markets",
				() =>
					ok([
						{
							id: "bitcoin",
							symbol: "btc",
							current_price: 77707,
							price_change_percentage_24h: 1.74,
							market_cap_rank: 1,
						},
						{
							id: "ethereum",
							symbol: "eth",
							current_price: 2486.42,
							price_change_percentage_24h: 1.97,
							market_cap_rank: 2,
						},
					]),
			],
			[
				"api.coingecko.com/api/v3/search/trending",
				() =>
					ok({
						coins: [
							{ item: { id: "near", symbol: "NEAR", market_cap_rank: 25 } },
							{ item: { id: "uniswap", symbol: "UNI", market_cap_rank: 21 } },
						],
					}),
			],
			["query1.finance.yahoo.com", () => ok({}, 500)],
			["api.elections.kalshi.com", () => ok({ markets: [] }, 500)],
			["api.coingecko.com/api/v3/global", () => ok({}, 500)],
			["api.blockchair.com", () => ok({}, 500)],
			["markets.newyorkfed.org", () => ok({ rates: {} }, 500)],
			["avg_interest_rates", () => ok({ data: [] }, 500)],
			["fiscaldata.treasury.gov", () => ok({ data: [] }, 500)],
			["iss.moex.com", () => ok({ marketdata: {} }, 500)],
			["api.npmjs.org", () => ok({}, 500)],
			["crates.io", () => ok({ crates: [] }, 500)],
			["api.llama.fi", () => ok([], 500)],
			["api.coingecko.com/api/v3/exchanges", () => ok([], 500)],
			["api.nasdaq.com", () => ok({ data: {} }, 500)],
			[
				"cdn.cboe.com/api/global/delayed_quotes",
				() => ok({ timestamp: "x", data: [] }, 500),
			],
			[
				"cdn.cboe.com/api/global/european_indices",
				() => ok({ timestamp: "x", data: [] }, 500),
			],
		]);
		const r = await markets();
		assert.equal(r.ok, true);
		const mv = await query<{ id: string; title: string }>(
			"SELECT id, title FROM events WHERE source='cg-movers' ORDER BY id",
		);
		assert.equal(mv.length, 2);
		assert.ok(mv.some((x) => x.title.includes("BTC $77,707")));
		const tr = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='cg-trending' ORDER BY id",
		);
		assert.equal(tr.length, 2);
		assert.ok(tr.some((x) => x.id.startsWith("cgt:near:")));
	});
});

describe("markets yahoo prev-close fallback", () => {
	it("uses chartPreviousClose when previousClose is null", async () => {
		stub([
			["gamma-api.polymarket.com", () => ok([], 500)],
			["api.coingecko.com/api/v3/simple", () => ok({}, 500)],
			["api.coingecko.com/api/v3/coins/markets", () => ok([], 500)],
			[
				"api.coingecko.com/api/v3/search/trending",
				() => ok({ coins: [] }, 500),
			],
			[
				"query1.finance.yahoo.com",
				() =>
					ok({
						chart: {
							result: [
								{
									meta: {
										regularMarketPrice: 337.0,
										previousClose: null,
										chartPreviousClose: 331.34,
										regularMarketChangePercent: 1.381,
									},
								},
							],
						},
					}),
			],
			["api.elections.kalshi.com", () => ok({ markets: [] }, 500)],
			["api.coingecko.com/api/v3/global", () => ok({}, 500)],
			["api.blockchair.com", () => ok({}, 500)],
			["markets.newyorkfed.org", () => ok({ rates: {} }, 500)],
			["avg_interest_rates", () => ok({ data: [] }, 500)],
			["fiscaldata.treasury.gov", () => ok({ data: [] }, 500)],
			["iss.moex.com", () => ok({ marketdata: {} }, 500)],
			["api.npmjs.org", () => ok({}, 500)],
			["crates.io", () => ok({ crates: [] }, 500)],
			["api.llama.fi", () => ok([], 500)],
			["api.coingecko.com/api/v3/exchanges", () => ok([], 500)],
			["api.nasdaq.com", () => ok({ data: {} }, 500)],
			[
				"cdn.cboe.com/api/global/delayed_quotes",
				() => ok({ timestamp: "x", data: [] }, 500),
			],
			[
				"cdn.cboe.com/api/global/european_indices",
				() => ok({ timestamp: "x", data: [] }, 500),
			],
		]);
		const r = await markets();
		assert.equal(r.ok, true);
		const rows = await query<{ title: string }>(
			"SELECT title FROM events WHERE source='yahoo' ORDER BY id LIMIT 1",
		);
		assert.ok(rows.length >= 1);
		assert.match(rows[0].title, /\+1\.7\d% day/);
	});
});

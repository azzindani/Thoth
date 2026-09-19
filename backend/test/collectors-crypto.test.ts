// Collector contract tests, crypto: exchanges + Deribit. Consolidated from collectors-batch20/25 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as crypto } from "../src/workers/collectors/crypto.js";

const realFetch = globalThis.fetch;
function ok(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("crypto", () => {
	it("collect() stores binance + coinbase rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.binance.com"))
				return new Response(
					JSON.stringify({
						symbol: "BTCUSDT",
						lastPrice: "76863.55",
						priceChangePercent: "-1.1",
						highPrice: "79600",
						lowPrice: "76703",
						volume: "14671",
					}),
					{ status: 200 },
				);
			if (u.includes("api.coinbase.com"))
				return new Response(
					JSON.stringify({
						data: {
							currency: "BTC",
							rates: { USD: "76800", EUR: "66500" },
						},
					}),
					{ status: 200 },
				);
			if (u.includes("api.llama.fi")) return ok({}, 500);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await crypto();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source IN ('binance','coinbase')",
		);
		assert.ok(rows.length >= 4, `crypto rows, got ${rows.length}`);
	});
});

describe("crypto spot/llama", () => {
	it("coinbase-spot + llama-tvl store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.binance.com")) return ok({}, 500);
			if (u.includes("kraken.com")) return ok({}, 500);
			if (u.includes("bitstamp.net")) return ok({}, 500);
			if (u.includes("mempool.space")) return ok("", 500);
			if (u.includes("api.coinbase.com/v2/exchange-rates")) return ok({}, 500);
			if (u.includes("api.coinbase.com/v2/prices/BTC-USD/spot"))
				return ok({
					data: { amount: "77802.0", base: "BTC", currency: "USD" },
				});
			if (u.includes("api.coinbase.com/v2/prices/BTC-EUR/spot"))
				return ok({
					data: { amount: "67200.5", base: "BTC", currency: "EUR" },
				});
			if (u.includes("api.llama.fi/tvl/aave")) return ok(18121957529.4);
			if (u.includes("api.llama.fi/tvl/lido")) return ok(24224986207.2);
			if (u.includes("gateio.ws")) return ok([], 500);
			if (u.includes("stopforumspam.org")) return ok({}, 500);
			if (u.includes("deribit.com")) return ok({}, 500);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await crypto();
		assert.equal(r.ok, true);
		const spot = await query<{ id: string; title: string }[]>(
			"SELECT id, title FROM events WHERE source='coinbase-spot'",
		);
		assert.equal(spot.length, 2);
		assert.ok(spot.some((x) => x.id.startsWith("cbspot:BTCUSD:")));
		const tvl = await query<{ id: string; title: string }[]>(
			"SELECT id, title FROM events WHERE source='llama-tvl'",
		);
		assert.equal(tvl.length, 2);
		assert.ok(tvl.some((x) => x.title.includes("Aave TVL $18.1B")));
		assert.ok(tvl.some((x) => x.title.includes("Lido TVL $24.2B")));
	});
});

describe("crypto gateio/spamrep", () => {
	it("gateio + spamrep store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("binance.com")) return ok({}, 500);
			if (u.includes("kraken.com")) return ok({}, 500);
			if (u.includes("bitstamp.net")) return ok({}, 500);
			if (u.includes("mempool.space")) return ok("", 500);
			if (u.includes("api.coinbase.com")) return ok({}, 500);
			if (u.includes("api.llama.fi")) return ok({}, 500);
			if (u.includes("gateio.ws"))
				return ok([
					{
						last: "75913.2",
						change_percentage: "-2.35",
						high_24h: "77741",
						low_24h: "74965",
					},
				]);
			if (u.includes("stopforumspam.org"))
				return ok({ success: 1, ip: { appears: 0 } });
			return ok({}, 500);
		}) as typeof fetch;
		const r = await crypto();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source IN ('gateio','spamrep')",
		);
		assert.equal(rows.length, 4);
	});
});

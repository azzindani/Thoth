// Collector contract tests, fxdepth: ECB/NBP/paprika/bitfinex. Consolidated from collectors-batch20 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	collect as fxdepth,
	parseEcb,
} from "../src/workers/collectors/fxdepth.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("fxdepth", () => {
	it("parseEcb reads the cube", () => {
		const { day, rates } = parseEcb(
			`<Cube><Cube time='2026-09-14'><Cube currency='USD' rate='1.1551'/><Cube currency='GBP' rate='0.85598'/></Cube></Cube>`,
		);
		assert.equal(day, "2026-09-14");
		assert.equal(rates.USD, 1.1551);
	});
	it("bitfinex reads LAST_PRICE and rel-change ratio", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			// v2 ticker array: [SYM, BID, BID_SIZE, ASK, ASK_SIZE,
			// DAILY_CHANGE, DAILY_CHANGE_REL, LAST_PRICE, ...]
			if (u.includes("api-pub.bitfinex.com")) {
				const eth = u.includes("symbols=tETHUSD");
				return new Response(
					JSON.stringify([
						eth
							? [
									"tETHUSD",
									2448,
									1,
									2449,
									1,
									30,
									0.013,
									2452.5,
									50000,
									2484,
									2417,
								]
							: [
									"tBTCUSD",
									76400,
									1,
									76410,
									1,
									1500,
									0.02,
									76500,
									1000,
									77000,
									75000,
								],
					]),
					{ status: 200 },
				);
			}
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await fxdepth();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; title: string }>(
			"SELECT id, title FROM events WHERE source='bitfinex' ORDER BY id",
		);
		assert.equal(rows.length, 2);
		assert.match(
			rows.find((x) => x.id.startsWith("bitfinex:BTC"))?.title ?? "",
			/BTC \$76,500.*\+2\.0% 24h.*Bitfinex/,
		);
		assert.match(
			rows.find((x) => x.id.startsWith("bitfinex:ETH"))?.title ?? "",
			/ETH \$2,452\.5.*\+1\.3% 24h.*Bitfinex/,
		);
	});
	it("ecb and nbp ids are source-namespaced", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("ecb.europa.eu"))
				return new Response(
					`<Cube><Cube time='2026-09-14'><Cube currency='USD' rate='1.1551'/><Cube currency='GBP' rate='0.85598'/></Cube></Cube>`,
					{ status: 200 },
				);
			if (u.includes("api.nbp.pl"))
				return new Response(
					JSON.stringify([
						{
							effectiveDate: "2026-09-14",
							rates: [
								{ code: "USD", mid: 3.65 },
								{ code: "GBP", mid: 4.9 },
							],
						},
					]),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await fxdepth();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; source: string }>(
			"SELECT id, source FROM events WHERE source IN ('ecb','nbp') ORDER BY source",
		);
		assert.ok(rows.length >= 2);
		assert.ok(
			rows.every((x) =>
				x.source === "ecb"
					? x.id.startsWith("fxecb:")
					: x.id.startsWith("fxnbp:"),
			),
			"ids carry their source prefix",
		);
	});
	it("erapi parses RFC2822 dates, no USD/USD rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("open.er-api.com/v6/latest/EUR"))
				return new Response(
					JSON.stringify({
						result: "success",
						time_last_update_utc: "Fri, 18 Sep 2026 00:02:31 +0000",
						rates: { USD: 1.148, GBP: 0.858, JPY: 178.9 },
					}),
					{ status: 200 },
				);
			if (u.includes("open.er-api.com/v6/latest/USD"))
				return new Response(
					JSON.stringify({
						result: "success",
						time_last_update_utc: "Fri, 18 Sep 2026 00:02:31 +0000",
						rates: { GBP: 0.747, JPY: 155.8, USD: 1 },
					}),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await fxdepth();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; title: string }>(
			"SELECT id, title FROM events WHERE source LIKE 'erapi%' ORDER BY id",
		);
		assert.ok(rows.length >= 2);
		assert.ok(
			rows.every(
				(x) => !x.id.includes("USDUSD") && !x.title.includes("USD/USD"),
			),
			"no identity rows",
		);
		assert.ok(
			rows.every((x) => /:\d{4}-\d{2}-\d{2}$/.test(x.id)),
			`ids carry ISO dates: ${rows[0]?.id}`,
		);
		assert.ok(
			rows.every((x) => x.title.includes("2026-09-18")),
			"titles carry parsed date",
		);
	});
	it("collect() stores ecb + fxrates rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("ecb.europa.eu"))
				return new Response(
					`<Cube><Cube time='2026-09-14'><Cube currency='USD' rate='1.1551'/><Cube currency='GBP' rate='0.85598'/></Cube></Cube>`,
					{ status: 200 },
				);
			if (u.includes("fxratesapi.com"))
				return new Response(
					JSON.stringify({
						base: "USD",
						date: "2026-09-15",
						rates: { EUR: 0.86 },
					}),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await fxdepth();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('ecb','fxrates')",
		);
		assert.ok(rows.length >= 2);
	});
});

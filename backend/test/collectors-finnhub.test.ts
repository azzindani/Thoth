// Collector contract tests, finnhub: disabled path + keyed path (dummy key, dynamic import).
// Consolidated from collectors-batch11/12 (per-collector refactor; pushTelegram lives in collectors-lib).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { config } from "../src/config.js";
import { query } from "../src/db/client.js";
import { collect as finnhub } from "../src/workers/collectors/finnhub.js";

const realFetch = globalThis.fetch;

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("finnhub earnings (keyed)", () => {
	it("stores earnings rows, token sent as query param", async () => {
		config.FINNHUB_KEY = "test-key-not-real";
		let seenUrl = "";
		globalThis.fetch = (async (url: unknown) => {
			seenUrl = String(url);
			return new Response(
				JSON.stringify({
					earningsCalendar: [
						{
							date: "2026-09-20",
							symbol: "AAPL",
							epsActual: null,
							epsEstimate: 1.75,
							quarter: 3,
						},
						{ date: "2026-09-21", epsEstimate: 0.5 },
						{
							date: "2026-09-22",
							symbol: "MSFT",
							epsActual: 3.1,
							epsEstimate: 2.9,
							quarter: 1,
						},
					],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await finnhub();
		assert.equal(r.ok, true);
		assert.equal((r as { count?: number }).count, 2);
		assert.match(seenUrl, /token=test-key-not-real/);
		const rows = await query<{ id: string; title: string }[]>(
			"SELECT id, title FROM events WHERE source='finnhub' ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => [x.id, x.title]),
			[
				["earnings:AAPL:2026-09-20", "AAPL earnings 2026-09-20"],
				["earnings:MSFT:2026-09-22", "MSFT earnings 2026-09-22"],
			],
		);
	});
	it("upstream failure is honest", async () => {
		config.FINNHUB_KEY = "test-key-not-real";
		globalThis.fetch = (async () => {
			return new Response("limited", { status: 429 });
		}) as typeof fetch;
		const r = await finnhub();
		assert.equal(r.ok, false);
		assert.match(String((r as { error?: string }).error), /429/);
	});
	it("restores unset key for the disabled suite below", async () => {
		config.FINNHUB_KEY = "";
		assert.equal(config.FINNHUB_KEY, "");
	});
});

describe("finnhub earnings", () => {
	it("disabled without key, honest error", async () => {
		const r = await finnhub();
		assert.equal(r.ok, false);
		assert.ok(
			((r as { error?: string }).error ?? "").includes("FINNHUB_KEY"),
			"key slot named",
		);
		const h = await query<{ error: string | null }[]>(
			"SELECT error FROM feed_health WHERE source='finnhub'",
		);
		assert.match(String(h[0]?.error), /FINNHUB_KEY/);
	});
	it("disabled run stores nothing new", async () => {
		// finnhub has no silent fallback: without a key nothing new is stored.
		// (The keyed suite above shares the table — assert the disabled run
		// adds zero rows by comparing counts before/after. Same shared-table
		// pattern as the quakes emsc scoping fix.)
		const before = await query<{ n: string }[]>(
			"SELECT count(*) AS n FROM events WHERE source='finnhub'",
		);
		await finnhub();
		const after = await query<{ n: string }[]>(
			"SELECT count(*) AS n FROM events WHERE source='finnhub'",
		);
		assert.equal(after[0]?.n, before[0]?.n);
	});
});

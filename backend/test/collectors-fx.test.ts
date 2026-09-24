// Collector contract tests, fx: Frankfurter rates. Consolidated from collectors-batch13 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as fx } from "../src/workers/collectors/fx.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("fx rates", () => {
	it("stores USD pairs, skips missing symbols", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			// EUR leg 500s so only the USD leg stores (keeps suites hermetic —
			// first-match-wins: base=EUR key must sort before the bare host).
			if (u.includes("base=EUR"))
				return new Response("no mock", { status: 500 });
			assert.match(u, /api\.frankfurter\.dev/);
			return new Response(
				JSON.stringify({
					date: "2026-09-11",
					rates: { EUR: 0.86266, UAH: 41.2 },
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await fx();
		assert.equal(r.ok, true);
		assert.equal((r as { count?: number }).count, 2);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='frankfurter' ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["fx:USDEUR:2026-09-11", "fx:USDUAH:2026-09-11"],
		);
	});
	it("EUR-base cross stores reverse pairs", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("base=EUR"))
				return new Response(
					JSON.stringify({ date: "2026-09-17", rates: { USD: 1.1537 } }),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await fx();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='frankfurter-eur' ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["fx:EURUSD:2026-09-17"],
		);
	});
	it("upstream failure is honest", async () => {
		globalThis.fetch = (async () => {
			return new Response("down", { status: 500 });
		}) as typeof fetch;
		const r = await fx();
		assert.equal(r.ok, false);
		assert.match(String((r as { error?: string }).error), /500/);
	});
});

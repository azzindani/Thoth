// Collector contract tests, predict: Manifold. Consolidated from collectors-batch20 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as predict } from "../src/workers/collectors/predict.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("predict", () => {
	it("collect() stores manifold rows", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify([
					{
						id: "abc123",
						question: "Will there be a ceasefire?",
						url: "https://manifold.markets/x",
						volume: 5000,
						probability: 0.42,
					},
				]),
				{ status: 200 },
			)) as typeof fetch;
		const r = await predict();
		assert.equal(r.ok, true);
		const rows = await query<{ title: string }[]>(
			"SELECT title FROM events WHERE source='manifold'",
		);
		assert.ok(rows.length >= 1);
		assert.match(rows[0].title, /42%/);
	});
});

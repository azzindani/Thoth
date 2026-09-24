// Collector contract tests, sentiment: Fear & Greed. Consolidated from collectors-batch19 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	fngSeverity,
	collect as sentiment,
} from "../src/workers/collectors/sentiment.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("sentiment", () => {
	it("bands extreme/warn/calm", () => {
		assert.equal(fngSeverity(10), "critical");
		assert.equal(fngSeverity(95), "critical");
		assert.equal(fngSeverity(25), "watch");
		assert.equal(fngSeverity(72), "watch");
		assert.equal(fngSeverity(50), "info");
	});
	it("collect() stores Fear & Greed rows", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					data: [
						{
							value: "72",
							value_classification: "Greed",
							timestamp: "1757817600",
						},
					],
				}),
				{ status: 200 },
			)) as typeof fetch;
		const r = await sentiment();
		assert.equal(r.ok, true);
		const rows = await query<{ title: string }>(
			"SELECT title FROM events WHERE source='fng'",
		);
		assert.equal(rows.length, 1);
		assert.match(rows[0].title, /Fear & Greed 72/);
	});
});

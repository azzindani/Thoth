// Collector contract tests, storms: NHC. Consolidated from collectors-batch20 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	parseStormLatLon,
	stormSeverity,
	collect as storms,
} from "../src/workers/collectors/storms.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("storms", () => {
	it("stormSeverity + parseStormLatLon", () => {
		assert.equal(stormSeverity("Hurricane X Advisory"), "critical");
		assert.equal(stormSeverity("Tropical Depression Norbert"), "watch");
		assert.equal(stormSeverity("Summary"), "info");
		assert.deepEqual(parseStormLatLon("near 20.3°N 141.7°W blah"), {
			lat: 20.3,
			lon: -141.7,
		});
		assert.equal(parseStormLatLon("no coords here"), null);
	});
	it("quiet wallets store heartbeats, active store advisories", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("nhc_cp1.xml"))
				return new Response(
					`<rss><channel><item><title>Tropical Depression Norbert Public Advisory Number 23</title><link>https://x</link><pubDate>Tue, 15 Sep 2026 08:36:08 GMT</pubDate></item></channel></rss>`,
					{ status: 200 },
				);
			return new Response(
				`<rss><channel><title>No current storm</title></channel></rss>`,
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await storms();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='nhc'",
		);
		assert.equal(rows.length, 3); // 2 quiet heartbeats + 1 advisory
	});
});

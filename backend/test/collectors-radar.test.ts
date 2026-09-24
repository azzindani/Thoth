// Collector contract tests, radar: RainViewer.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as radar } from "../src/workers/collectors/radar.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("radar", () => {
	it("collect() stores the index heartbeat", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					host: "https://tilecache.rainviewer.com",
					radar: {
						past: [{ time: 1789454400, path: "/v2/radar/x" }],
						nowcast: [{ time: 1789461000, path: "/v2/radar/y" }],
					},
				}),
				{ status: 200 },
			)) as typeof fetch;
		const r = await radar();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='rainviewer'",
		);
		assert.equal(rows.length, 1);
	});
	it("IR leg stores frames and stays green when empty", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					host: "https://tilecache.rainviewer.com",
					radar: {
						past: [{ time: 1789454400, path: "/v2/radar/x" }],
						nowcast: [],
					},
					satellite: { infrared: [{ time: 1789461000, path: "/v2/sat/y" }] },
				}),
				{ status: 200 },
			)) as typeof fetch;
		const r = await radar();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='rainviewer-ir'",
		);
		assert.equal(rows.length, 1);
		assert.ok(rows[0].id.startsWith("rainviewer:ir:"));
	});
});

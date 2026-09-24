// Collector contract tests, rivers: NWIS + OM flood. Consolidated from collectors-batch20 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as rivers } from "../src/workers/collectors/rivers.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("rivers", () => {
	it("collect() stores flow + stage rows", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					value: {
						timeSeries: [
							{
								name: "USGS:01491000:00060:00000",
								sourceInfo: {
									siteName: "CHOPTANK",
									geoLocation: {
										geogLocation: { latitude: 38.99, longitude: -75.78 },
									},
								},
								variable: {
									variableCode: [{ value: "00060" }],
									unit: { unitCode: "ft3/s" },
								},
								values: [
									{
										value: [
											{
												value: "10.2",
												dateTime: "2026-09-15T04:15:00.000-04:00",
											},
										],
									},
								],
							},
						],
					},
				}),
				{ status: 200 },
			)) as typeof fetch;
		const r = await rivers();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='nwis'",
		);
		assert.equal(rows.length, 1);
	});
});

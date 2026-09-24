// Collector contract tests, energyuk: carbon intensity.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	collect as energyuk,
	gridSeverity,
} from "../src/workers/collectors/energy-uk.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("energy-uk", () => {
	it("gridSeverity bands the index", () => {
		assert.equal(gridSeverity("very high"), "critical");
		assert.equal(gridSeverity("high"), "watch");
		assert.equal(gridSeverity("low"), "info");
	});
	it("collect() stores the grid row", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("/generation"))
				return new Response(JSON.stringify({ data: {} }), { status: 500 });
			if (u.includes("fw48h"))
				return new Response(JSON.stringify({ data: [] }), { status: 500 });
			return new Response(
				JSON.stringify({
					data: [
						{
							from: "2026-09-15T08:00Z",
							intensity: { forecast: 57, actual: 60, index: "low" },
						},
					],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await energyuk();
		assert.equal(r.ok, true);
		const rows = await query<{ title: string }>(
			"SELECT title FROM events WHERE source='carbon-uk'",
		);
		assert.match(rows[0].title, /60 gCO₂\/kWh/);
	});
	it("forecast + mix legs store peak and fuel rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("/generation"))
				return new Response(
					JSON.stringify({
						data: {
							from: "2026-09-17T08:00Z",
							generationmix: [
								{ fuel: "wind", perc: 56.9 },
								{ fuel: "nuclear", perc: 10.1 },
								{ fuel: "gas", perc: 8.1 },
							],
						},
					}),
					{ status: 200 },
				);
			if (u.includes("fw48h"))
				return new Response(
					JSON.stringify({
						data: [
							{
								from: "2026-09-17T10:00Z",
								intensity: { forecast: 86, index: "low" },
							},
						],
					}),
					{ status: 200 },
				);
			return new Response(JSON.stringify({ data: [] }), { status: 500 });
		}) as typeof fetch;
		const r = await energyuk();
		assert.equal(r.ok, true);
		const fw = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='carbon-uk-fw'",
		);
		assert.deepEqual(
			fw.map((x) => x.id),
			["carbonfw:2026-09-17"],
		);
		const mix = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='carbon-uk-mix' ORDER BY id",
		);
		assert.equal(mix.length, 3);
	});
});

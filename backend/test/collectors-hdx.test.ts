// Collector contract tests, hdx: IDMC displacement.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { dispSeverity, collect as hdx } from "../src/workers/collectors/hdx.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("hdx-idmc", () => {
	it("dispSeverity scales with displaced count", () => {
		assert.equal(dispSeverity(2000000), "critical");
		assert.equal(dispSeverity(200000), "watch");
		assert.equal(dispSeverity(5000), "info");
	});
	it("collect() stores latest-year displacement rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			// CKAN legs 500 so only the IDMC leg stores (keeps suites hermetic).
			if (u.includes("package_search"))
				return new Response("no mock", { status: 500 });
			if (u.includes("package_show"))
				return new Response(
					JSON.stringify({
						success: true,
						result: {
							resources: [
								{
									name: "Internal Displacements (New Displacements)",
									format: "CSV",
									url: "https://data.humdata.org/x.csv",
								},
							],
						},
					}),
					{ status: 200 },
				);
			return new Response(
				"iso3,country_name,year,new_displacement\nNGA,Nigeria,2023,5000\n",
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await hdx();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='hdx-idmc'",
		);
		assert.ok(rows.length >= 1);
	});
	it("ckan catalog pulse stores per-portal counts", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("package_search"))
				return new Response(
					JSON.stringify({
						success: true,
						result: {
							count: 576,
							results: [{ title: "GDP", organization: { title: "StatCan" } }],
						},
					}),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await hdx();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source LIKE 'ckan-%' ORDER BY id",
		);
		assert.equal(rows.length, 4);
		assert.ok(rows.every((x) => x.id.startsWith("ckan:")));
	});
});

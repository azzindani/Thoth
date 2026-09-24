// Collector contract tests, health: WHO GHO + FDA FAERS.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	fmtVal,
	collect as who,
} from "../src/workers/collectors/health-who.js";

const realFetch = globalThis.fetch;
function ok(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("who-gho helpers", () => {
	it("fmtVal compacts big counts", () => {
		assert.equal(fmtVal(2500000), "2.5M");
		assert.equal(fmtVal(45000), "45k");
		assert.equal(fmtVal(72.4), "72.4");
	});
	it("collect() stores latest-year rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			// UNESCO leg 500s so only the WHO leg stores (keeps suites hermetic).
			if (u.includes("api.uis.unesco.org")) return ok({ records: [] }, 500);
			return new Response(
				JSON.stringify({
					value: [
						{
							IndicatorCode: "WHOSIS_000001",
							SpatialDim: "USA",
							TimeDim: 2021,
							Dim1: "SEX_BTSX",
							NumericValue: 77.5,
							Value: "77.5",
						},
					],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await who();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='who-gho'",
		);
		assert.ok(rows.length >= 1);
		assert.ok(rows[0].id.startsWith("who:"));
	});
});

describe("health unesco-enrol", () => {
	it("stores primary-pupil rows per country", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.uis.unesco.org"))
				return ok({
					records: [
						{
							indicatorId: "20062",
							geoUnit: "USA",
							year: 2016,
							value: 25019052,
						},
					],
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await who();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='unesco-enrol' ORDER BY id",
		);
		assert.ok(rows.length >= 1);
		assert.ok(rows.some((x) => x.id === "unesco:enrol:USA:2016"));
	});
});

describe("health faers", () => {
	it("faers stores serious reports", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("ghoapi.azureedge.net")) return ok({ value: [] });
			if (u.includes("food/enforcement.json")) return ok({ results: [] });
			if (u.includes("device/recall.json")) return ok({ results: [] });
			if (u.includes("api.uis.unesco.org")) return ok({ records: [] }, 500);
			if (u.includes("drug/event.json"))
				return ok({
					results: [
						{
							safetyreportid: "1-1",
							receivedate: "20080707",
							patient: {
								drug: [{ medicinalproduct: "DURAGESIC-100" }],
								reaction: [{ reactionmeddrapt: "OVERDOSE" }],
							},
						},
					],
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await who();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='fda-faers'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["faers:1-1"],
		);
	});
});

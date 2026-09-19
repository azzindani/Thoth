// Collector contract tests, perims: NIFC polygons. Consolidated from collectors-batch7 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as perims } from "../src/workers/collectors/perims.js";

const realFetch = globalThis.fetch;
function stub(json: unknown, status = 200) {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify(json), { status })) as typeof fetch;
}
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("perims collect()", () => {
	it("stores fire polygons with size-driven severity", async () => {
		stub({
			features: [
				{
					properties: {
						attr_UniqueFireIdentifier: "2026-CA-001",
						attr_IncidentName: "Big Basin Blaze",
						attr_IncidentSize: 25000,
						attr_PercentContained: 10,
						attr_FireCause: "Lightning",
					},
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[-122.1, 37.1],
								[-122.0, 37.1],
								[-122.0, 37.2],
								[-122.1, 37.1],
							],
						],
					},
				},
				{
					properties: { attr_IncidentName: "No Geometry Fire" },
					geometry: {},
				},
			],
		});
		const r = await perims();
		assert.equal(r.ok, true);
		assert.equal(r.count, 1, "geometry-less feature skipped");
		const rows = await query<{ id: string; severity: string; geom: unknown }[]>(
			"SELECT id, severity, ST_AsGeoJSON(geom)::json AS geom FROM events WHERE layer='perims'",
		);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].severity, "critical", "25k ac @ 10% contained");
		assert.equal(
			(rows[0].geom as { type: string }).type,
			"Polygon",
			"polygon survives PostGIS round-trip",
		);
	});
	it("marks health on empty feature set", async () => {
		stub({ features: [] });
		const r = await perims();
		assert.equal(r.ok, false);
		assert.match(String(r.error), /empty/);
	});
});

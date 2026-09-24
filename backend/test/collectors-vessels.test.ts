// Collector contract tests, vessels: Digitraffic AIS vessel positions + names.
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as vessels from "../src/workers/collectors/vessels.js";
import {
	eventsOf,
	json,
	resetTables,
	restoreFetch,
	stubFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

describe("vessels", () => {
	it("keeps recent, valid positions and names them", async () => {
		const now = Date.now();
		const calls = stubFetch([
			[
				/ais\/v1\/locations/,
				json({
					type: "FeatureCollection",
					features: [
						{
							mmsi: 230001000,
							type: "Feature",
							geometry: { type: "Point", coordinates: [24.95, 60.16] },
							properties: {
								sog: 12.3,
								cog: 90,
								heading: 88,
								navStat: 0,
								timestampExternal: now - 60e3,
							},
						},
						{
							mmsi: 230002000,
							type: "Feature",
							geometry: { type: "Point", coordinates: [181, 91] },
							properties: { timestampExternal: now },
						},
						{
							mmsi: 230003000,
							type: "Feature",
							geometry: { type: "Point", coordinates: [22, 60] },
							properties: { timestampExternal: now - 3 * 3600e3 },
						},
					],
				}),
			],
			[
				/ais\/v1\/vessels/,
				json([
					{
						mmsi: 230001000,
						name: "FINNSTAR",
						shipType: 70,
						destination: "TRAVEMUNDE",
					},
				]),
			],
		]);
		const r = await vessels.collect();
		assert.equal(r.ok, true);
		const v = await eventsOf("digitraffic-ais");
		assert.deepEqual(
			v.map((x) => x.id),
			["ais:fi:230001000"],
		);
		assert.equal(v[0].title, "FINNSTAR · cargo · 12.3 kn · → TRAVEMUNDE");
		assert.equal(v[0].meta.track, 88);
		assert.ok(calls.every((u) => !u.includes("?key")));
	});
});

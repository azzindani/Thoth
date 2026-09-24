// Collector contract tests, cables: TeleGeography submarine cable routes + landing points.
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import * as cables from "../src/workers/collectors/cables.js";
import {
	json,
	resetTables,
	restoreFetch,
	stubFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

describe("cables", () => {
	it("stores routes as lines and landings as points", async () => {
		stubFetch([
			[
				/cable-geo\.json/,
				json({
					features: [
						{
							type: "Feature",
							properties: { id: "2africa", name: "2Africa", color: "#939597" },
							geometry: {
								type: "MultiLineString",
								coordinates: [
									[
										[0, 0],
										[10, 10],
									],
									[
										[10, 10],
										[20, 5],
									],
								],
							},
						},
						{
							type: "Feature",
							properties: { id: "bad id!" },
							geometry: {
								type: "LineString",
								coordinates: [
									[0, 0],
									[1, 1],
								],
							},
						},
					],
				}),
			],
			[
				/landing-point-geo\.json/,
				json({
					features: [
						{
							type: "Feature",
							properties: { id: "marseille-france", name: "Marseille, France" },
							geometry: { type: "Point", coordinates: [5.37, 43.3] },
						},
					],
				}),
			],
		]);
		const r = await cables.collect();
		assert.equal(r.ok, true);
		const g = await query<{ id: string; t: string }>(
			`SELECT id, GeometryType(geom) AS t FROM events WHERE source='submarine-cables' ORDER BY id`,
		);
		assert.deepEqual(g, [
			{ id: "cable-landing:marseille-france", t: "POINT" },
			{ id: "cable:2africa", t: "MULTILINESTRING" },
		]);
	});
});

// Collector contract tests, ems: Copernicus EMS rapid-mapping activations (dashboard list, EMS portal fallback).
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as ems from "../src/workers/collectors/ems.js";
import {
	eventsOf,
	json,
	resetTables,
	restoreFetch,
	stubFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

describe("ems", () => {
	it("reads the API with tolerant field names", () => {
		const a = ems.parseEmsApi({
			results: [
				{
					code: "EMSR812",
					name: "Flood in Emilia-Romagna",
					category: "Flood",
					activationTime: "2026-09-20T08:00:00Z",
					centroid: "POINT (11.3 44.5)",
					countries: [{ name: "Italy" }],
					closed: false,
				},
				{ code: "junk" },
			],
		});
		assert.equal(a.length, 1);
		assert.deepEqual([a[0].lon, a[0].lat], [11.3, 44.5]);
		assert.deepEqual(a[0].countries, ["Italy"]);
	});
	it("falls back to the EMS portal list when the dashboard fails", async () => {
		stubFetch([
			[/dashboard-api/, () => new Response("down", { status: 502 })],
			[
				/mapping\.emergency\.copernicus\.eu\/activations\/api/,
				json({
					results: [
						{
							code: "EMSR900",
							name: "Wildfire in Attica",
							countries: [{ short_name: "Greece" }],
							category: { slug: "fire", name: "Wildfire" },
							centroid: "POINT (23.7 38.0)",
							activationTime: "2026-09-21T10:00:00",
							closed: false,
						},
					],
				}),
			],
		]);
		const r = await ems.collect();
		assert.deepEqual([r.ok, (r as { via?: string }).via], [true, "portal"]);
		const [row] = await eventsOf("copernicus-ems");
		assert.equal(row.id, "ems:EMSR900");
		assert.equal(row.severity, "watch");
		assert.deepEqual([row.lat, row.lon], [38, 23.7]);
	});
	it("fails honestly when both lists are down", async () => {
		stubFetch([]);
		const r = await ems.collect();
		assert.equal(r.ok, false);
		assert.match(String((r as { error?: string }).error), /api: .*portal: /);
	});
});

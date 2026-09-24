// Collector contract tests, navwarn: NGA MSI broadcast warnings.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	navGeometry,
	navHeadline,
	navSeverity,
	collect as navwarn,
	parseDtg,
	parseNavCoords,
} from "../src/workers/collectors/navwarn.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

const AREA = `EASTERN MEDITERRANEAN SEA.
CYPRUS.
1. HAZARDOUS OPERATIONS, LIVE FIRING
   0600Z TO 1400Z DAILY 15 THRU 18 SEP
   BETWEEN 0600Z AND 1400Z IN AREA BOUND BY
   34-38.00N 032-17.00E, 34-38.00N 032-40.00E,
   34-20.00N 032-40.00E, 34-20.00N 032-17.00E.
2. CANCEL THIS MSG 181500Z SEP 26.`;

const TWO_AREAS = `SOUTH CHINA SEA.
1. ROCKET LAUNCHING 0100Z TO 0300Z 20 SEP IN AREAS BOUND BY:
   A. 19-04N 111-10E, 19-10N 111-45E, 18-40N 111-50E, 18-35N 111-15E.
   B. 17-00N 113-00E, 17-10N 113-30E, 16-50N 113-35E.
2. CANCEL THIS MSG 200400Z SEP 26.`;

describe("navwarn", () => {
	it("parses NGA coordinates (deg-min, hemispheres)", () => {
		assert.deepEqual(parseNavCoords("34-30.00N 032-15.00E"), [[32.25, 34.5]]);
		assert.deepEqual(parseNavCoords("10-06S 075-30W"), [[-75.5, -10.1]]);
		assert.deepEqual(parseNavCoords("15 THRU 18 SEP"), []);
	});
	it("builds polygons per area, points for single positions", () => {
		const g = navGeometry(AREA) as {
			type: string;
			coordinates: number[][][][];
		};
		assert.equal(g.type, "MultiPolygon"); // firing window "BETWEEN..AND" is not a line
		assert.equal(g.coordinates.length, 1);
		assert.equal(g.coordinates[0][0].length, 5); // closed ring
		const two = navGeometry(TWO_AREAS) as { coordinates: unknown[] };
		assert.equal(two.coordinates.length, 2);
		const pt = navGeometry(
			"BLACK SEA.\n1. MINE SIGHTED IN 44-30.0N 033-10.0E.",
		) as { type: string };
		assert.equal(pt.type, "Point");
		assert.equal(navGeometry("1. CANCEL NAVAREA IV 1234/26."), null);
	});
	it("severity, headline and DTG", () => {
		assert.equal(navSeverity("MINE SIGHTED"), "critical");
		assert.equal(navSeverity("GNSS INTERFERENCE REPORTED"), "watch");
		assert.equal(navSeverity(AREA), "watch");
		assert.equal(navSeverity("LIGHT UNLIT"), "info");
		assert.equal(
			navHeadline(AREA),
			"EASTERN MEDITERRANEAN SEA — HAZARDOUS OPERATIONS, LIVE FIRING",
		);
		assert.equal(parseDtg("281722Z AUG 2026"), "2026-08-28T17:22:00.000Z");
		assert.equal(parseDtg("garbage"), null);
	});
	it("stores active warnings and prunes cancelled ones", async () => {
		let list = [
			{
				msgYear: 2026,
				msgNumber: 101,
				navArea: "4",
				text: AREA,
				issueDate: "140600Z SEP 2026",
			},
			{
				msgYear: 2026,
				msgNumber: 102,
				navArea: "P",
				text: TWO_AREAS,
				issueDate: "190000Z SEP 2026",
			},
		];
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ "broadcast-warn": list }), {
				status: 200,
			})) as typeof fetch;
		const r = await navwarn();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; title: string; gt: string }>(
			"SELECT id, title, GeometryType(geom) AS gt FROM events WHERE source='nga-msi' ORDER BY id",
		);
		assert.equal(rows.length, 2);
		assert.match(rows[0].title, /^NAVAREA IV 101\/26 · /);
		assert.equal(rows[0].gt, "MULTIPOLYGON");
		// Warning 101 cancelled upstream → gone after the next poll.
		list = list.slice(1);
		await navwarn();
		const left = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='nga-msi'",
		);
		assert.deepEqual(
			left.map((x) => x.id),
			["navwarn:P:2026:102"],
		);
	});
	it("an empty or failed poll never empties the layer", async () => {
		globalThis.fetch = (async () =>
			new Response("[]", { status: 200 })) as typeof fetch;
		assert.equal((await navwarn()).ok, false);
		globalThis.fetch = (async () =>
			new Response("x", { status: 503 })) as typeof fetch;
		assert.equal((await navwarn()).ok, false);
		const left = await query("SELECT id FROM events WHERE source='nga-msi'");
		assert.equal(left.length, 1);
	});
});

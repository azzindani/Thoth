// Collector contract tests, gpsjam: GNSS interference from ADS-B NACp.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	binCells,
	cellSeverity,
	collect as gpsjam,
	isDegraded,
	REGIONS,
} from "../src/workers/collectors/gpsjam.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

const ac = (hex: string, lat: number, lon: number, nac_p: number) => ({
	hex,
	lat,
	lon,
	alt_baro: 35000,
	nac_p,
});

describe("gpsjam", () => {
	it("classifies aircraft and cells", () => {
		assert.equal(isDegraded({ hex: "a", nac_p: 9 }), false);
		assert.equal(isDegraded({ hex: "a", nac_p: 0 }), true);
		assert.equal(isDegraded({ hex: "a", nac_p: 10, gpsOkBefore: 1 }), true);
		const cells = binCells([
			ac("1", 54.2, 19.1, 0),
			ac("2", 54.7, 19.9, 0),
			ac("3", 54.5, 19.5, 10),
			{ hex: "4", lat: 54.5, lon: 19.5, alt_baro: "ground", nac_p: 0 },
			{ hex: "5", lat: 54.5, lon: 19.5 }, // no accuracy report
		]);
		assert.equal(cells.length, 1);
		assert.deepEqual(
			{ total: cells[0].total, bad: cells[0].bad, key: cells[0].key },
			{ total: 3, bad: 2, key: "54:19" },
		);
		assert.equal(cellSeverity(cells[0]), "critical");
		const c = { key: "k", lat0: 0, lon0: 0 };
		assert.equal(cellSeverity({ ...c, total: 2, bad: 2 }), null); // too sparse
		assert.equal(cellSeverity({ ...c, total: 20, bad: 1 }), "watch"); // 5%
		assert.equal(cellSeverity({ ...c, total: 60, bad: 1 }), null); // <2%
	});
	it("stores degraded cells as polygons, dedupes, prunes cleared cells", async () => {
		let jam = true;
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (!u.includes("api.adsb.lol"))
				return new Response("down", { status: 503 });
			// Same aircraft appear in overlapping regions: counted once.
			return new Response(
				JSON.stringify({
					ac: [
						ac("aa1", 54.2, 19.1, jam ? 0 : 10),
						ac("aa2", 54.7, 19.9, jam ? 0 : 10),
						ac("aa3", 54.5, 19.5, 10),
						ac("bb1", 40.5, 10.5, 10),
					],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await gpsjam();
		assert.equal(r.ok, true);
		assert.equal((r as { regions: number }).regions, REGIONS.length);
		const rows = await query<{ id: string; severity: string; gt: string }>(
			"SELECT id, severity, GeometryType(geom) AS gt FROM events WHERE source='gpsjam'",
		);
		assert.equal(rows.length, 1);
		assert.deepEqual(rows[0], {
			id: "gpsjam:54:19",
			severity: "critical",
			gt: "POLYGON",
		});
		jam = false;
		await gpsjam();
		const after = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='gpsjam'",
		);
		assert.deepEqual(
			after.map((x) => x.id),
			["gpsjam:quiet"],
		);
	});
	it("all regions down → unhealthy, nothing pruned", async () => {
		globalThis.fetch = (async () =>
			new Response("down", { status: 503 })) as typeof fetch;
		const r = await gpsjam();
		assert.equal(r.ok, false);
		const left = await query("SELECT id FROM events WHERE source='gpsjam'");
		assert.equal(left.length, 1);
	});
});

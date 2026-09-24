// Collector contract tests, radiation: Safecast and BfS ODL (German gamma
// dose-rate network). Upstreams stubbed at fetch.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as radiation from "../src/workers/collectors/radiation.js";
import {
	eventsOf,
	healthOf,
	json,
	resetTables,
	restoreFetch,
	stubFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

const SAFECAST = [
	{
		id: 1,
		value: 33,
		unit: "cpm",
		latitude: 36.3,
		longitude: 139.1,
		captured_at: "2026-09-09T10:00:00.000Z",
		location_name: null,
	},
];

// Whole hours relative to now, so the 6 h freshness cut is exercised.
const hourAgo = (h: number) =>
	new Date(Math.floor(Date.now() / 3600_000 - h) * 3600_000)
		.toISOString()
		.replace(".000Z", "Z");

const station = (
	id: string,
	value: number | null,
	end: string | null,
	status = 1,
) => ({
	type: "Feature",
	geometry: { type: "Point", coordinates: [10.42, 52.23] },
	properties: {
		id,
		name: `Station ${id}`,
		site_status: status,
		site_status_text: status === 1 ? "in Betrieb" : "defekt",
		value,
		value_cosmic: 0.04,
		value_terrestrial: value == null ? null : value - 0.04,
		unit: "µSv/h",
		end_measure: end,
		validated: 1,
		height_above_sea: 77,
	},
});
const odl = (features: unknown[]) => ({
	type: "FeatureCollection",
	totalFeatures: features.length,
	features,
});

describe("radiation parsing", () => {
	it("keeps operating stations with a fresh reading", () => {
		const rows = radiation.odlReadings(
			odl([
				station("DEZ1", 0.11, hourAgo(1)),
				station("DEZ2", null, null, 2),
				station("DEZ3", 0.09, hourAgo(9)),
				{ ...station("DEZ4", 0.1, hourAgo(1)), geometry: null },
			]),
		);
		assert.deepEqual(
			rows.map((r) => [r.id, r.value, r.lon, r.lat]),
			[["DEZ1", 0.11, 10.42, 52.23]],
		);
		assert.equal(rows[0].meta.validated, true);
	});
	it("grades dose rates against the German background", () => {
		assert.equal(radiation.odlSeverity(0.12), "info");
		assert.equal(radiation.odlSeverity(0.35), "watch");
		assert.equal(radiation.odlSeverity(1.2), "critical");
	});
	it("rejects a payload that is not a feature collection", () => {
		assert.throws(() => radiation.odlReadings({ error: "maintenance" }));
	});
});

describe("radiation collect()", () => {
	it("stores Safecast readings and the BfS station picture", async () => {
		stubFetch([
			[/api\.safecast\.org/, json(SAFECAST)],
			[
				/imis\.bfs\.de/,
				json(
					odl([
						station("DEZ1", 0.11, hourAgo(2)),
						station("DEZ2", 0.35, hourAgo(2)),
					]),
				),
			],
		]);
		const r = await radiation.collect();
		assert.deepEqual(r, { ok: true, count: 3 });
		const bfs = await eventsOf("bfs-odl");
		assert.deepEqual(
			bfs.map((e) => [e.id, e.severity, e.title]),
			[
				["bfs-odl:DEZ1", "info", "0.11 µSv/h — Station DEZ1"],
				["bfs-odl:DEZ2", "watch", "0.35 µSv/h — Station DEZ2"],
			],
		);
		assert.equal((await healthOf("bfs-odl")).ok, true);
	});
	it("prunes a station that stops reporting on the next hour", async () => {
		stubFetch([
			[/api\.safecast\.org/, json(SAFECAST)],
			[/imis\.bfs\.de/, json(odl([station("DEZ1", 0.12, hourAgo(1))]))],
		]);
		await radiation.collect();
		const bfs = await eventsOf("bfs-odl");
		assert.deepEqual(
			bfs.map((e) => [e.id, e.title]),
			[["bfs-odl:DEZ1", "0.12 µSv/h — Station DEZ1"]],
		);
	});
	it("leaves the picture alone while the newest hour is unchanged", async () => {
		stubFetch([
			[/api\.safecast\.org/, json(SAFECAST)],
			[/imis\.bfs\.de/, json(odl([station("DEZ1", 0.5, hourAgo(1))]))],
		]);
		await radiation.collect();
		const [e] = await eventsOf("bfs-odl");
		assert.equal(e.title, "0.12 µSv/h — Station DEZ1");
		assert.equal((await healthOf("bfs-odl")).ok, true);
	});
	it("fails bfs-odl alone when its payload changes shape", async () => {
		stubFetch([
			[/api\.safecast\.org/, json(SAFECAST)],
			[/imis\.bfs\.de/, json({ error: "maintenance" })],
		]);
		const r = await radiation.collect();
		assert.equal(r.ok, true);
		assert.equal((await healthOf("bfs-odl")).ok, false);
		assert.equal((await healthOf("safecast")).ok, true);
	});
});

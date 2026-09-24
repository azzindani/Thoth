// Collector contract tests, transit-other: GBFS bikeshare + MBTA + SEPTA.
// Consolidated from collectors-batch26/31/35/37 files (per-collector refactor, Phase 1).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as transit } from "../src/workers/collectors/transit.js";

const realFetch = globalThis.fetch;

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

function ok(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}

function stub(order: [string, (u: string) => unknown][]) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [key, fn] of order) if (u.includes(key)) return fn(u);
		return new Response("no mock", { status: 500 });
	}) as typeof fetch;
}

describe("transit gbfs/tfl", () => {
	it("gbfs + tfl-aq + tfl-tube store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("transport.opendata.ch"))
				return ok({ stationboard: [] }, 500);
			if (u.includes("data.sncf.com")) return ok({ results: [] }, 500);
			if (u.includes("svc.metrotransit.org")) return ok([], 500);
			if (u.includes("station_information.json"))
				return ok({
					data: {
						stations: [
							{ station_id: "s1", name: "Test St", lat: 40.7, lon: -74.0 },
						],
					},
				});
			if (u.includes("station_status.json"))
				return ok({
					data: {
						stations: [
							{
								station_id: "s1",
								num_bikes_available: 5,
								num_docks_available: 10,
							},
						],
					},
				});
			if (u.includes("api.tfl.gov.uk/AirQuality"))
				return ok({
					currentForecast: [
						{ forecastBand: "Low", forecastSummary: "Clean air" },
					],
				});
			if (u.includes("Line/Mode/tube/Disruption"))
				return ok([
					{
						description: "Test line: minor delays.",
						closureText: "minorDelays",
					},
				]);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('gbfs','tfl-aq','tfl-tube')",
		);
		assert.ok(rows.length >= 3);
	});
});

describe("transit mbta", () => {
	it("mbta stores vehicle rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("transport.opendata.ch"))
				return ok({ stationboard: [] }, 500);
			if (u.includes("data.sncf.com")) return ok({ results: [] }, 500);
			if (u.includes("svc.metrotransit.org")) return ok([], 500);
			if (u.includes("gbfs.citibikenyc.com")) return ok({}, 500);
			if (u.includes("api.tfl.gov.uk/AirQuality")) return ok({}, 500);
			if (u.includes("Line/Mode/tube")) return ok([], 500);
			if (u.includes("api-v3.mbta.com"))
				return ok({
					data: [
						{
							id: "y2083",
							attributes: {
								latitude: 42.37,
								longitude: -71.12,
								label: "2083",
								current_status: "STOPPED_AT",
								speed: null,
							},
						},
					],
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='mbta'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["mbta:y2083"],
		);
	});
});

describe("transit septa", () => {
	it("stores bus fleet rows", async () => {
		stub([
			["transport.opendata.ch", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["api.tfl.gov.uk", () => ok({}, 500)],
			["Line/Mode/tube", () => ok([], 500)],
			["api-v3.mbta.com", () => ok({}, 500)],
			[
				"septa.org",
				() =>
					ok({
						bus: [
							{
								lat: "40.076985",
								lng: "-75.03285",
								label: "3769",
								route_id: "1",
								Direction: "Southbound",
								destination: "54th-City",
								late: 2,
								VehicleID: "3769",
							},
							{ lat: "bad", lng: "bad", label: "x" },
						],
					}),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='septa'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["septa:3769"],
		);
	});
});

describe("transit septa-rail", () => {
	it("stores regional-rail rows", async () => {
		stub([
			["transport.opendata.ch", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["api.tfl.gov.uk", () => ok({}, 500)],
			["Line/Mode/tube", () => ok([], 500)],
			["api-v3.mbta.com", () => ok({}, 500)],
			["TransitView", () => ok({ bus: [] }, 500)],
			[
				"TrainView",
				() =>
					ok([
						{
							lat: "39.95384008",
							lon: "-75.16510235",
							trainno: "207",
							line: "Wilmington/Newark",
							dest: "Marcus Hook",
							currentstop: "Jefferson Station",
							nextstop: "Suburban Station",
							late: 0,
						},
						{ lat: "bad", lon: "bad", trainno: "x" },
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='septa-rail'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["septarail:207"],
		);
	});
});

describe("transit gbfs-divvy + gbfs-cabi", () => {
	it("stores Chicago + DC bike rows", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["citibikenyc.com", () => ok({}, 500)],
			["api.tfl.gov.uk/AirQuality", () => ok({}, 500)],
			["Line/Mode/tube/Disruption", () => ok([], 500)],
			["BikePoint", () => ok([], 500)],
			["Road/A2/Disruption", () => ok([], 500)],
			["Road/A3/Disruption", () => ok([], 500)],
			["Road/A4/Disruption", () => ok([], 500)],
			["Road/A1/Disruption", () => ok([], 500)],
			["Road/A10/Disruption", () => ok([], 500)],
			["Road/A13/Disruption", () => ok([], 500)],
			["Road/A40/Disruption", () => ok([], 500)],
			["api-v3.mbta.com", () => ok({ data: [] }, 500)],
			["TransitView", () => ok({ bus: [] }, 500)],
			["TrainView", () => ok([], 500)],
			["irail.be", () => ok({ departures: { departure: [] } }, 500)],
			["rata.digitraffic.fi", () => ok([], 500)],
			["v1/connections", () => ok({ connections: [] }, 500)],
			["StopPoint/940GZZLUBST/Arrivals", () => ok([], 500)],
			[
				"divvybikes.com",
				() =>
					ok({
						data: {
							stations: [
								{
									station_id: "d1",
									name: "Damen Ave",
									lat: 41.87,
									lon: -87.67,
									capacity: 15,
								},
							],
						},
					}),
			],
			[
				"capitalbikeshare.com",
				() =>
					ok({
						data: {
							stations: [
								{
									station_id: "c1",
									name: "Arlington Mill",
									lat: 38.84,
									lon: -77.08,
									capacity: 15,
								},
							],
						},
					}),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		// NOTE: status legs 500 → byId empty → bikes=0 → still stored (watch);
		// info legs carry the single mock station each (step > n keeps idx 0).
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('gbfs-divvy','gbfs-cabi') ORDER BY id",
		);
		assert.ok(rows.some((x) => x.id.startsWith("gbfs-divvy:d1")));
		assert.ok(rows.some((x) => x.id.startsWith("gbfs-cabi:c1")));
	});
});

describe("transit gbfs-blue + gbfs-toronto", () => {
	it("stores Boston + Toronto bike rows", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["gbfs.divvybikes.com", () => ok({}, 500)],
			["gbfs.capitalbikeshare.com", () => ok({}, 500)],
			["api.tfl.gov.uk/AirQuality", () => ok({}, 500)],
			["Line/Mode/tube/Disruption", () => ok([], 500)],
			["BikePoint", () => ok([], 500)],
			["Road/A2/Disruption", () => ok([], 500)],
			["Road/A3/Disruption", () => ok([], 500)],
			["Road/A4/Disruption", () => ok([], 500)],
			["Road/A1/Disruption", () => ok([], 500)],
			["Road/A10/Disruption", () => ok([], 500)],
			["Road/A13/Disruption", () => ok([], 500)],
			["Road/A40/Disruption", () => ok([], 500)],
			["api-v3.mbta.com", () => ok({ data: [] }, 500)],
			["TransitView", () => ok({ bus: [] }, 500)],
			["TrainView", () => ok([], 500)],
			["irail.be/liveboard", () => ok({ departures: { departure: [] } }, 500)],
			["irail.be/connections", () => ok({ connection: [] }, 500)],
			["rata.digitraffic.fi", () => ok([], 500)],
			["from=Zurich", () => ok({ connections: [] }, 500)],
			["from=Bern", () => ok({ connections: [] }, 500)],
			["from=Geneva", () => ok({ connections: [] }, 500)],
			["from=Lausanne", () => ok({ connections: [] }, 500)],
			["StopPoint/940GZZLUBST/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUKSX/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUEUS/Arrivals", () => ok([], 500)],
			[
				"victoria,central,jubilee,piccadilly,northern,bakerloo/Status",
				() => ok([], 500),
			],
			[
				"gbfs.bluebikes.com",
				() =>
					ok({
						data: {
							stations: [
								{
									station_id: "b1",
									name: "Salem MBTA",
									lat: 42.52,
									lon: -70.89,
									capacity: 20,
								},
							],
						},
					}),
			],
			[
				"tor.publicbikesystem.net",
				() =>
					ok({
						data: {
							stations: [
								{
									station_id: "7000",
									name: "Fort York",
									lat: 43.63,
									lon: -79.39,
									capacity: 47,
								},
							],
						},
					}),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('gbfs-blue','gbfs-toronto') ORDER BY id",
		);
		assert.ok(rows.some((x) => x.id.startsWith("gbfs-blue:b1")));
		assert.ok(rows.some((x) => x.id.startsWith("gbfs-toronto:7000")));
	});
});

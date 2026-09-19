// Collector contract tests, transit-tfl: TfL arrivals boards + bike + road + status.
// Consolidated from collectors-batch36/37/38/40 files (per-collector refactor, Phase 1).
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

describe("transit tfl-bike + tfl-road", () => {
	it("stores bike docks and road disruptions", async () => {
		stub([
			["transport.opendata.ch", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["api.tfl.gov.uk/AirQuality", () => ok({}, 500)],
			["Line/Mode/tube/Disruption", () => ok([], 500)],
			["api-v3.mbta.com", () => ok({ data: [] }, 500)],
			["TransitView", () => ok({ bus: [] }, 500)],
			["TrainView", () => ok([], 500)],
			["irail.be", () => ok({ departures: { departure: [] } }, 500)],
			["rata.digitraffic.fi", () => ok([], 500)],
			[
				"BikePoint",
				() =>
					ok(
						Array.from({ length: 54 }, (_, i) => ({
							id: `BikePoints_${i + 1}`,
							commonName: i === 53 ? "Empty Dock" : `Dock ${i + 1}`,
							lat: 51.5 + i * 0.001,
							lon: -0.12,
							additionalProperties: [
								{ key: "NbBikes", value: i === 53 ? "0" : "9" },
								{ key: "NbDocks", value: "20" },
							],
						})),
					),
			],
			[
				"Road/A2/Disruption",
				() =>
					ok([
						{
							id: "TIMS-1",
							comments: "Bus lane closed",
							severity: "Minimal",
							point: "[-0.088441,51.494289]",
							hasClosures: true,
							startDateTime: "2026-04-30T08:55:00Z",
						},
					]),
			],
			["Road/A3/Disruption", () => ok([], 500)],
			["Road/A4/Disruption", () => ok([], 500)],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const bikes = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='tfl-bike' ORDER BY id",
		);
		assert.equal(bikes.length, 2); // sampler keeps every 53rd row: idx 0 + 53
		const roads = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='tfl-road'",
		);
		assert.deepEqual(
			roads.map((x) => x.id),
			["tflroad:TIMS-1"],
		);
	});
});

describe("transit tfl-arr", () => {
	it("stores Baker Street arrival rows", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
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
			[
				"StopPoint/940GZZLUBST/Arrivals",
				() =>
					ok([
						{
							id: "1511303273",
							lineName: "Bakerloo",
							platformName: "Southbound - Platform 8",
							destinationName: "Elephant & Castle Underground Station",
							expectedArrival: "2026-09-16T14:07:16Z",
							timeToStation: 451,
							vehicleId: "201",
						},
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='tfl-arr'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["tflarr:1511303273"],
		);
	});
});

describe("transit tfl-arr-kx + swiss BE-GE", () => {
	it("stores KX arrivals and Bern-Geneva journeys", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["divvybikes.com", () => ok({}, 500)],
			["capitalbikeshare.com", () => ok({}, 500)],
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
			["from=Zurich", () => ok({ connections: [] }, 500)],
			[
				"from=Bern",
				() =>
					ok({
						connections: [
							{
								from: { departure: "2026-09-16T19:04:00+02:00" },
								to: { arrival: "2026-09-16T21:05:00+02:00" },
								duration: "00d02:01:00",
								transfers: 0,
								sections: [{ journey: { name: "002532", category: "IC" } }],
							},
						],
					}),
			],
			["StopPoint/940GZZLUBST/Arrivals", () => ok([], 500)],
			[
				"StopPoint/940GZZLUKSX/Arrivals",
				() =>
					ok([
						{
							id: "202451412",
							lineName: "Northern",
							platformName: "Platform 1",
							destinationName: "Morden",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 300,
							vehicleId: "200",
						},
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const kx = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='tfl-arr-kx'",
		);
		assert.deepEqual(
			kx.map((x) => x.id),
			["tflarrkx:202451412"],
		);
		const ch = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='swiss-conn' AND id LIKE 'swissconn:BE-GE%'",
		);
		assert.equal(ch.length, 1);
	});
});

describe("transit tfl-arr-eus + swiss GE-LS", () => {
	it("stores Euston arrivals and Geneva-Lausanne journeys", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["divvybikes.com", () => ok({}, 500)],
			["capitalbikeshare.com", () => ok({}, 500)],
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
			["from=Zurich", () => ok({ connections: [] }, 500)],
			["from=Bern", () => ok({ connections: [] }, 500)],
			[
				"from=Geneva",
				() =>
					ok({
						connections: [
							{
								from: { departure: "2026-09-16T18:00:00+02:00" },
								to: { arrival: "2026-09-16T18:35:00+02:00" },
								duration: "00d00:35:00",
								transfers: 0,
								sections: [{ journey: { name: "001122", category: "IR" } }],
							},
						],
					}),
			],
			["StopPoint/940GZZLUBST/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUKSX/Arrivals", () => ok([], 500)],
			[
				"StopPoint/940GZZLUEUS/Arrivals",
				() =>
					ok([
						{
							id: "-774693282",
							lineName: "Northern",
							platformName: "Platform 2",
							destinationName: "Morden",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 300,
							vehicleId: "002",
						},
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const eus = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='tfl-arr-eus'",
		);
		assert.deepEqual(
			eus.map((x) => x.id),
			["tflarreus:-774693282"],
		);
		const ch = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='swiss-conn' AND id LIKE 'swissconn:GE-LS%'",
		);
		assert.equal(ch.length, 1);
	});
});

describe("transit tfl-status + irail-conn", () => {
	it("stores line statuses and Brussels-Antwerp journeys", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["divvybikes.com", () => ok({}, 500)],
			["capitalbikeshare.com", () => ok({}, 500)],
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
			["rata.digitraffic.fi", () => ok([], 500)],
			["from=Zurich", () => ok({ connections: [] }, 500)],
			["from=Bern", () => ok({ connections: [] }, 500)],
			["from=Geneva", () => ok({ connections: [] }, 500)],
			["from=Lausanne", () => ok({ connections: [] }, 500)],
			["StopPoint/940GZZLUBST/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUKSX/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUEUS/Arrivals", () => ok([], 500)],
			[
				"Line/victoria,central,jubilee,piccadilly,northern,bakerloo/Status",
				() =>
					ok([
						{
							id: "victoria",
							name: "Victoria",
							lineStatuses: [{ statusSeverityDescription: "Good Service" }],
						},
						{
							id: "central",
							name: "Central",
							lineStatuses: [{ statusSeverityDescription: "Severe Delays" }],
						},
					]),
			],
			[
				"irail.be/connections",
				() =>
					ok({
						connection: [
							{
								departure: {
									time: "1789584600",
									delay: "0",
									platform: "19",
									vehicle: "BE.NMBS.IC2019",
								},
								arrival: { time: "1789587360" },
								duration: 2760,
							},
						],
					}),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const st = await query<{ id: string; severity: string }[]>(
			"SELECT id, severity FROM events WHERE source='tfl-status' ORDER BY id",
		);
		assert.equal(st.length, 2);
		assert.ok(st.some((x) => x.severity === "watch")); // central severe
		const ic = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='irail-conn'",
		);
		assert.equal(ic.length, 1);
	});
});

describe("transit tfl-arr-gpk", () => {
	it("stores Green Park arrival rows", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["divvybikes.com", () => ok({}, 500)],
			["capitalbikeshare.com", () => ok({}, 500)],
			["gbfs.bluebikes.com", () => ok({}, 500)],
			["tor.publicbikesystem.net", () => ok({}, 500)],
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
				"StopPoint/940GZZLUGPK/Arrivals",
				() =>
					ok([
						{
							id: "1937151122",
							lineName: "Piccadilly",
							platformName: "Eastbound - Platform 2",
							destinationName: "Cockfosters",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 240,
							vehicleId: "300",
						},
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='tfl-arr-gpk'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["tflarrgpk:1937151122"],
		);
	});
});

describe("transit tfl-arr-pac + tfl-arr-vic", () => {
	it("stores Paddington and Victoria arrival rows", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["divvybikes.com", () => ok({}, 500)],
			["capitalbikeshare.com", () => ok({}, 500)],
			["gbfs.bluebikes.com", () => ok({}, 500)],
			["tor.publicbikesystem.net", () => ok({}, 500)],
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
			["StopPoint/940GZZLUGPK/Arrivals", () => ok([], 500)],
			[
				"victoria,central,jubilee,piccadilly,northern,bakerloo/Status",
				() => ok([], 500),
			],
			[
				"StopPoint/940GZZLUPAC/Arrivals",
				() =>
					ok([
						{
							id: "-768156306",
							lineName: "Bakerloo",
							platformName: "Platform 1",
							destinationName: "Elephant & Castle",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 200,
							vehicleId: "201",
						},
					]),
			],
			[
				"StopPoint/940GZZLUVIC/Arrivals",
				() =>
					ok([
						{
							id: "-306046",
							lineName: "Victoria",
							platformName: "Platform 3",
							destinationName: "Brixton",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 180,
							vehicleId: "204",
						},
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source IN ('tfl-arr-pac','tfl-arr-vic') ORDER BY id",
		);
		assert.equal(rows.length, 2);
		assert.ok(rows.some((x) => x.id.startsWith("tflarrpac:")));
		assert.ok(rows.some((x) => x.id.startsWith("tflarrvic:")));
	});
});

describe("transit tfl-arr-ovl + tfl-arr-hsc", () => {
	it("stores Oval and High Street Ken arrival rows", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["divvybikes.com", () => ok({}, 500)],
			["capitalbikeshare.com", () => ok({}, 500)],
			["gbfs.bluebikes.com", () => ok({}, 500)],
			["tor.publicbikesystem.net", () => ok({}, 500)],
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
			["StopPoint/940GZZLUGPK/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUPAC/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUVIC/Arrivals", () => ok([], 500)],
			[
				"victoria,central,jubilee,piccadilly,northern,bakerloo/Status",
				() => ok([], 500),
			],
			[
				"StopPoint/940GZZLUOVL/Arrivals",
				() =>
					ok([
						{
							id: "-835734729",
							lineName: "Northern",
							platformName: "Platform 1",
							destinationName: "High Barnet",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 300,
							vehicleId: "012",
						},
					]),
			],
			[
				"StopPoint/940GZZLUHSC/Arrivals",
				() =>
					ok([
						{
							id: "470438422",
							lineName: "Circle",
							platformName: "Platform 1",
							destinationName: "Hammersmith",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 240,
							vehicleId: "210",
						},
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source IN ('tfl-arr-ovl','tfl-arr-hsc') ORDER BY id",
		);
		assert.equal(rows.length, 2);
		assert.ok(rows.some((x) => x.id.startsWith("tflarrovl:")));
		assert.ok(rows.some((x) => x.id.startsWith("tflarrhsc:")));
	});
});

describe("transit tfl-arr-wlo + tfl-arr-lnb", () => {
	it("stores Waterloo and London Bridge arrival rows", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["divvybikes.com", () => ok({}, 500)],
			["capitalbikeshare.com", () => ok({}, 500)],
			["gbfs.bluebikes.com", () => ok({}, 500)],
			["tor.publicbikesystem.net", () => ok({}, 500)],
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
			["from=Fribourg", () => ok({ connections: [] }, 500)],
			["StopPoint/940GZZLUBST/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUKSX/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUEUS/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUGPK/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUPAC/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUVIC/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUOVL/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUHSC/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUSTD/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUCGT/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLULVT/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUEBY/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUHBN/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUBND/Arrivals", () => ok([], 500)],
			[
				"victoria,central,jubilee,piccadilly,northern,bakerloo/Status",
				() => ok([], 500),
			],
			[
				"StopPoint/940GZZLUWLO/Arrivals",
				() =>
					ok([
						{
							id: "1262783905",
							lineName: "Bakerloo",
							platformName: "Southbound - Platform 4",
							destinationName: "Elephant & Castle",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 139,
							vehicleId: "5D69",
						},
					]),
			],
			[
				"StopPoint/940GZZLULNB/Arrivals",
				() =>
					ok([
						{
							id: "-886179302",
							lineName: "Jubilee",
							platformName: "Eastbound - Platform 4",
							destinationName: "Stratford",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 210,
							vehicleId: "360",
						},
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source IN ('tfl-arr-wlo','tfl-arr-lnb') ORDER BY id",
		);
		assert.equal(rows.length, 2);
		assert.ok(rows.some((x) => x.id.startsWith("tflarrwlo:")));
		assert.ok(rows.some((x) => x.id.startsWith("tflarrlnb:")));
	});
});

describe("transit tfl-arr-std + tfl-arr-cgt + tfl-arr-lvt", () => {
	it("stores Stratford, Canning Town and Liverpool St arrival rows", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["divvybikes.com", () => ok({}, 500)],
			["capitalbikeshare.com", () => ok({}, 500)],
			["gbfs.bluebikes.com", () => ok({}, 500)],
			["tor.publicbikesystem.net", () => ok({}, 500)],
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
			["from=Fribourg", () => ok({ connections: [] }, 500)],
			["StopPoint/940GZZLUBST/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUKSX/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUEUS/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUGPK/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUPAC/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUVIC/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUOVL/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUHSC/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUWLO/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLULNB/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUEBY/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUHBN/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUBND/Arrivals", () => ok([], 500)],
			[
				"victoria,central,jubilee,piccadilly,northern,bakerloo/Status",
				() => ok([], 500),
			],
			[
				"StopPoint/940GZZLUSTD/Arrivals",
				() =>
					ok([
						{
							id: "1001",
							lineName: "Central",
							platformName: "Eastbound - Platform 1",
							destinationName: "Epping",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 120,
							vehicleId: "101",
						},
					]),
			],
			[
				"StopPoint/940GZZLUCGT/Arrivals",
				() =>
					ok([
						{
							id: "1002",
							lineName: "Jubilee",
							platformName: "Westbound - Platform 2",
							destinationName: "Stanmore",
							expectedArrival: "2026-09-16T18:01:00Z",
							timeToStation: 180,
							vehicleId: "102",
						},
					]),
			],
			[
				"StopPoint/940GZZLULVT/Arrivals",
				() =>
					ok([
						{
							id: "1003",
							lineName: "Central",
							platformName: "Westbound - Platform 1",
							destinationName: "White City",
							expectedArrival: "2026-09-16T18:02:00Z",
							timeToStation: 240,
							vehicleId: "103",
						},
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source IN ('tfl-arr-std','tfl-arr-cgt','tfl-arr-lvt') ORDER BY id",
		);
		assert.equal(rows.length, 3);
		assert.ok(rows.some((x) => x.id.startsWith("tflarrstd:")));
		assert.ok(rows.some((x) => x.id.startsWith("tflarrcgt:")));
		assert.ok(rows.some((x) => x.id.startsWith("tflarrlvt:")));
	});
});

describe("transit tfl-arr-eby + tfl-arr-hbn + tfl-arr-bnd", () => {
	it("stores Ealing Broadway, Holborn and Bond St arrival rows", async () => {
		stub([
			["transport.opendata.ch/v1/stationboard", () => ok({}, 500)],
			["data.sncf.com", () => ok({}, 500)],
			["svc.metrotransit.org", () => ok([], 500)],
			["gbfs.citibikenyc.com", () => ok({}, 500)],
			["divvybikes.com", () => ok({}, 500)],
			["capitalbikeshare.com", () => ok({}, 500)],
			["gbfs.bluebikes.com", () => ok({}, 500)],
			["tor.publicbikesystem.net", () => ok({}, 500)],
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
			["from=Fribourg", () => ok({ connections: [] }, 500)],
			["StopPoint/940GZZLUBST/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUKSX/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUEUS/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUGPK/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUPAC/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUVIC/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUOVL/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUHSC/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUWLO/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLULNB/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUSTD/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUCGT/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLULVT/Arrivals", () => ok([], 500)],
			[
				"victoria,central,jubilee,piccadilly,northern,bakerloo/Status",
				() => ok([], 500),
			],
			[
				"StopPoint/940GZZLUEBY/Arrivals",
				() =>
					ok([
						{
							id: "2001",
							lineName: "Central",
							platformName: "Eastbound - Platform 1",
							destinationName: "Epping",
							expectedArrival: "2026-09-16T18:00:00Z",
							timeToStation: 300,
							vehicleId: "201",
						},
					]),
			],
			[
				"StopPoint/940GZZLUHBN/Arrivals",
				() =>
					ok([
						{
							id: "2002",
							lineName: "Central",
							platformName: "Eastbound - Platform 2",
							destinationName: "Hainault",
							expectedArrival: "2026-09-16T18:01:00Z",
							timeToStation: 200,
							vehicleId: "202",
						},
					]),
			],
			[
				"StopPoint/940GZZLUBND/Arrivals",
				() =>
					ok([
						{
							id: "2003",
							lineName: "Central",
							platformName: "Westbound - Platform 1",
							destinationName: "White City",
							expectedArrival: "2026-09-16T18:02:00Z",
							timeToStation: 619,
							vehicleId: "002",
						},
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source IN ('tfl-arr-eby','tfl-arr-hbn','tfl-arr-bnd') ORDER BY id",
		);
		assert.equal(rows.length, 3);
		assert.ok(rows.some((x) => x.id.startsWith("tflarreby:")));
		assert.ok(rows.some((x) => x.id.startsWith("tflarrhbn:")));
		assert.ok(rows.some((x) => x.id.startsWith("tflarrbnd:")));
	});
});

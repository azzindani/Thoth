// Collector contract tests, transit-ch: Swiss/French/Belgian rail legs.
// Consolidated from collectors-batch24/36/37/38 files (per-collector refactor, Phase 1).
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

describe("transit", () => {
	it("swiss + sncf + metrotransit store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("transport.opendata.ch/v1/stationboard"))
				return ok({
					stationboard: [
						{
							name: "IC 1",
							to: "St. Gallen",
							stop: { departure: "2026-09-16T05:37:00+0200", delay: 2 },
						},
					],
				});
			if (u.includes("data.sncf.com"))
				return ok({
					results: [
						{
							nom: "Paris Nord",
							libellecourt: "PNO",
							position_geographique: { lat: 48.88, lon: 2.35 },
						},
					],
				});
			if (u.includes("svc.metrotransit.org"))
				return ok([{ route_id: "901", route_label: "METRO Blue Line" }]);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await transit();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('swiss-rail','sncf','metrotransit')",
		);
		assert.ok(rows.length >= 3);
	});
});

describe("transit irail + digitraffic", () => {
	it("stores Brussels departures and Helsinki trains", async () => {
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
			[
				"irail.be",
				() =>
					ok({
						station: "Brussels-South/Brussels-Midi",
						departures: {
							departure: [
								{
									station: "Aalst",
									time: "1789556520",
									delay: "60",
									platform: "8",
									vehicle: "BE.NMBS.S102063",
									canceled: "0",
								},
							],
						},
					}),
			],
			[
				"rata.digitraffic.fi",
				() =>
					ok([
						{
							departureDate: "2026-09-16",
							trainNumber: 87,
							trainType: "S",
							commuterLineID: "",
							cancelled: false,
							runningCurrently: false,
						},
					]),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const irail = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='irail'",
		);
		assert.equal(irail.length, 1);
		const dt = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='digitraffic' ORDER BY id",
		);
		assert.equal(dt.length, 2); // heartbeat + train row
		assert.ok(
			dt.some((x) => x.id.startsWith("digitraffic:2026-09-16:87")),
			JSON.stringify(dt.map((x) => x.id)),
		);
	});
});

describe("transit swiss LS-GE", () => {
	it("stores Lausanne-Geneva return journeys", async () => {
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
			["from=Geneva", () => ok({ connections: [] }, 500)],
			[
				"from=Lausanne",
				() =>
					ok({
						connections: [
							{
								from: { departure: "2026-09-16T20:00:00+02:00" },
								to: { arrival: "2026-09-16T20:51:00+02:00" },
								duration: "00d00:51:00",
								transfers: 0,
								sections: [{ journey: { name: "001111", category: "IR" } }],
							},
						],
					}),
			],
			["StopPoint/940GZZLUBST/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUKSX/Arrivals", () => ok([], 500)],
			["StopPoint/940GZZLUEUS/Arrivals", () => ok([], 500)],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		const ch = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='swiss-conn' AND id LIKE 'swissconn:LS-GE%'",
		);
		assert.equal(ch.length, 1);
	});
});

describe("transit swiss LS-BE", () => {
	it("stores Lausanne-Bern journeys", async () => {
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
			[
				"from=Lausanne",
				() =>
					ok({
						connections: [
							{
								from: { departure: "2026-09-16T18:00:00+02:00" },
								to: { arrival: "2026-09-16T19:05:00+02:00" },
								duration: "00d01:05:00",
								transfers: 0,
								sections: [{ journey: { name: "002244", category: "IC" } }],
							},
						],
					}),
			],
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
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		// NOTE: from=Lausanne stub serves both GE-LS and LS-BE legs (same
		// origin); assert LS-BE id present among swiss-conn rows. Scoped to
		// this tick's departure time — the LS-GE suite shares the same table
		// and origin with a different mocked time.
		const ch = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='swiss-conn' AND id LIKE 'swissconn:LS-BE:2026-09-16T18:00%'",
		);
		assert.equal(ch.length, 1);
	});
});

describe("transit swiss LS-FR + FR-BE", () => {
	it("stores Fribourg corridor journeys", async () => {
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
			[
				"from=Lausanne",
				() =>
					ok({
						connections: [
							{
								from: { departure: "2026-09-16T18:00:00+02:00" },
								to: { arrival: "2026-09-16T18:30:00+02:00" },
								duration: "00d00:30:00",
								transfers: 0,
								sections: [{ journey: { name: "003344", category: "S" } }],
							},
						],
					}),
			],
			[
				"from=Fribourg",
				() =>
					ok({
						connections: [
							{
								from: { departure: "2026-09-16T18:10:00+02:00" },
								to: { arrival: "2026-09-16T18:35:00+02:00" },
								duration: "00d00:25:00",
								transfers: 0,
								sections: [{ journey: { name: "004455", category: "S" } }],
							},
						],
					}),
			],
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
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		// Scoped to this tick's departure times (same reason as LS-BE above —
		// the LS-GE/LS-BE suites share origin + table with other mock times).
		const ch = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='swiss-conn' AND (id LIKE 'swissconn:LS-FR:2026-09-16T18:00%' OR id LIKE 'swissconn:FR-BE:2026-09-16T18:10%')",
		);
		assert.equal(ch.length, 2); // same Lausanne stub serves both legs
	});
});

describe("transit swiss BE-ZH + GE-BE return legs", () => {
	it("stores Bern-Zurich and Geneva-Bern return journeys", async () => {
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
			[
				"from=Bern",
				() =>
					ok({
						connections: [
							{
								from: { departure: "2026-09-16T19:00:00+02:00" },
								to: { arrival: "2026-09-16T19:56:00+02:00" },
								duration: "00d00:56:00",
								transfers: 0,
								sections: [{ journey: { name: "005566", category: "IC" } }],
							},
						],
					}),
			],
			[
				"from=Geneva",
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
			[
				"victoria,central,jubilee,piccadilly,northern,bakerloo/Status",
				() => ok([], 500),
			],
		]);
		const r = await transit();
		assert.equal(r.ok, true);
		// Scoped to this tick's departure times (from=Bern stub serves both
		// BE-GE and BE-ZH legs; from=Geneva serves GE-LS and GE-BE).
		const ch = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='swiss-conn' AND (id LIKE 'swissconn:BE-ZH:2026-09-16T19:00%' OR id LIKE 'swissconn:GE-BE:2026-09-16T19:04%')",
		);
		assert.equal(ch.length, 2);
	});
});

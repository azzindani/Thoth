// Collector contract tests, vatsim: VATSIM pilots + IVAO whazzup.
// New in the per-collector refactor (batch21 file with the original suites was
// deleted in an earlier phase before porting; these suites are written fresh
// from the collector contract, mock-verified, not copied).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as vatsim } from "../src/workers/collectors/vatsim.js";

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

describe("vatsim", () => {
	it("stores airborne pilots, skips grounded", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("data.vatsim.net"))
				return ok({
					general: { connected_clients: 1000 },
					pilots: [
						{
							cid: 123,
							callsign: "DLH123",
							latitude: 50.1,
							longitude: 8.5,
							altitude: 35000,
							groundspeed: 450,
							flight_plan: {
								departure: "EDDF",
								arrival: "KJFK",
								aircraft_short: "B77W",
							},
						},
						{
							cid: 456,
							callsign: " grounded ",
							latitude: 51.5,
							longitude: -0.1,
							altitude: 0,
							groundspeed: 0,
						},
					],
					controllers: [{ callsign: "EDDF_TWR" }],
				});
			if (u.includes("api.ivao.aero")) return ok({}, 500);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await vatsim();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='vatsim' ORDER BY id",
		);
		assert.ok(rows.length >= 1, "airborne pilot stored");
		assert.ok(rows.every((x) => x.id.startsWith("vatsim:")));
	});

	it("ivao leg stores whazzup pilots when vatsim fails", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("data.vatsim.net"))
				return new Response("down", { status: 503 });
			if (u.includes("api.ivao.aero"))
				return ok({
					clients: {
						pilots: [
							{
								callsign: "IVA123",
								lastTrack: {
									latitude: 48.8,
									longitude: 2.3,
									altitude: 30000,
									groundSpeed: 400,
									onGround: false,
								},
								flightPlan: {
									departureId: "LFPG",
									arrivalId: "EGLL",
									aircraftId: "A320",
								},
							},
						],
					},
				});
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await vatsim();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='ivao' ORDER BY id",
		);
		assert.ok(rows.length >= 1, "ivao pilot stored");
		assert.ok(rows.every((x) => x.id.startsWith("ivao:")));
	});
});

// Collector contract tests, vatsim: VATSIM pilots + IVAO whazzup.
// Written fresh in the per-collector refactor from the collector contract
// (the original suites were lost before porting), mock-verified, not copied.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { getLayerSlice, getLayerView } from "../src/db/queries.js";
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
		const rows = await query<{ id: string }>(
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
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='ivao' ORDER BY id",
		);
		assert.ok(rows.length >= 1, "ivao pilot stored");
		assert.ok(rows.every((x) => x.id.startsWith("ivao:")));
	});

	it("keeps one row per callsign and drops pilots that left", async () => {
		const feed = (pilots: { callsign: string; lon: number }[]) =>
			(async (url: unknown) => {
				const u = String(url);
				if (u.includes("data.vatsim.net"))
					return ok({
						pilots: pilots.map((p) => ({
							callsign: p.callsign,
							latitude: 50,
							longitude: p.lon,
							altitude: 30000,
						})),
					});
				return ok({}, 500);
			}) as typeof fetch;
		await query("TRUNCATE events");
		globalThis.fetch = feed([
			{ callsign: "AAA1", lon: 1 },
			{ callsign: "BBB2", lon: 2 },
		]);
		await vatsim();
		globalThis.fetch = feed([{ callsign: "AAA1", lon: 3 }]);
		await vatsim();
		const rows = await query<{ id: string; lon: number }>(
			"SELECT id, ST_X(geom) AS lon FROM events WHERE source='vatsim' ORDER BY id",
		);
		assert.deepEqual(
			rows.map((r) => [r.id, Number(r.lon)]),
			[["vatsim:AAA1", 3]],
		);
	});
});

describe("flights read path", () => {
	it("serves each aircraft once, at its latest fresh position", async () => {
		await query("TRUNCATE events");
		const ins = (id: string, ageMin: number, lon: number) =>
			query(
				`INSERT INTO events(id, ts, source, layer, title, severity, geom)
         VALUES ($1, now() - make_interval(mins => $2::int), 'ivao', 'flights', $1, 'info',
                 ST_SetSRID(ST_MakePoint($3::float, 10), 4326))`,
				[id, ageMin, lon],
			);
		// legacy per-minute snapshots of one callsign, plus a 2-day-old ghost
		await ins("ivao:OLD1:2026-01-01T10:00", 5, 1);
		await ins("ivao:OLD1:2026-01-01T10:05", 1, 2);
		await ins("ivao:GHOST:2026-01-01T09:00", 2 * 24 * 60, 3);
		await ins("adsb:abc123", 3, 4);
		for (const items of [
			await getLayerSlice("flights"),
			(await getLayerView("flights", { z: 2 })).items,
		]) {
			const got = (items as { id: string }[]).map((i) => i.id).sort();
			assert.deepEqual(got, ["adsb:abc123", "ivao:OLD1:2026-01-01T10:05"]);
		}
	});
});

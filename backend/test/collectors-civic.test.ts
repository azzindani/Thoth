// Collector contract tests, civic: 311/crime/traffic. Consolidated from collectors-batch28/33 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as civic } from "../src/workers/collectors/civic.js";

const realFetch = globalThis.fetch;
function ok(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("civic austin", () => {
	it("austintraffic stores geo rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("cityofnewyork.us")) return ok([], 500);
			if (u.includes("cityofchicago.org")) return ok([], 500);
			if (u.includes("data.lacity.org")) return ok([], 500);
			if (u.includes("data.austintexas.gov"))
				return ok([
					{
						traffic_report_id: "abc",
						published_date: "2024-03-06T01:29:39.000Z",
						issue_reported: "Stalled Vehicle",
						traffic_report_status: "ACTIVE",
						address: "E 290 Svrd",
						latitude: "30.32",
						longitude: "-97.70",
					},
				]);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await civic();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='austintraffic'",
		);
		assert.equal(rows.length, 1);
	});
});

describe("civic sf311", () => {
	it("sf311 stores geo rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("cityofnewyork.us")) return ok([], 500);
			if (u.includes("cityofchicago.org")) return ok([], 500);
			if (u.includes("data.lacity.org")) return ok([], 500);
			if (u.includes("data.austintexas.gov")) return ok([], 500);
			if (u.includes("data.sf.gov"))
				return ok([
					{
						service_request_id: "19900052",
						requested_datetime: "2026-09-14T23:44:21.000",
						service_name: "Noise",
						status_description: "Open",
						address: "977 HOWARD ST, SAN FRANCISCO, CA 94103, US",
						lat: "37.78019856099469",
						long: "-122.40655717820106",
					},
				]);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await civic();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='sf311'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["sf311:19900052"],
		);
		const geo = await query<{ lat: number; lon: number }[]>(
			"SELECT ST_Y(geom) AS lat, ST_X(geom) AS lon FROM events WHERE id='sf311:19900052'",
		);
		assert.ok(Math.abs(geo[0].lat - 37.78) < 0.01);
		assert.ok(Math.abs(geo[0].lon + 122.41) < 0.01);
	});
});

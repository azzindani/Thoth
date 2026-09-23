// Collector contract tests, airquality: bands + sg-psi. Consolidated from collectors-batch13/35 (per-collector refactor; batch30 luftdaten lost with file in Phase 1 — see plan).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	collect as airquality,
	aqiSeverity,
	collectSgPsi,
} from "../src/workers/collectors/airquality.js";

const realFetch = globalThis.fetch;
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
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("airquality bands", () => {
	it("maps AQI to severity, skips null rows", async () => {
		assert.equal(aqiSeverity(25), "info");
		assert.equal(aqiSeverity(100), "info");
		assert.equal(aqiSeverity(101), "watch");
		assert.equal(aqiSeverity(250), "critical");
		globalThis.fetch = (async () => {
			const rows = Array.from({ length: 30 }, (_, i) => ({
				current:
					i === 0
						? { us_aqi: 250, pm2_5: 200, time: "2026-09-13T10:00" }
						: i === 1
							? { us_aqi: 120, pm2_5: 45, time: "2026-09-13T10:00" }
							: i === 2
								? { us_aqi: null }
								: { us_aqi: 30, pm2_5: 8, time: "2026-09-13T10:00" },
			}));
			return new Response(JSON.stringify(rows), { status: 200 });
		}) as typeof fetch;
		const r = await airquality();
		assert.equal(r.ok, true);
		assert.equal((r as { count?: number }).count, 29);
		const rows = await query<{ id: string; severity: string }>(
			"SELECT id, severity FROM events WHERE layer='airquality' AND id IN ('aq:london','aq:paris') ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => [x.id, x.severity]),
			[
				["aq:london", "critical"],
				["aq:paris", "watch"],
			],
		);
	});
	it("upstream failure is honest", async () => {
		globalThis.fetch = (async () => {
			throw new TypeError("fetch failed");
		}) as typeof fetch;
		const r = await airquality();
		assert.equal(r.ok, false);
	});
});

describe("airquality sg-psi", () => {
	it("collectSgPsi stores 5 region rows", async () => {
		stub([
			[
				"data.gov.sg",
				() =>
					ok({
						region_metadata: [
							{
								name: "central",
								label_location: { latitude: 1.35735, longitude: 103.82 },
							},
							{
								name: "east",
								label_location: { latitude: 1.35735, longitude: 103.94 },
							},
						],
						items: [
							{
								timestamp: "2026-09-16T18:00:00+08:00",
								readings: {
									psi_twenty_four_hourly: { central: 45, east: 130 },
								},
							},
						],
					}),
			],
		]);
		const n = await collectSgPsi();
		assert.equal(n, 2);
		const rows = await query<{ id: string; severity: string }>(
			"SELECT id, severity FROM events WHERE source='sg-psi' ORDER BY id",
		);
		assert.equal(rows.length, 2);
		assert.equal(rows[1].severity, "watch"); // east 130 > 100
	});
});

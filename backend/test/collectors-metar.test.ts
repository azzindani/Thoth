// Collector contract tests, metar: AWC METAR/TAF.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	collect as metar,
	metarSeverity,
} from "../src/workers/collectors/metar.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("metar/taf", () => {
	it("maps flight categories", () => {
		assert.equal(metarSeverity("LIFR"), "critical");
		assert.equal(metarSeverity("IFR"), "watch");
		assert.equal(metarSeverity("VFR"), "info");
		assert.equal(metarSeverity(null), "info");
	});
	it("collect() stores metar + taf rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("aviationweather.gov/api/data/metar"))
				return new Response(
					JSON.stringify([
						{
							icaoId: "KJFK",
							obsTime: "2026-09-14T12:00:00Z",
							temp: 21,
							fltCat: "VFR",
							lat: 40.64,
							lon: -73.77,
							name: "JFK",
						},
					]),
					{ status: 200 },
				);
			if (u.includes("aviationweather.gov/api/data/taf"))
				return new Response(
					JSON.stringify([
						{
							icaoId: "KJFK",
							validTimeFrom: 1757851200,
							rawTAF: "TAF KJFK ...",
						},
					]),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await metar();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE layer='metar'",
		);
		assert.equal(rows.length, 2);
	});
});

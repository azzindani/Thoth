// Collector contract tests, solar: SWPC + SILSO. Consolidated from collectors-batch20 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	flareClass,
	collect as solar,
} from "../src/workers/collectors/solar.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("solar", () => {
	it("flareClass maps GOES bands", () => {
		assert.equal(flareClass(3e-4), "X");
		assert.equal(flareClass(2e-5), "M");
		assert.equal(flareClass(5e-6), "C");
		assert.equal(flareClass(2e-7), "B");
		assert.equal(flareClass(1e-8), "A");
	});
	it("collect() stores aurora + xray + f107 rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("ovation_aurora"))
				return new Response(
					JSON.stringify({
						"Observation Time": "2026-09-15T08:23:00Z",
						coordinates: [[0, -80, 30]],
					}),
					{ status: 200 },
				);
			if (u.includes("xrays-7-day"))
				return new Response(
					JSON.stringify([
						{
							time_tag: "2026-09-15T08:00:00Z",
							flux: 3e-6,
							energy: "0.1-0.8nm",
						},
					]),
					{ status: 200 },
				);
			if (u.includes("f107_cm_flux"))
				return new Response(
					JSON.stringify([{ time_tag: "2026-09-15T20:00:00", flux: 126 }]),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await solar();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('swpc-aurora','swpc-xray','swpc-f107')",
		);
		assert.equal(rows.length, 3);
	});
});

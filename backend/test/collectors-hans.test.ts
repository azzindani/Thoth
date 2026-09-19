// Collector contract tests, hans: USGS HANS volcano alerts.
// New in the per-collector refactor (batch21 file with the original suite was
// deleted in an earlier phase before porting; this suite is written fresh
// from the collector contract, mock-verified, not copied).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	collect as hans,
	hansSeverity,
} from "../src/workers/collectors/hans.js";

const realFetch = globalThis.fetch;

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("hans", () => {
	it("severity maps color/level words", () => {
		assert.equal(hansSeverity("RED", "WARNING"), "critical");
		assert.equal(hansSeverity("ORANGE", "WATCH"), "watch");
		assert.equal(hansSeverity("YELLOW", "ADVISORY"), "watch");
		assert.equal(hansSeverity("GREEN", "NORMAL"), "info");
		assert.equal(hansSeverity(null, null), "info");
	});

	it("stores monitored volcanoes with severity", async () => {
		globalThis.fetch = (async (url: unknown) => {
			assert.match(String(url), /volcanoes\.usgs\.gov/);
			return new Response(
				JSON.stringify([
					{
						volcano_name: "Kilauea",
						vnum: "332010",
						alert_level: "WATCH",
						color_code: "ORANGE",
						obs_abbr: "HVO",
						notice_url: "https://example.test/kilauea",
					},
					{
						volcano_name: "Quiet Cone",
						vnum: null,
						alert_level: "NORMAL",
						color_code: "GREEN",
						obs_abbr: "AVO",
					},
					{ alert_level: "NORMAL", color_code: "GREEN" },
				]),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await hans();
		assert.equal(r.ok, true);
		assert.equal(r.count, 2, "nameless volcano skipped");
		const rows = await query<{ id: string; severity: string }[]>(
			"SELECT id, severity FROM events WHERE source='hans' ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => [x.id, x.severity]),
			[
				["hans:332010", "watch"],
				["hans:Quiet-Cone", "info"],
			],
		);
	});
});

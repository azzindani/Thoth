// Collector contract tests, drones: Neptun. Consolidated from collectors-batch4 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as drones } from "../src/workers/collectors/drones.js";

const realFetch = globalThis.fetch;
function stub(
	routes: [RegExp, { status?: number; json?: unknown; text?: string }][],
) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [re, r] of routes) {
			if (re.test(u)) {
				if (r.json !== undefined)
					return new Response(JSON.stringify(r.json), {
						status: r.status ?? 200,
					});
				return new Response(r.text ?? "", { status: r.status ?? 200 });
			}
		}
		return new Response("no mock", { status: 500 });
	}) as typeof fetch;
}
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("drones collect()", () => {
	it("raketa tracks go critical", async () => {
		stub([
			[
				/neptun\.in\.ua/,
				{
					json: {
						tracks: [
							{
								track_id: "t1",
								lat: 47,
								lng: 35,
								threat_type: "raketa",
								text: "x",
								place: "P",
								region: "R",
								date: "2026-09-09T10:00:00.000Z",
								confidence_0_100: 80,
							},
						],
					},
				},
			],
		]);
		const r = await drones();
		assert.equal(r.ok, true);
		const rows = await query<{ severity: string }[]>(
			"SELECT severity FROM events WHERE layer='drones'",
		);
		assert.equal(rows[0]?.severity, "critical");
	});
});

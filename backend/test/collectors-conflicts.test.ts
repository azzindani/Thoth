// Collector contract tests, conflicts: zones + severity. Consolidated from collectors-batch4/9 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as conflicts } from "../src/workers/collectors/conflicts.js";

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

describe("conflicts collect()", () => {
	it("empty zones are ok:true with count 0 (legit finding, not outage)", async () => {
		stub([[/earthquake\.usgs\.gov/, { json: { features: [] } }]]);
		const r = await conflicts();
		assert.equal(r.ok, true);
		assert.equal(r.count, 0);
	});
});

describe("conflicts zones", () => {
	it("maps magnitude to severity, skips bad coords, tolerates zone errors", async () => {
		stub([
			[
				/eventtype=explosion/,
				{
					json: {
						features: [
							{
								id: "us1",
								geometry: { coordinates: [30.0, 50.0, 5] },
								properties: {
									mag: 4.2,
									place: "Kyiv region",
									time: 1725800000000,
								},
							},
							{
								id: "us2",
								geometry: { coordinates: [31.0, 49.0, 5] },
								properties: {
									mag: 1.1,
									place: "small pop",
									time: 1725800001000,
								},
							},
							{
								id: "bad",
								geometry: { coordinates: "nowhere" },
								properties: { mag: 9 },
							},
							{
								id: "noc",
								geometry: null,
								properties: { mag: 2 },
							},
						],
					},
				},
			],
			[/eventtype=quarry_blast/, { status: 500 }],
		]);
		const r = await conflicts();
		assert.equal(r.ok, true, "zone errors collected, run stays ok");
		const rows = await query<{ id: string; severity: string }>(
			"SELECT id, severity FROM events WHERE layer='conflicts' ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => [x.id, x.severity]),
			[
				["blast:us1", "critical"],
				["blast:us2", "watch"],
			],
		);
		const h = await query<{ error: string | null }>(
			"SELECT error FROM feed_health WHERE source='usgs-blast'",
		);
		assert.match(String(h[0]?.error), /quarry_blast/);
	});
});

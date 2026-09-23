// Collector contract tests, volcanoes: Smithsonian. Consolidated from collectors-batch4 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as volcanoes } from "../src/workers/collectors/volcanoes.js";

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

describe("volcanoes collect()", () => {
	it("stores WFS volcano points as info reference", async () => {
		stub([
			[
				/volcano\.si\.edu/,
				{
					json: {
						features: [
							{
								geometry: { type: "Point", coordinates: [6.85, 50.17] },
								properties: {
									Volcano_Number: 1,
									Volcano_Name: "Test Field",
									Country: "Germany",
									Primary_Volcano_Type: "field",
									Last_Eruption_Year: 2020,
								},
							},
						],
					},
				},
			],
		]);
		const r = await volcanoes();
		assert.equal(r.ok, true);
		const rows = await query<{ severity: string }>(
			"SELECT severity FROM events WHERE layer='volcanoes'",
		);
		assert.equal(rows[0]?.severity, "info");
	});
});

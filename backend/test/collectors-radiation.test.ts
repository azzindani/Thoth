// Collector contract tests, radiation: Safecast.
// Not covered here: epa-ie (suite lost in the per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as radiation } from "../src/workers/collectors/radiation.js";

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

describe("radiation collect()", () => {
	it("stores recent sensor readings", async () => {
		stub([
			[
				/api\.safecast\.org/,
				{
					json: [
						{
							id: 1,
							value: 33,
							unit: "cpm",
							latitude: 36.3,
							longitude: 139.1,
							captured_at: "2026-09-09T10:00:00.000Z",
							location_name: null,
						},
					],
				},
			],
		]);
		const r = await radiation();
		assert.equal(r.ok, true);
		assert.equal(r.count, 1);
	});
});

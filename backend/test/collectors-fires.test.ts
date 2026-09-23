// Collector contract tests, fires: FIRMS. Consolidated from collectors-batch1 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as fires } from "../src/workers/collectors/fires.js";

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

describe("fires collect()", () => {
	it("parses FIRMS CSV", async () => {
		stub([
			[
				/firms\.modaps/,
				{
					text: "latitude,longitude,bright_ti4,acq_date\n34.1,-118.2,320.5,2026-09-09",
				},
			],
		]);
		const r = await fires();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE layer='fires'",
		);
		assert.ok(rows.length >= 1, "fire stored");
	});
});

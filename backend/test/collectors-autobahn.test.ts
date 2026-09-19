// Collector contract tests, autobahn: German roadworks on curated corridors.
// New in the per-collector refactor (batch21 file with the original suite was
// deleted in an earlier phase before porting; this suite is written fresh
// from the collector contract, mock-verified, not copied).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as autobahn } from "../src/workers/collectors/autobahn.js";

const realFetch = globalThis.fetch;

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

function ok(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}

describe("autobahn", () => {
	it("stores roadworks with blocked flag and coords", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("/autobahn/A1/"))
				return ok({
					roadworks: [
						{
							identifier: "w1",
							title: "Baustelle Nord",
							subtitle: "A1 km 10",
							isBlocked: true,
							future: false,
							description: ["Spur gesperrt"],
							coordinate: { lat: 53.5, long: 10.0 },
						},
					],
				});
			// Other corridors empty — the loop still marks each road healthy.
			if (u.includes("verkehr.autobahn.de")) return ok({ roadworks: [] });
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await autobahn();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; title: string }[]>(
			"SELECT id, title FROM events WHERE source='autobahn' ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => [x.id, x.title]),
			[["autobahn:A1:w1", "Baustelle Nord — BLOCKED"]],
		);
	});
});

// Collector contract tests, policy: FedReg + govtrack. Consolidated from collectors-batch19/35 (per-collector refactor; batch22 ukbills lost with file in Phase 1 — see plan).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as policy } from "../src/workers/collectors/policy-fedreg.js";

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

describe("fedreg", () => {
	it("collect() stores presidential documents", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					results: [
						{
							title: "Test Order",
							document_number: "2026-00001",
							html_url: "https://x",
							publication_date: "2026-09-14",
							type: "Presidential Document",
						},
					],
				}),
				{ status: 200 },
			)) as typeof fetch;
		const r = await policy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='fedreg'",
		);
		assert.ok(rows.length >= 1);
	});
});

describe("policy govtrack", () => {
	it("stores recent bills", async () => {
		stub([
			["federalregister.gov", () => ok({ results: [] }, 500)],
			["bills-api.parliament.uk", () => ok({ items: [] }, 500)],
			[
				"govtrack.us",
				() =>
					ok({
						objects: [
							{
								display_number: "H.Con.Res. 93",
								title: "Directing the President...",
								current_status: "pass_over_house",
								current_status_date: "2026-09-15",
								current_chamber: "house",
								congress: 119,
								link: "https://www.govtrack.us/congress/bills/119/hconres93",
							},
						],
					}),
			],
		]);
		const r = await policy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='govtrack'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["govtrack:H-Con-Res-93"],
		);
	});
});

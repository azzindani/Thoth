// Collector contract tests, litwatch: trials/PubMed/jobs.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	collect as litwatch,
	nhcEmptySeason,
} from "../src/workers/collectors/litwatch.js";

const realFetch = globalThis.fetch;
function ok(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("litwatch", () => {
	it("nhcEmptySeason detects quiet wallets", () => {
		assert.equal(nhcEmptySeason("<title>No current storm</title>"), true);
		assert.equal(nhcEmptySeason("<title>Hurricane X</title>"), false);
	});
	it("collect() stores trials + pubmed + hn rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("clinicaltrials.gov"))
				return new Response(
					JSON.stringify({
						studies: [
							{
								protocolSection: {
									identificationModule: {
										nctId: "NCT1",
										briefTitle: "Ebola vax",
										organization: { fullName: "Org" },
									},
									statusModule: { overallStatus: "RECRUITING" },
								},
							},
						],
					}),
					{ status: 200 },
				);
			if (u.includes("eutils.ncbi.nlm.nih.gov"))
				return new Response(
					JSON.stringify({ esearchresult: { count: "13434", idlist: ["1"] } }),
					{ status: 200 },
				);
			if (u.includes("hn.algolia.com"))
				return new Response(
					JSON.stringify({
						hits: [
							{
								objectID: "1",
								title: "Drone story",
								url: "https://x",
								points: 100,
								created_at: "2026-09-14T00:00:00Z",
							},
						],
					}),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await litwatch();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('trials','pubmed','hn')",
		);
		assert.ok(rows.length >= 3);
	});
});

describe("litwatch medrxiv", () => {
	it("medrxiv stores filtered preprints", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("clinicaltrials.gov")) return ok({ studies: [] }, 500);
			if (u.includes("eutils.ncbi.nlm.nih.gov")) return ok({}, 500);
			if (u.includes("hn.algolia.com")) return ok({ hits: [] }, 500);
			if (u.includes("api.stackexchange.com")) return ok({ items: [] }, 500);
			if (u.includes("doaj.org")) return ok({ results: [] }, 500);
			if (u.includes("api.datacite.org")) return ok({ data: [] }, 500);
			if (u.includes("api.medrxiv.org"))
				return ok({
					collection: [
						{
							doi: "10.1/ebola-test",
							title: "Ebola outbreak model",
							date: "2026-09-01",
							category: "epidemiology",
						},
					],
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await litwatch();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='medrxiv'",
		);
		assert.equal(rows.length, 1);
	});
});

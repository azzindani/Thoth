// Collector contract tests, research: OpenAlex/Crossref + topics.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as research } from "../src/workers/collectors/research.js";

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

describe("research", () => {
	it("collect() stores openalex rows, survives arxiv 429", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.openalex.org"))
				return new Response(
					JSON.stringify({
						results: [
							{
								id: "https://openalex.org/W1",
								title: "Drone swarms",
								doi: "10.1/x",
								publication_date: "2026-01-01",
								cited_by_count: 3,
								authorships: [],
								primary_location: { landing_page_url: "https://x" },
							},
						],
					}),
					{ status: 200 },
				);
			if (u.includes("api.crossref.org"))
				return new Response(JSON.stringify({ message: { items: [] } }), {
					status: 200,
				});
			if (u.includes("europepmc"))
				return new Response(JSON.stringify({ resultList: { result: [] } }), {
					status: 200,
				});
			if (u.includes("export.arxiv.org"))
				return new Response("rate limited", { status: 429 });
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await research();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='openalex'",
		);
		assert.ok(rows.length >= 1);
	});
});

describe("research openaire", () => {
	it("openaire parses OAF metadata", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("openalex.org")) return ok({ results: [] });
			if (u.includes("api.crossref.org")) return ok({ message: { items: [] } });
			if (u.includes("europepmc.org"))
				return ok({ resultList: { result: [] } });
			if (u.includes("export.arxiv.org")) return ok("<feed></feed>");
			if (u.includes("zenodo.org")) return ok({ hits: { hits: [] } });
			if (u.includes("archives-ouvertes.fr"))
				return ok({ response: { docs: [] } });
			if (u.includes("inspirehep.net")) return ok({ hits: { hits: [] } });
			if (u.includes("api.medrxiv.org")) return ok({ collection: [] });
			if (u.includes("api.core.ac.uk")) return ok({ results: [] });
			if (u.includes("api.figshare.com")) return ok([]);
			if (u.includes("api.openaire.eu"))
				return ok({
					response: {
						results: {
							result: [
								{
									header: { "dri:objIdentifier": { $: "doi_dedup___::abc" } },
									metadata: {
										"oaf:entity": {
											"oaf:result": {
												title: [{ $: "Ebola test" }],
												dateofacceptance: { $: "2015-03-01" },
												pid: [{ $: "10.1/x" }],
											},
										},
									},
								},
							],
						},
					},
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await research();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; title: string }>(
			"SELECT id, title FROM events WHERE source='openaire'",
		);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].title, "Ebola test");
	});
});

describe("research yahoo-search", () => {
	it("stores ticker master rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("query2.finance.yahoo.com/v1/finance/search"))
				return new Response(
					JSON.stringify({
						quotes: [
							{
								symbol: "AAPL",
								shortname: "Apple Inc.",
								exchDisp: "NASDAQ",
								sectorDisp: "Technology",
								industry: "Consumer Electronics",
								quoteType: "EQUITY",
							},
						],
					}),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await research();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='yahoo-search' ORDER BY id",
		);
		assert.ok(rows.some((x) => x.id === "yseek:AAPL"));
	});
});

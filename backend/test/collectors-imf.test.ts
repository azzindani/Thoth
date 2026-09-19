// Collector contract tests, imf: WEO + CPI + FX + WB. Consolidated from collectors-batch20 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as imf } from "../src/workers/collectors/imf.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("imf", () => {
	it("collect() stores latest-year rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.bls.gov"))
				return new Response("no mock", { status: 500 });
			if (u.includes("bankofcanada.ca"))
				return new Response("no mock", { status: 500 });
			if (u.includes("api.worldbank.org"))
				return new Response("no mock", { status: 500 });
			if (u.includes("api.db.nomics.world"))
				return new Response("no mock", { status: 500 });
			return new Response(
				JSON.stringify({
					values: {
						NGDP_RPCH: { USA: { "2024": 2.8, "2025": 1.9 } },
						PCPIPCH: { USA: { "2024": 3.0 } },
						LUR: { USA: { "2024": 4.1 } },
					},
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await imf();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='imf'",
		);
		assert.ok(rows.length >= 3);
		assert.ok(rows.some((x) => x.id === "imf:NGDP_RPCH:USA:2025"));
	});
	it("worldbank-src leg stores debt + growth rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("V2/sources/2"))
				return new Response(
					JSON.stringify({
						source: {
							data: [
								{
									variable: [
										{ value: "United States" },
										{ value: "Central government debt" },
										{ id: "YR2024", value: "2024" },
									],
									value: 115.7,
								},
								{
									variable: [
										{ value: "United States" },
										{ value: "Central government debt" },
										{ id: "YR2023", value: "2023" },
									],
									value: 114.7,
								},
							],
						},
					}),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await imf();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; title: string }[]>(
			"SELECT id, title FROM events WHERE source='worldbank-src'",
		);
		assert.equal(rows.length, 4);
		assert.ok(rows.some((x) => x.id === "wbs:GC.DOD.TOTL.GD.ZS:USA:2024"));
		assert.ok(rows.some((x) => x.id === "wbs:GC.DOD.TOTL.GD.ZS:GBR:2024"));
		assert.ok(rows.some((x) => x.title.includes("govt debt 115.7")));
	});
	it("dbnomics-bea leg stores US GDP row", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.db.nomics.world"))
				return new Response(
					JSON.stringify({
						series: {
							docs: [
								{
									series_code: "A006RC-A",
									series_name:
										"Gross private domestic investment (line 7) - Annually",
									period: ["2024", "2025"],
									value: [5023712.0, 5458629.0],
								},
								{
									series_code: "A001RC-A",
									series_name: "Gross domestic product (line 1) - Annually",
									period: ["2024", "2025"],
									value: [29720000.0, 30760000.0],
								},
							],
						},
					}),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await imf();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='dbnomics-bea'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["dbn:bea-gdp:2025"],
		);
	});
});

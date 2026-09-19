// Collector contract tests, quakesnz: GeoNet. Consolidated from collectors-batch20 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as nz } from "../src/workers/collectors/quakes-nz.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("quakes-nz", () => {
	it("collect() stores geonet rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("/volcano/val"))
				return new Response(JSON.stringify({ features: [] }), { status: 200 });
			if (u.includes("/news/geonet"))
				return new Response(JSON.stringify({ feed: [] }), { status: 200 });
			return new Response(
				JSON.stringify({
					features: [
						{
							geometry: { coordinates: [174.2, -40.3] },
							properties: {
								publicID: "2026p694453",
								time: "2026-09-14T22:44:48Z",
								magnitude: 4.8,
								locality: "Waverley",
							},
						},
					],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await nz();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='geonet'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["geonet:2026p694453"],
		);
	});
	it("volcano VAL + news legs store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("/volcano/val"))
				return new Response(
					JSON.stringify({
						features: [
							{
								geometry: { coordinates: [175.896, -38.784] },
								properties: {
									volcanoID: "taupo",
									volcanoTitle: "Taupo",
									acc: "Green",
									level: 0,
									activity: "No volcanic unrest.",
								},
							},
						],
					}),
					{ status: 200 },
				);
			if (u.includes("/news/geonet"))
				return new Response(
					JSON.stringify({
						feed: [
							{
								title: "Eruption update: test cone",
								type: "Volcanic Activity Bulletin",
								tag: "VAB",
								published: "2026-09-14T00:12:00Z",
								link: "https://www.geonet.org.nz/news/1xTESTabc123456789012",
							},
						],
					}),
					{ status: 200 },
				);
			return new Response(JSON.stringify({ features: [] }), { status: 200 });
		}) as typeof fetch;
		const r = await nz();
		assert.equal(r.ok, true);
		const val = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='geonet-val'",
		);
		assert.deepEqual(
			val.map((x) => x.id),
			["geonetval:taupo"],
		);
		const news = await query<{ id: string; severity: string }[]>(
			"SELECT id, severity FROM events WHERE source='geonet-news'",
		);
		assert.equal(news.length, 1);
		assert.equal(news[0].severity, "watch");
	});
});

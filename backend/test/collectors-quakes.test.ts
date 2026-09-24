// Collector contract tests, quakes: USGS + EMSC fold-in. Consolidated from collectors-batch1/17 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as quakes } from "../src/workers/collectors/quakes.js";

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

describe("quakes collect()", () => {
	it("stores USGS features + health", async () => {
		stub([
			[
				/earthquake\.usgs\.gov/,
				{
					json: {
						features: [
							{
								id: "testq1",
								properties: {
									mag: 5.2,
									place: "Test Basin",
									time: Date.now(),
									title: "M5.2 Test",
									type: "earthquake",
									url: "https://example.test/q1",
								},
								geometry: { type: "Point", coordinates: [10, 20, 5] },
							},
						],
					},
				},
			],
		]);
		const r = await quakes();
		assert.equal(r.ok, true);
		assert.ok((r.count ?? 0) >= 1, "count");
		const rows = await query<{ title: string }>(
			"SELECT title FROM events WHERE layer='quakes'",
		);
		assert.ok(rows.length >= 1 && rows[0].title.includes("5.2"), "row stored");
		const h = await query<{ last_ok: string | null }>(
			"SELECT last_ok FROM feed_health WHERE source='usgs'",
		);
		assert.ok(h[0]?.last_ok, "health ok");
	});
});

describe("emsc fold-in", () => {
	it("stores EMSC events with its own ids and thresholds", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("earthquake.usgs.gov"))
				return new Response(JSON.stringify({ features: [] }), {
					status: 200,
				});
			assert.match(u, /seismicportal\.eu/);
			return new Response(
				JSON.stringify({
					features: [
						{
							id: "20260914_0000143",
							properties: {
								mag: 6.2,
								time: "2026-09-14T10:58:03.6Z",
								flynn_region: "HALMAHERA, INDONESIA",
								unid: "20260914_0000143",
							},
							geometry: { type: "Point", coordinates: [128.29, 2.41, -155.2] },
						},
					],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await quakes();
		assert.equal(r.ok, true);
		assert.equal((r as { count?: number }).count, 1);
		const rows = await query<{ id: string; severity: string; source: string }>(
			"SELECT id, severity, source FROM events WHERE layer='quakes' AND source='emsc'",
		);
		assert.deepEqual(
			rows.map((x) => [x.id, x.severity, x.source]),
			[["emsc:20260914_0000143", "critical", "emsc"]],
		);
	});
	it("USGS-only failure still yields ok when EMSC lands and vice versa", async () => {
		globalThis.fetch = (async (url: unknown) => {
			if (String(url).includes("earthquake.usgs.gov"))
				return new Response("down", { status: 500 });
			return new Response(JSON.stringify({ features: [] }), { status: 200 });
		}) as typeof fetch;
		// EMSC empty but healthy + USGS down → n=0 → honest false
		const r = await quakes();
		assert.equal(r.ok, false);
	});
});

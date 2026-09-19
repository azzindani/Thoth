// Collector contract tests, disasters: EONET + sentry + geometry + honest-fail. Consolidated from collectors-batch1/9/10/25 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as disasters } from "../src/workers/collectors/disasters.js";

const realFetch = globalThis.fetch;

function ok(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}

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

describe("disasters collect()", () => {
	it("stores EONET events + health", async () => {
		stub([
			[
				/eonet\.gsfc\.nasa\.gov/,
				{
					json: {
						events: [
							{
								id: "EONET_t1",
								title: "Test Cyclone",
								description: null,
								link: null,
								categories: [{ id: "severeStorms", title: "Severe Storms" }],
								geometry: [
									{
										type: "Point",
										coordinates: [100, -10],
										date: "2026-09-09T00:00:00Z",
									},
								],
							},
						],
					},
				},
			],
		]);
		const r = await disasters();
		assert.equal(r.ok, true);
		const rows = await query<{ title: string }[]>(
			"SELECT title FROM events WHERE layer='disasters'",
		);
		assert.ok(
			rows.some((x) => x.title.includes("Test Cyclone")),
			"disaster stored",
		);
	});
});

describe("disasters geometry branches", () => {
	it("handles polygon, multipolygon and garbage geometries", async () => {
		stub([
			[
				/eonet/,
				{
					json: {
						events: [
							{
								id: "p1",
								title: "Poly Fire",
								categories: [{ id: "x", title: "Wildfires" }],
								geometry: [
									{
										type: "Polygon",
										coordinates: [
											[
												[0, 0],
												[2, 0],
												[2, 2],
												[0, 0],
											],
										],
									},
								],
							},
							{
								id: "m1",
								title: "Multi Storm",
								categories: [{ id: "y", title: "Severe Storms" }],
								geometry: [
									{
										type: "MultiPolygon",
										coordinates: [
											[
												[
													[10, 10],
													[12, 10],
													[12, 12],
													[10, 10],
												],
											],
										],
									},
								],
							},
							{
								id: "g1",
								title: "Garbage",
								categories: [],
								geometry: [{ type: "LineString", coordinates: [[0, 0]] }],
							},
						],
					},
				},
			],
		]);
		const r = await disasters();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; severity: string }[]>(
			"SELECT id, severity FROM events WHERE layer='disasters' ORDER BY id",
		);
		assert.ok(rows.some((x) => x.id === "eonet:p1" && x.severity === "watch"));
		assert.ok(rows.some((x) => x.id === "eonet:m1"));
		assert.ok(
			rows.some((x) => x.id === "eonet:g1"),
			"ungeolocated kept, null geom",
		);
	});
});

describe("disasters honest failure", () => {
	it("EONET down returns ok:false with the error surfaced", async () => {
		globalThis.fetch = (async () => {
			return new Response("bad gateway", { status: 502 });
		}) as typeof fetch;
		const r = await disasters();
		assert.equal(r.ok, false);
		assert.match(String((r as { error?: string }).error), /502/);
		const h = await query<{ error: string | null }[]>(
			"SELECT error FROM feed_health WHERE source='eonet'",
		);
		assert.match(String(h[0]?.error), /502/);
	});
});

describe("disasters sentry", () => {
	it("sentry stores top risk rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("eonet.gsfc.nasa.gov")) return ok({ events: [] });
			if (u.includes("cad.api")) return ok({ fields: [], data: [] });
			if (u.includes("sentry.api"))
				return ok({
					data: [
						{
							des: "1979 XB",
							fullname: "(1979 XB)",
							ps_cum: "-2.69",
							ip: "8.5e-07",
							range: "2056-2113",
							diameter: "0.66",
							h: "18.54",
						},
					],
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await disasters();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='sentry'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["sentry:1979-XB"],
		);
	});
});

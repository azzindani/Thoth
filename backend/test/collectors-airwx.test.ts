// Collector contract tests, airwx: AWC SIGMETs. Consolidated from collectors-batch7 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as airwx } from "../src/workers/collectors/airwx.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("airwx collect()", () => {
	it("stores SIGMET polygons with AWC severity mapping", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("/gairmet"))
				return new Response(JSON.stringify({ features: [] }), { status: 200 });
			if (u.includes("/isigmet"))
				return new Response(JSON.stringify({ features: [] }), { status: 200 });
			return new Response(
				JSON.stringify({
					type: "FeatureCollection",
					features: [
						{
							properties: {
								seriesId: "37E",
								hazard: "CONVECTIVE",
								airSigmetType: "SIGMET",
								severity: 5,
								validTimeFrom: "2026-09-09T10:55:00.000Z",
								validTimeTo: "2026-09-09T12:55:00.000Z",
							},
							geometry: {
								type: "Polygon",
								coordinates: [
									[
										[-84.0, 30.0],
										[-82.0, 30.0],
										[-82.0, 31.0],
										[-84.0, 30.0],
									],
								],
							},
						},
						{ properties: { seriesId: "NOGEOM" } },
					],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await airwx();
		assert.equal(r.ok, true);
		assert.equal(r.count, 1);
		const rows = await query<{ severity: string }[]>(
			"SELECT severity FROM events WHERE layer='airwx'",
		);
		assert.equal(rows[0]?.severity, "critical", "AWC severity 5 → critical");
	});
	it("gairmet + isigmet legs store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("/gairmet"))
				return new Response(
					JSON.stringify({
						features: [
							{
								properties: {
									hazard: "FZLVL",
									tag: "1C",
									level: "160",
									validTime: "2026-09-17T09:00:00.000Z",
								},
								geometry: {
									type: "LineString",
									coordinates: [
										[-100.0, 40.0],
										[-99.0, 41.0],
									],
								},
							},
						],
					}),
					{ status: 200 },
				);
			if (u.includes("/isigmet"))
				return new Response(
					JSON.stringify({
						features: [
							{
								properties: {
									seriesId: "F1",
									hazard: "TS",
									firId: "MMEX",
									firName: "MMFR MEXICO",
									validTimeFrom: "2026-09-17T08:59:00.000Z",
									validTimeTo: "2026-09-17T12:59:00.000Z",
									top: 38000,
								},
								geometry: {
									type: "Polygon",
									coordinates: [
										[
											[-96.0, 20.0],
											[-95.0, 20.0],
											[-95.0, 21.0],
											[-96.0, 20.0],
										],
									],
								},
							},
						],
					}),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await airwx();
		assert.equal(r.ok, true);
		const gm = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='awc-gairmet'",
		);
		assert.equal(gm.length, 1);
		const ism = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='awc-isigmet'",
		);
		assert.equal(ism.length, 1);
		assert.ok(ism[0].id.startsWith("awcint:F1:MMEX:"));
	});
});

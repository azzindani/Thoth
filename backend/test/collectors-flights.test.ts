// Collector contract tests, flights: adsb/open-sky fallback + regions + honest-fail. Consolidated from collectors-batch1/9/10/39 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	airlineOf,
	collect as flights,
} from "../src/workers/collectors/flights.js";

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

describe("flights collect()", () => {
	it("falls back adsb→opensky and stamps rows", async () => {
		stub([
			[/api\.adsb\.lol/, { status: 503, text: "down" }],
			[
				/opensky-network\.org/,
				{
					json: {
						states: [
							["abc123", "UAL123 ", "", "", "", -0.5, 51.5, 10000, false, 90],
						],
					},
				},
			],
		]);
		const r = await flights();
		assert.equal(r.ok, true);
		const rows = await query<{
			title: string;
			meta: { airline: string | null };
		}>("SELECT title, meta FROM events WHERE layer='flights'");
		assert.ok(rows.length >= 1, "flight stored");
		assert.equal(rows[0].title, "UAL123");
		assert.equal(rows[0].meta.airline, "United Airlines");
	});
});

describe("flights fallback + airlineOf", () => {
	it("falls back to opensky when adsb.lol 503s", async () => {
		// NOTE: the opensky tick also polls 4 region legs + the adsbfi sweep
		// runs only when both primaries fail — stub all of them so the tick is
		// fully mocked (unmatched legs 500, region rows scoped out below).
		stub([
			[/adsb\.lol/, { status: 503 }],
			[/opendata\.adsb\.fi/, { status: 503 }],
			[
				/opensky-network\.org/,
				{
					json: {
						states: [
							[
								"abc123",
								"DLH123  ",
								null,
								null,
								null,
								8.5,
								50.1,
								9000,
								null,
								90,
							],
							["dead00", null, null, null, null, null, null, null, null, null],
						],
					},
				},
			],
		]);
		const r = await flights();
		assert.equal(r.ok, true);
		assert.equal((r as { source?: string }).source, "opensky");
		const rows = await query<{ id: string; title: string }>(
			"SELECT id, title FROM events WHERE layer='flights' AND source='opensky' AND id='opensky:abc123'",
		);
		assert.equal(rows.length, 1, "null-coord state skipped");
		assert.equal(rows[0].title, "DLH123");
	});
	it("airlineOf resolves known prefixes, null otherwise", () => {
		assert.equal(typeof airlineOf("DLH123"), "string");
		assert.equal(airlineOf(""), null);
		assert.equal(airlineOf("1ZZ999"), null);
	});
	it("parses adsb rows on the happy path", async () => {
		stub([
			[
				/adsb/,
				{
					json: {
						ac: [
							{
								hex: "a1",
								flight: "BAW1  ",
								lat: 51.5,
								lon: -0.1,
								alt_baro: 30000,
								track: 90,
							},
							{ hex: "a2", lat: null, lon: null },
							{ hex: "a3", flight: "   ", lat: 40.0, lon: 10.0 },
						],
					},
				},
			],
		]);
		const r = await flights();
		assert.equal(r.ok, true);
		assert.equal((r as { source?: string }).source, "adsb.lol");
		const rows = await query<{ id: string; title: string }>(
			"SELECT id, title FROM events WHERE source='adsb.lol' ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => [x.id, x.title]),
			[
				["adsb:a1", "BAW1"],
				["adsb:a3", "a3"],
			],
		);
	});
	it("fails honestly when all sources down", async () => {
		// NOTE: adsbfi is the last-resort leg after both primaries — stub it
		// too (the collector returns the LAST error, so match adsbfi).
		stub([
			[/adsb/, { status: 503 }],
			[/opensky/, { status: 500 }],
			[/opendata\.adsb\.fi/, { status: 503 }],
		]);
		const r = await flights();
		assert.equal(r.ok, false);
		assert.match(String(r.error), /adsbfi/);
	});
});

describe("flights adsb garbage fallback", () => {
	it("adsb 200 with invalid shape falls through to opensky", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("adsb.lol"))
				return new Response(JSON.stringify({ ac: "not-an-array" }), {
					status: 200,
				});
			if (u.includes("opensky-network.org"))
				return new Response(
					JSON.stringify({
						states: [
							[
								"b00b11",
								"DLH9  ",
								null,
								null,
								null,
								9.1,
								48.7,
								10000,
								null,
								45,
							],
						],
					}),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await flights();
		assert.equal(r.ok, true);
		assert.equal((r as { source?: string }).source, "opensky");
		// NOTE: the EU opensky stub also feeds the 4 region legs (same host) —
		// scope to the EU row under test.
		const rows = await query<{ id: string; source: string }>(
			"SELECT id, source FROM events WHERE layer='flights' AND source='opensky' AND id='opensky:b00b11'",
		);
		assert.deepEqual(
			rows.map((x) => [x.id, x.source]),
			[["opensky:b00b11", "opensky"]],
		);
		const h = await query<{ ok: boolean }>(
			"SELECT (error IS NULL) AS ok FROM feed_health WHERE source='adsb.lol'",
		);
		assert.equal(h[0]?.ok, false, "adsb rung marked unhealthy");
	});
});

describe("flights bosporus", () => {
	it("appends bosporus rows after EU success", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("adsb.lol")) return ok({}, 500);
			if (u.includes("lamin=40"))
				return ok({
					states: [
						[
							"4bb1e8",
							"THY6EZ  ",
							"Turkey",
							1,
							1,
							28.728,
							41.2552,
							53.34,
							false,
							359.13,
						],
					],
				});
			if (u.includes("opensky-network.org"))
				return ok({
					states: [
						[
							"abc123",
							"DLH123  ",
							"Germany",
							1,
							1,
							8.0,
							50.0,
							10000,
							false,
							90,
						],
					],
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await flights();
		assert.equal((r as { ok: boolean }).ok, true);
		// NOTE: the EU opensky stub feeds every same-host region leg, so the
		// bosporus source also collects the EU rows — assert the bosporus row
		// is present (shared-host pattern, cf. energyeu DE scoping fix).
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='opensky-bosporus' ORDER BY id",
		);
		assert.ok(rows.some((x) => x.id === "opensky-bos:4bb1e8"));
	});
});

describe("flights regions", () => {
	it("appends tokyo/sydney/mexico rows after EU success", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("adsb.lol")) return ok({}, 500);
			if (u.includes("lamin=40"))
				return ok({
					states: [
						[
							"4bb1e8",
							"THY6EZ  ",
							"Turkey",
							1,
							1,
							28.728,
							41.2552,
							53.34,
							false,
							359.13,
						],
					],
				});
			if (u.includes("lamin=35"))
				return ok({
					states: [
						[
							"8744f6",
							"ANA51   ",
							"Japan",
							1,
							1,
							139.8547,
							35.697,
							1623.06,
							false,
							356.76,
						],
					],
				});
			if (u.includes("lamin=-33"))
				return ok({
					states: [
						[
							"7c78b6",
							"QLK1579 ",
							"Australia",
							1,
							1,
							151.063,
							-32.5974,
							7345.68,
							false,
							241.78,
						],
					],
				});
			if (u.includes("lamin=19"))
				return ok({
					states: [
						[
							"0d121b",
							"AMX1740 ",
							"Mexico",
							1,
							1,
							-98.0191,
							19.6035,
							8092.44,
							false,
							79.9,
						],
					],
				});
			if (u.includes("lamin=45"))
				return ok({
					states: [
						[
							"abc123",
							"DLH123  ",
							"Germany",
							1,
							1,
							8.0,
							50.0,
							10000,
							false,
							90,
						],
					],
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await flights();
		assert.equal((r as { ok: boolean }).ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('opensky-tokyo','opensky-sydney','opensky-mexico') AND id IN ('opensky-tyo:8744f6','opensky-syd:7c78b6','opensky-mex:0d121b') ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["opensky-mex:0d121b", "opensky-syd:7c78b6", "opensky-tyo:8744f6"],
		);
	});
});

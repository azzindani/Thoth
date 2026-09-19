// Collector contract tests, oceans: NDBC + COOPS tides/temperature/predictions/wind/pressure.
// Consolidated from collectors-batch3/14/37/40 files (per-collector refactor, Phase 1).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as oceans } from "../src/workers/collectors/oceans.js";

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

function stub(order: [string, (u: string) => unknown][]) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [key, fn] of order) if (u.includes(key)) return fn(u);
		return new Response("no mock", { status: 500 });
	}) as typeof fetch;
}

function stubRe(
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

describe("oceans collect()", () => {
	it("parses NDBC table, flags rough seas", async () => {
		stubRe([
			[
				/ndbc\.noaa\.gov/,
				{
					text: "#STN LAT LON\n41001 34.7 -72.7 2026 09 09 10 00 90 25.0 MM 7.5 0 MM MM 1013 MM 22.0 25.0 MM MM MM\n",
				},
			],
		]);
		const r = await oceans();
		assert.equal(r.ok, true);
		const rows = await query<{ severity: string }[]>(
			"SELECT severity FROM events WHERE layer='oceans'",
		);
		assert.equal(rows[0]?.severity, "watch");
	});
});

describe("coops datum param", () => {
	it("sends datum=MSL and stores tide levels", async () => {
		let sawDatum = false;
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("ndbc.noaa.gov")) {
				return new Response("#STN LAT LON YYYY MM DD hh mm\n", { status: 200 });
			}
			assert.match(u, /tidesandcurrents\.noaa\.gov/);
			if (u.includes("datum=MSL")) sawDatum = true;
			// Temp/wind/pressure legs share this host: answer "no data" there so
			// only the water_level leg stores rows (keeps the temp suites hermetic).
			if (!u.includes("product=water_level"))
				return new Response(JSON.stringify({ error: { message: "No data" } }), {
					status: 200,
				});
			return new Response(
				JSON.stringify({
					metadata: { id: "8720218", lat: "30.3982", lon: "-81.4279" },
					data: [{ t: "2026-09-13 22:00", v: "-0.452", s: "0.011" }],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await oceans();
		assert.equal(r.ok, true);
		assert.equal(sawDatum, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='coops' AND id='coops:8720218'",
		);
		assert.equal(rows.length, 1);
	});
});

describe("oceans coops-temp", () => {
	it("stores water-temp rows", async () => {
		stub([
			["ndbc.noaa.gov", () => ok("", 500)],
			["datagetter?product=water_level", () => ok({ data: [] }, 500)],
			["om-flood", () => ok([], 500)],
			[
				"product=water_temperature",
				(u: string) =>
					ok({
						metadata: { lat: "40.7006", lon: "-74.0142" },
						data: [{ t: "2026-09-16 11:24", v: "22.9", f: "0,0,0" }],
					}),
			],
		]);
		const r = await oceans();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='coops-temp' ORDER BY id",
		);
		assert.equal(rows.length, 3);
		assert.ok(
			rows[0].id.startsWith("coopstemp:8518750:") ||
				rows[0].id.startsWith("coopstemp:8534720:"),
		);
	});
});

describe("oceans coops-pred", () => {
	it("stores hilo prediction rows", async () => {
		stub([
			["ndbc.noaa.gov", () => ok("", 500)],
			["datagetter?product=water_level", () => ok({ data: [] }, 500)],
			["date=latest&station", () => ok({ data: [] }, 500)],
			["flood-api.open-meteo.com", () => ok({ daily: {} }, 500)],
			["om-flood", () => ok([], 500)],
			[
				"product=predictions",
				() =>
					ok({
						predictions: [
							{ t: "2026-09-16 04:19", v: "0.563", type: "H" },
							{ t: "2026-09-16 10:14", v: "-0.493", type: "L" },
						],
					}),
			],
		]);
		const r = await oceans();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='coops-pred' ORDER BY id",
		);
		assert.equal(rows.length, 2);
	});
});

describe("oceans coops-wind + coops-pressure", () => {
	it("stores wind and pressure rows for met-equipped stations", async () => {
		stub([
			["ndbc.noaa.gov", () => ok("", 500)],
			["datagetter?product=water_level", () => ok({ data: [] }, 500)],
			["om-flood", () => ok([], 500)],
			[
				"product=water_temperature",
				() =>
					ok({
						metadata: { lat: "40.7006", lon: "-74.0142" },
						data: [{ t: "2026-09-16 11:24", v: "22.9", f: "0,0,0" }],
					}),
			],
			[
				"product=wind",
				() =>
					ok({
						metadata: { lat: "30.3982", lon: "-81.4279" },
						data: [
							{
								t: "2026-09-16 23:30",
								s: "10.3",
								d: "60.0",
								dr: "ENE",
								g: "12.5",
								f: "0,0",
							},
						],
					}),
			],
			[
				"product=air_pressure",
				() =>
					ok({
						metadata: { lat: "30.3982", lon: "-81.4279" },
						data: [{ t: "2026-09-16 23:30", v: "1023.5", f: "0,0,0" }],
					}),
			],
			["product=predictions", () => ok({ predictions: [] }, 500)],
		]);
		const r = await oceans();
		assert.equal(r.ok, true);
		const wind = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='coops-wind' ORDER BY id",
		);
		assert.equal(wind.length, 15); // 8 surge + 7 batch58 ring (mock serves all)
		assert.ok(wind.every((x) => x.id.startsWith("coopswind:")));
		const pres = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='coops-pressure' ORDER BY id",
		);
		assert.equal(pres.length, 15);
		assert.ok(pres.every((x) => x.id.startsWith("coopspres:")));
	});
});

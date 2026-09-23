// Collector contract tests, energyeu: Energy-Charts country mixes (25-country loop).
// Consolidated from collectors-batch22/35/37/38 files (per-collector refactor, Phase 1).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as energy } from "../src/workers/collectors/energy-eu.js";

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

describe("energy-eu", () => {
	it("dk-spot + carbon hist store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("energidataservice.dk"))
				return ok({
					records: [
						{
							HourUTC: "2026-09-16T00:00:00",
							PriceArea: "DK1",
							SpotPriceDKK: 100,
							SpotPriceEUR: 13.4,
						},
					],
				});
			if (u.includes("carbonintensity.org.uk"))
				return ok({
					data: [{ from: "2026-09-15T23:00Z", intensity: { actual: 70 } }],
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('dk-spot','carbon-uk-hist')",
		);
		assert.equal(rows.length, 2);
	});
});

describe("energy-eu energy-charts", () => {
	it("stores top-3 DE mix rows", async () => {
		// NOTE: "public_power?country=de/fr" MUST sort before the bare
		// "energy-charts.info" key — every country URL contains that host, so a
		// bare-host key placed first would swallow the country legs (the stub
		// matcher is first-match-wins). Same ordering rule as the FR+ suites.
		stub([
			["energidataservice.dk", () => ok({}, 500)],
			["carbonintensity.org.uk", () => ok({}, 500)],
			[
				"public_power?country=de",
				() =>
					ok({
						unix_seconds: [1789509600, 1789510500],
						production_types: [
							{ name: "Wind onshore", data: [5000, 6000] },
							{ name: "Solar", data: [3000, 100] },
							{ name: "Hydro pumped storage consumption", data: [-277, -320] },
							{ name: "Nuclear", data: [null, null] },
						],
					}),
			],
			[
				"public_power?country=fr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=es",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=it",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=nl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=be",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=at",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=se",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=dk",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pt",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=gr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fi",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=no",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=cz",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=hu",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=si",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
		]);
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='energy-charts' ORDER BY id",
		);
		assert.equal(rows.length, 2); // wind + solar (negative + null skipped)
		assert.ok(rows[0].id.startsWith("echarts:de:Solar:"));
	});
});

describe("energy-eu FR mix", () => {
	it("stores top-3 FR rows", async () => {
		stub([
			["energidataservice.dk", () => ok({}, 500)],
			["carbonintensity.org.uk", () => ok({}, 500)],
			[
				"public_power?country=de",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fr",
				() =>
					ok({
						unix_seconds: [1789509600, 1789510500],
						production_types: [
							{ name: "Nuclear", data: [40000, 41000] },
							{ name: "Wind onshore", data: [5000, 6000] },
							{ name: "Solar", data: [null, null] },
						],
					}),
			],
		]);
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='energy-charts-fr' ORDER BY id",
		);
		assert.equal(rows.length, 2);
		assert.ok(rows[0].id.startsWith("echarts:fr:Nuclear:"));
	});
});

describe("energy-eu ES + IT", () => {
	it("stores Iberian and Italian mix rows", async () => {
		stub([
			["energidataservice.dk", () => ok({}, 500)],
			["carbonintensity.org.uk", () => ok({}, 500)],
			[
				"public_power?country=de",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=es",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Nuclear", data: [7000] }],
					}),
			],
			[
				"public_power?country=it",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Gas", data: [9000] }],
					}),
			],
		]);
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('energy-charts-es','energy-charts-it') ORDER BY id",
		);
		assert.equal(rows.length, 2);
	});
});

describe("energy-eu NL + PL", () => {
	it("stores Dutch and Polish mix rows", async () => {
		stub([
			["energidataservice.dk", () => ok({}, 500)],
			["carbonintensity.org.uk", () => ok({}, 500)],
			[
				"public_power?country=de",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=es",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=it",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=nl",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Wind offshore", data: [4000] }],
					}),
			],
			[
				"public_power?country=pl",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Coal", data: [12000] }],
					}),
			],
		]);
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('energy-charts-nl','energy-charts-pl') ORDER BY id",
		);
		assert.equal(rows.length, 2);
	});
});

describe("energy-eu BE + AT", () => {
	it("stores Belgian and Austrian mix rows", async () => {
		stub([
			["energidataservice.dk", () => ok({}, 500)],
			["carbonintensity.org.uk", () => ok({}, 500)],
			[
				"public_power?country=de",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=es",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=it",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=nl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=be",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Solar", data: [4196] }],
					}),
			],
			[
				"public_power?country=at",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Hydro", data: [5000] }],
					}),
			],
		]);
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('energy-charts-be','energy-charts-at') ORDER BY id",
		);
		assert.equal(rows.length, 2);
	});
});

describe("energy-eu SE + DK", () => {
	it("stores Swedish and Danish mix rows", async () => {
		stub([
			["energidataservice.dk", () => ok({}, 500)],
			["carbonintensity.org.uk", () => ok({}, 500)],
			[
				"public_power?country=de",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=es",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=it",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=nl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=be",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=at",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=se",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Hydro", data: [8000] }],
					}),
			],
			[
				"public_power?country=dk",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Wind offshore", data: [2000] }],
					}),
			],
		]);
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('energy-charts-se','energy-charts-dk') ORDER BY id",
		);
		assert.equal(rows.length, 2);
	});
});

describe("energy-eu PT + GR", () => {
	it("stores Portuguese and Greek mix rows", async () => {
		stub([
			["energidataservice.dk", () => ok({}, 500)],
			["carbonintensity.org.uk", () => ok({}, 500)],
			[
				"public_power?country=de",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=es",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=it",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=nl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=be",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=at",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=se",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=dk",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pt",
				() =>
					ok({
						unix_seconds: [1789513200],
						production_types: [{ name: "Wind onshore", data: [3000] }],
					}),
			],
			[
				"public_power?country=gr",
				() =>
					ok({
						unix_seconds: [1789506000],
						production_types: [{ name: "Solar", data: [1500] }],
					}),
			],
		]);
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('energy-charts-pt','energy-charts-gr') ORDER BY id",
		);
		assert.equal(rows.length, 2);
	});
});

describe("energy-eu FI + NO + CZ", () => {
	it("stores Nordic and Czech mix rows", async () => {
		stub([
			["energidataservice.dk", () => ok({}, 500)],
			["carbonintensity.org.uk", () => ok({}, 500)],
			[
				"public_power?country=de",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=es",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=it",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=nl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=be",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=at",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=se",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=dk",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pt",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=gr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fi",
				() =>
					ok({
						unix_seconds: [1789506000],
						production_types: [{ name: "Nuclear", data: [2500] }],
					}),
			],
			[
				"public_power?country=no",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Hydro", data: [20000] }],
					}),
			],
			[
				"public_power?country=cz",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Nuclear", data: [4000] }],
					}),
			],
		]);
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('energy-charts-fi','energy-charts-no','energy-charts-cz') ORDER BY id",
		);
		assert.equal(rows.length, 3);
	});
});

describe("energy-eu HU + SI + swiss LS-BE", () => {
	it("stores Hungarian/Slovenian mix and LS-BE journeys", async () => {
		stub([
			["energidataservice.dk", () => ok({}, 500)],
			["carbonintensity.org.uk", () => ok({}, 500)],
			[
				"public_power?country=de",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=es",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=it",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=nl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=be",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=at",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=se",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=dk",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pt",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=gr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fi",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=no",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=cz",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=hu",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Nuclear", data: [1900] }],
					}),
			],
			[
				"public_power?country=si",
				() =>
					ok({
						unix_seconds: [1789509600],
						production_types: [{ name: "Hydro", data: [800] }],
					}),
			],
			[
				"public_power?country=ro",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=sk",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=hr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=ie",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=lu",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=ee",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=lv",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=lt",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
		]);
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('energy-charts-hu','energy-charts-si') ORDER BY id",
		);
		assert.equal(rows.length, 2);
	});
});

describe("energy-eu EU27 RO/SK/HR/IE/LU/EE/LV/LT", () => {
	it("stores the batch58 eastern/northern mix rows", async () => {
		// 429-swallowing rule: new country keys all 500 except the asserted
		// ones — first-match-wins means an unlisted URL hits the 500 default.
		stub([
			["energidataservice.dk", () => ok({}, 500)],
			["carbonintensity.org.uk", () => ok({}, 500)],
			[
				"public_power?country=de",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=es",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=it",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=nl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pl",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=be",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=at",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=se",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=dk",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=pt",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=gr",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=fi",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=no",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=cz",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=hu",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=si",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=ro",
				() =>
					ok({
						unix_seconds: [1789627500],
						production_types: [{ name: "Fossil gas", data: [1157] }],
					}),
			],
			[
				"public_power?country=sk",
				() =>
					ok({
						unix_seconds: [1789627500],
						production_types: [{ name: "Nuclear", data: [1900] }],
					}),
			],
			[
				"public_power?country=hr",
				() =>
					ok({
						unix_seconds: [1789627500],
						production_types: [{ name: "Hydro water reservoir", data: [693] }],
					}),
			],
			[
				"public_power?country=ie",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=lu",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=ee",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=lv",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
			[
				"public_power?country=lt",
				() => ok({ unix_seconds: [], production_types: [] }, 500),
			],
		]);
		const r = await energy();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('energy-charts-ro','energy-charts-sk','energy-charts-hr') ORDER BY id",
		);
		assert.equal(rows.length, 3);
	});
});

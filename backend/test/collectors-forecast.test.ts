// Collector contract tests, forecast: Open-Meteo + BOM + IPMA + honest-fail. Consolidated from collectors-batch19/25/34/35 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as forecast } from "../src/workers/collectors/forecast.js";

const realFetch = globalThis.fetch;
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
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("forecast/marine", () => {
	it("collect() stores city + marine rows", async () => {
		const fx = (temp: number) => ({
			current: { temperature_2m: temp, wind_speed_10m: 10, weather_code: 1 },
			daily: {
				temperature_2m_max: [temp + 2],
				temperature_2m_min: [temp - 2],
				precipitation_probability_max: [10],
				wind_speed_10m_max: [20],
			},
		});
		const marine = {
			current: {
				wave_height: 1.2,
				wave_direction: 90,
				wave_period: 6,
				ocean_current_velocity: 0.3,
			},
		};
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			// Marine first: "marine-api.open-meteo.com" also contains
			// "api.open-meteo.com", so the forecast stub would shadow it.
			if (u.includes("marine-api.open-meteo.com"))
				return new Response(
					JSON.stringify(Array.from({ length: 20 }, () => marine)),
					{ status: 200 },
				);
			if (u.includes("api.open-meteo.com"))
				return new Response(
					JSON.stringify(Array.from({ length: 24 }, (_, i) => fx(15 + i))),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await forecast();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source IN ('openmeteo-fx','openmeteo-marine')",
		);
		assert.ok(rows.length >= 30, `forecast rows, got ${rows.length}`);
	});
});

describe("forecast bom", () => {
	it("bom stores AU city rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.open-meteo.com/v1/forecast"))
				return ok([
					{
						current: { temperature_2m: 15 },
						daily: { temperature_2m_max: [20] },
					},
				]);
			if (u.includes("marine-api.open-meteo.com")) return ok([], 500);
			if (u.includes("api.brightsky.dev")) return ok({}, 500);
			if (u.includes("power.larc.nasa.gov")) return ok({}, 500);
			if (u.includes("api.weather.bom.gov.au"))
				return ok({
					data: [
						{
							date: "2026-09-15T14:00:00Z",
							temp_max: 13,
							temp_min: 9,
							rain: { chance: 40 },
							extended_text: "Cloudy.",
						},
					],
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await forecast();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='bom'",
		);
		assert.equal(rows.length, 4);
	});
});

describe("forecast ipma + iss-now", () => {
	it("ipma stores Lisbon day-0, iss-now stores the fix", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.open-meteo.com")) return ok({}, 500);
			if (u.includes("brightsky.dev")) return ok({}, 500);
			if (u.includes("weather.bom.gov.au")) return ok({}, 500);
			if (u.includes("power.larc.nasa.gov")) return ok({}, 500);
			if (u.includes("api.ipma.pt"))
				return ok({
					data: [
						{
							forecastDate: "2026-09-16",
							tMin: "17.8",
							tMax: "26.2",
							precipitaProb: "0.0",
							predWindDir: "N",
							latitude: "38.7660",
							longitude: "-9.1286",
						},
					],
				});
			if (u.includes("open-notify.org"))
				return ok({
					iss_position: { latitude: "50.0337", longitude: "170.6940" },
					timestamp: 1789552915,
					message: "success",
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await forecast();
		assert.equal(r.ok, true);
		const ipma = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='ipma' ORDER BY id",
		);
		assert.equal(ipma.length, 3); // Lisbon + Porto + Faro, same mock shape
		assert.equal(ipma[0].id, "ipma:faro:2026-09-16");
		const iss = await query<{ id: string }[]>(
			"SELECT id FROM events WHERE source='iss-now'",
		);
		assert.deepEqual(
			iss.map((x) => x.id),
			["issnow:1789552915"],
		);
	});
});

describe("forecast batch35 (ipma/iss-now covered in batch34)", () => {
	it("still collects with new blocks present", async () => {
		stub([
			["api.open-meteo.com", () => ok({}, 500)],
			["brightsky.dev", () => ok({}, 500)],
			["weather.bom.gov.au", () => ok({}, 500)],
			["power.larc.nasa.gov", () => ok({}, 500)],
			["api.ipma.pt", () => ok({ data: [] }, 500)],
			["open-notify.org", () => ok({ message: "fail" }, 500)],
		]);
		const r = await forecast();
		assert.equal(r.ok, false); // all legs down → honest fail
		assert.match(
			r.error ?? "",
			/openmeteo|brightsky|bom|nasa-power|ipma|iss-now/,
		);
	});
});

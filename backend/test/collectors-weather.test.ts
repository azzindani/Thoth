// Collector contract tests, weather: NWS + EU alerts + nowcasts + ocean + sun.
// Consolidated from collectors-batch2/14/18/22/23/26/36/37 files (per-collector refactor, Phase 1).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	metalarmSeverity,
	collect as weather,
} from "../src/workers/collectors/weather.js";

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

describe("weather collect()", () => {
	it("maps NWS severity to ours", async () => {
		stubRe([
			[
				/api\.weather\.gov/,
				{
					json: {
						features: [
							{
								id: "w1",
								properties: {
									event: "Tornado Warning",
									headline: "Test warning",
									severity: "Severe",
									certainty: "Observed",
									sent: "2026-09-09T10:00:00Z",
								},
								geometry: { type: "Point", coordinates: [-90, 35] },
							},
						],
					},
				},
			],
		]);
		const r = await weather();
		assert.equal(r.ok, true);
		const rows = await query<{ severity: string }>(
			"SELECT severity FROM events WHERE layer='weather'",
		);
		assert.equal(rows[0]?.severity, "critical");
	});
});

describe("metalerts CAP shape", () => {
	it("stores European alerts alongside NWS (no id/headline/sent fields)", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.weather.gov")) {
				return new Response(JSON.stringify({ features: [] }), { status: 200 });
			}
			assert.match(u, /api\.met\.no/);
			// Only the MetAlerts leg is under test here: the same host also
			// serves nowcast/ocean/sunrise/yr, which 500 (keeps the metnow
			// suites hermetic — same pattern as the oceans datum fix; note a
			// 200 with {} would still store a "metnow:" id-less row).
			if (!u.includes("/weatherapi/metalerts/"))
				return new Response("no mock", { status: 500 });
			return new Response(
				JSON.stringify({
					features: [
						{
							type: "Feature",
							geometry: {
								type: "Polygon",
								coordinates: [
									[
										[10, 75],
										[20, 75],
										[20, 77],
										[10, 77],
										[10, 75],
									],
								],
							},
							properties: {
								event: "gale",
								title: "Kuling, B4",
								severity: "Moderate",
								certainty: "Likely",
							},
							when: {
								interval: [
									"2026-09-15T19:00:00+00:00",
									"2026-09-15T22:00:00+00:00",
								],
							},
						},
					],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await weather();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; severity: string }>(
			"SELECT id, severity FROM events WHERE source='metalerts'",
		);
		assert.equal(rows.length, 1);
		assert.match(rows[0].id, /^met:/);
		assert.equal(rows[0].severity, "watch");
	});
});

describe("metalarm colors", () => {
	it("maps Red/Orange/Yellow title words, stores country rows", async () => {
		assert.equal(metalarmSeverity("Red Wind Warning"), "critical");
		assert.equal(metalarmSeverity("Orange Flood Alert"), "watch");
		assert.equal(metalarmSeverity("Yellow Fog Warning"), "info");
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("feeds.meteoalarm.org"))
				return new Response(
					`<feed><entry><title>Red Wind Warning issued for Germany</title><link href="https://meteoalarm.org/x"/><updated>2026-09-14T23:00:00Z</updated></entry></feed>`,
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await weather();
		assert.equal(r.ok, true);
		const rows = await query<{ severity: string }>(
			"SELECT severity FROM events WHERE source='metalarm'",
		);
		assert.ok(rows.length >= 1);
		assert.equal(rows[0].severity, "critical");
	});
});

describe("weather depth", () => {
	it("metnow + nws-fx + hko store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.weather.gov/alerts")) return ok({ features: [] });
			if (u.includes("metalerts")) return ok({ features: [] }, 500);
			if (u.includes("meteoalarm")) return ok("<rss></rss>");
			if (u.includes("nowcast/2.0"))
				return ok({
					properties: {
						timeseries: [
							{
								time: "2026-09-16T02:00:00Z",
								data: {
									instant: {
										details: {
											air_temperature: 12,
											wind_speed: 3,
											precipitation_amount: 0,
										},
									},
								},
							},
						],
					},
				});
			if (u.includes("gridpoints/OKX"))
				return ok({
					properties: {
						periods: [
							{
								name: "Tonight",
								startTime: "2026-09-15T21:00:00-04:00",
								temperature: 64,
								temperatureUnit: "F",
								shortForecast: "Mostly Clear",
							},
						],
					},
				});
			if (u.includes("weather.gov.hk"))
				return ok({
					weatherForecast: [
						{
							forecastDate: "20260916",
							week: "Wednesday",
							forecastWeather: "Mainly fine.",
							forecastMaxtemp: { value: 31 },
							forecastMintemp: { value: 27 },
						},
					],
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await weather();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('metnow','nws-fx','hko')",
		);
		assert.equal(rows.length, 3);
	});
});

describe("weather metocean/metsun", () => {
	it("metocean + metsun store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.weather.gov/alerts")) return ok({ features: [] });
			if (u.includes("metalerts")) return ok({ features: [] }, 500);
			if (u.includes("meteoalarm")) return ok("<rss></rss>");
			if (u.includes("nowcast")) return ok({ properties: { timeseries: [] } });
			if (u.includes("gridpoints")) return ok({ properties: { periods: [] } });
			if (u.includes("weather.gov.hk")) return ok({ weatherForecast: [] });
			if (u.includes("oceanforecast"))
				return ok({
					properties: {
						timeseries: [
							{
								time: "2026-09-16T02:00:00Z",
								data: {
									instant: {
										details: {
											sea_surface_wave_height: 0.3,
											sea_water_temperature: 16.3,
										},
									},
								},
							},
						],
					},
				});
			if (u.includes("sunrise/3.0"))
				return ok({
					properties: {
						sunrise: { time: "2026-09-16T05:47+01:00" },
						sunset: { time: "2026-09-16T18:35+01:00" },
					},
				});
			return ok({}, 500);
		}) as typeof fetch;
		const r = await weather();
		assert.equal(r.ok, true);
		// The metsun id is today's date (not the mock's fixed time), so scope
		// only the metocean half to the tick time; the metsun row is matched
		// by source alone. (Shared-table suites are hermetic per-source, not
		// per-row — metsun's date-id is unique per day, metocean's time-id is
		// scoped here because the oceanforecast host serves both metocean legs.)
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='metsun' OR (source='metocean' AND id LIKE '%2026-09-16T02:00%')",
		);
		assert.equal(rows.length, 2);
	});
});

describe("weather depth26", () => {
	it("yr + nws-obs + fmi + dwd store rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.weather.gov/alerts")) return ok({ features: [] });
			if (u.includes("metalerts")) return ok({ features: [] }, 500);
			if (u.includes("meteoalarm")) return ok("<rss></rss>");
			if (u.includes("nowcast")) return ok({ properties: { timeseries: [] } });
			if (u.includes("gridpoints")) return ok({ properties: { periods: [] } });
			if (u.includes("weather.gov.hk")) return ok({ weatherForecast: [] });
			if (u.includes("oceanforecast"))
				return ok({ properties: { timeseries: [] } }, 500);
			if (u.includes("sunrise/3.0")) return ok({}, 500);
			if (u.includes("locationforecast/2.0"))
				return ok({
					properties: {
						timeseries: [
							{
								time: "2026-09-16T05:00:00Z",
								data: {
									instant: {
										details: { air_temperature: 13.5, wind_speed: 4.9 },
									},
									next_1_hours: { summary: { symbol_code: "fair_day" } },
								},
							},
						],
					},
				});
			if (u.includes("/stations/") && u.includes("/observations/"))
				return ok({
					geometry: { coordinates: [-73.78, 40.64] },
					properties: {
						timestamp: "2026-09-16T05:25:00+00:00",
						textDescription: "Clear",
						temperature: { value: 18 },
						windSpeed: { value: 11 },
					},
				});
			if (u.includes("opendata.fmi.fi"))
				return ok(
					`<wfs:FeatureCollection><wfs:member><BsWfs:BsWfsElement><BsWfs:Time>2026-09-16T00:00:00Z</BsWfs:Time><BsWfs:ParameterName>t2m</BsWfs:ParameterName><BsWfs:ParameterValue>14.2</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member></wfs:FeatureCollection>`,
				);
			if (u.includes("warnungen/warnapp"))
				return ok(
					`warnWetter.loadWarnings({"time":1789537625000,"warnings":{"106535000":[{"regionName":"Vogelsbergkreis","event":"GEWITTER","headline":"WARNUNG","level":2,"start":1789535100000}]}});`,
				);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await weather();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('yr-forecast','nws-obs','fmi','dwd-warn')",
		);
		assert.ok(rows.length >= 4);
	});
});

describe("weather yr-nowcast", () => {
	it("stores now rows for 3 Norwegian cities", async () => {
		stub([
			["api.weather.gov/alerts", () => ok({ features: [] }, 500)],
			["metalerts", () => ok({ features: [] }, 500)],
			["gridpoints", () => ok({ properties: {} }, 500)],
			["weatherAPI/opendata", () => ok({}, 500)],
			["oceanforecast", () => ok({}, 500)],
			["sunrise/3.0", () => ok("", 500)],
			["meteoalarm-legacy-atom", () => ok("", 500)],
			["locationforecast", () => ok({ properties: {} }, 500)],
			[
				"nowcast/2.0/complete",
				(_u: string) =>
					ok({
						properties: {
							timeseries: [
								{
									time: "2026-09-16T10:30:00Z",
									data: {
										instant: { details: { precipitation_rate: 0.0 } },
										next_1_hours: { details: { precipitation_amount: 0.0 } },
										next_6_hours: { details: { precipitation_amount: 0.1 } },
									},
								},
							],
						},
					}),
			],
			["api.weather.gov/stations", () => ok({}, 500)],
			["opendata.fmi.fi", () => ok("", 500)],
			["warnapp/json", () => ok("", 500)],
		]);
		const r = await weather();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='yr-nowcast' ORDER BY id",
		);
		assert.equal(rows.length, 3);
		assert.ok(rows[0].id.startsWith("yrnow:bergen:"));
	});
});

describe("weather metocean-ns", () => {
	it("stores North Sea + Norwegian Sea rows", async () => {
		stub([
			["api.weather.gov/alerts", () => ok({ features: [] }, 500)],
			["metalerts", () => ok({ features: [] }, 500)],
			["gridpoints", () => ok({ properties: {} }, 500)],
			["weatherAPI/opendata", () => ok({}, 500)],
			[
				"oceanforecast/2.0/complete?lat=59.9",
				() => ok({ properties: {} }, 500),
			],
			["sunrise/3.0", () => ok("", 500)],
			["meteoalarm-legacy-atom", () => ok("", 500)],
			["locationforecast", () => ok({ properties: {} }, 500)],
			["nowcast", () => ok({ properties: {} }, 500)],
			["api.weather.gov/stations", () => ok({}, 500)],
			["opendata.fmi.fi", () => ok("", 500)],
			["warnapp/json", () => ok("", 500)],
			[
				"oceanforecast/2.0/complete?lat=60",
				() =>
					ok({
						properties: {
							timeseries: [
								{
									time: "2026-09-16T11:00:00Z",
									data: {
										instant: {
											details: {
												sea_surface_wave_height: 2.8,
												sea_water_temperature: 13.4,
											},
										},
									},
								},
							],
						},
					}),
			],
			[
				"oceanforecast/2.0/complete?lat=64",
				() =>
					ok({
						properties: {
							timeseries: [
								{
									time: "2026-09-16T11:00:00Z",
									data: { instant: { details: {} } },
								},
							],
						},
					}),
			],
		]);
		const r = await weather();
		assert.equal(r.ok, true);
		// Scoped to this tick's observation time (see metocean/metsun note
		// above — the shared oceanforecast host serves both legs).
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='metocean-ns' AND id LIKE '%2026-09-16T11:00%' ORDER BY id",
		);
		assert.equal(rows.length, 1); // Norwegian Sea waveless → skipped
		assert.ok(rows[0].id.startsWith("metoceanns:northsea:"));
	});
});

describe("weather sunsched berlin + istanbul", () => {
	it("stores 4-city daylight rows", async () => {
		stub([
			["api.weather.gov/alerts", () => ok({ features: [] }, 500)],
			["metalerts", () => ok({ features: [] }, 500)],
			["gridpoints", () => ok({ properties: {} }, 500)],
			["weatherAPI/opendata", () => ok({}, 500)],
			["oceanforecast", () => ok({ properties: {} }, 500)],
			["sunrise/3.0", () => ok({ properties: {} }, 500)],
			["meteoalarm-legacy-atom", () => ok("", 500)],
			["locationforecast", () => ok({ properties: {} }, 500)],
			["nowcast", () => ok({ properties: {} }, 500)],
			["api.weather.gov/stations", () => ok({}, 500)],
			["opendata.fmi.fi", () => ok("", 500)],
			["warnapp/json", () => ok("", 500)],
			[
				"sunrise-sunset.org",
				() =>
					ok({
						results: {
							sunrise: "2026-09-16T05:35:32+00:00",
							sunset: "2026-09-16T18:15:06+00:00",
							day_length: 45574,
						},
					}),
			],
		]);
		const r = await weather();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='sunsched' ORDER BY id",
		);
		assert.equal(rows.length, 4);
		assert.ok(rows.some((x) => x.id.startsWith("sunsched:berlin:")));
		assert.ok(rows.some((x) => x.id.startsWith("sunsched:istanbul:")));
	});
});

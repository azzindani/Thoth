// Collector contract tests, rivers: NWIS + OM flood + Pegelonline.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	pegelRows,
	collect as rivers,
} from "../src/workers/collectors/rivers.js";
import {
	eventsOf,
	healthOf,
	json,
	stubFetch,
} from "./helpers/collector-stubs.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("rivers", () => {
	it("collect() stores flow + stage rows", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					value: {
						timeSeries: [
							{
								name: "USGS:01491000:00060:00000",
								sourceInfo: {
									siteName: "CHOPTANK",
									geoLocation: {
										geogLocation: { latitude: 38.99, longitude: -75.78 },
									},
								},
								variable: {
									variableCode: [{ value: "00060" }],
									unit: { unitCode: "ft3/s" },
								},
								values: [
									{
										value: [
											{
												value: "10.2",
												dateTime: "2026-09-15T04:15:00.000-04:00",
											},
										],
									},
								],
							},
						],
					},
				}),
				{ status: 200 },
			)) as typeof fetch;
		const r = await rivers();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='nwis'",
		);
		assert.equal(rows.length, 1);
	});
});

describe("om-flood", () => {
	it("one stalled gauge no longer fails the other seven", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (!u.includes("flood-api.open-meteo.com"))
				return new Response("{}", { status: 500 });
			if (u.includes("latitude=48.21"))
				throw new DOMException("This operation was aborted", "AbortError");
			return new Response(
				JSON.stringify({
					daily: {
						time: ["2026-09-23", "2026-09-24"],
						river_discharge: [900, 950],
					},
				}),
			);
		}) as typeof fetch;
		await rivers();
		const [h] = await query<{ ok: boolean; error: string | null }>(
			"SELECT (last_ok IS NOT NULL) AS ok, error FROM feed_health WHERE source='om-flood'",
		);
		assert.equal(h.ok, true);
		assert.match(h.error ?? "", /^7\/8 points; misses: Danube-Vienna: /);
		const [c] = await query<{ n: number }>(
			"SELECT count(*)::int AS n FROM events WHERE source='om-flood'",
		);
		assert.equal(c.n, 7);
	});
});

const station = (
	uuid: string,
	shortname: string,
	value: number,
	mhw: string,
	hsw = "normal",
) => ({
	uuid,
	number: `n-${uuid}`,
	shortname,
	latitude: 50,
	longitude: 7,
	water: { shortname: "RHEIN" },
	timeseries: [
		{
			unit: "cm",
			currentMeasurement: {
				timestamp: "2026-09-24T07:45:00+02:00",
				value,
				stateMnwMhw: mhw,
				stateNswHsw: hsw,
			},
		},
	],
});
const GAUGES = [
	station("u-kaub", "KAUB", 7, "low"),
	station("u-flood", "SOMEWHERE", 640, "high"),
	station("u-ship", "ELSEWHERE", 910, "high", "high"),
	station("u-quiet", "QUIET", 120, "normal"),
];

describe("pegelonline", () => {
	it("keeps reference gauges and high water only, ranked by state", () => {
		const r = pegelRows(GAUGES);
		assert.deepEqual(
			r.map((x) => [x.id, x.severity]),
			[
				["pegel:u-kaub", "info"],
				["pegel:u-flood", "watch"],
				["pegel:u-ship", "critical"],
			],
		);
		assert.equal(r[0].title, "KAUB (RHEIN) 7 cm — below mean low water");
		assert.match(r[0].url ?? "", /pegelnr=n-u-kaub$/);
	});
	it("prunes a gauge once its high water passes", async () => {
		stubFetch([[/pegelonline/, json(GAUGES)]]);
		await rivers();
		assert.equal((await eventsOf("pegelonline")).length, 3);
		stubFetch([[/pegelonline/, json([GAUGES[0], GAUGES[3]])]]);
		await rivers();
		assert.deepEqual(
			(await eventsOf("pegelonline")).map((x) => x.id),
			["pegel:u-kaub"],
		);
		assert.equal((await healthOf("pegelonline")).ok, true);
	});
	it("a payload without any reference gauge fails without pruning", async () => {
		stubFetch([[/pegelonline/, json([GAUGES[3]])]]);
		await rivers();
		assert.equal((await eventsOf("pegelonline")).length, 1);
		assert.match(
			(await healthOf("pegelonline")).error ?? "",
			/no reference gauge/,
		);
	});
});

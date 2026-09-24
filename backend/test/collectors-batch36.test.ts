// Collector contract tests, batch 36 (keyless loop-11): Pegelonline German
// federal waterway gauges (rivers) and Hong Kong Observatory warnings
// (warnings). Upstreams stubbed at fetch.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	pegelRows,
	collect as rivers,
} from "../src/workers/collectors/rivers.js";
import * as warnings from "../src/workers/collectors/warnings.js";

const realFetch = globalThis.fetch;
function stub(routes: [RegExp, () => Response][]) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [re, r] of routes) if (re.test(u)) return r();
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
}
const json = (x: unknown) => () => new Response(JSON.stringify(x));
const rows = (source: string) =>
	query<{ id: string; title: string; severity: string; url: string }>(
		"SELECT id, title, severity, url FROM events WHERE source=$1 ORDER BY id",
		[source],
	);
const health = async (source: string) =>
	(
		await query<{ ok: boolean; error: string | null }>(
			"SELECT (last_ok IS NOT NULL AND error IS NULL) AS ok, error FROM feed_health WHERE source=$1",
			[source],
		)
	)[0];

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
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
		stub([[/pegelonline/, json(GAUGES)]]);
		await rivers();
		assert.equal((await rows("pegelonline")).length, 3);
		stub([[/pegelonline/, json([GAUGES[0], GAUGES[3]])]]);
		await rivers();
		assert.deepEqual(
			(await rows("pegelonline")).map((x) => x.id),
			["pegel:u-kaub"],
		);
		assert.equal((await health("pegelonline")).ok, true);
	});
	it("a payload without any reference gauge fails without pruning", async () => {
		stub([[/pegelonline/, json([GAUGES[3]])]]);
		await rivers();
		assert.equal((await rows("pegelonline")).length, 1);
		assert.match(
			(await health("pegelonline")).error ?? "",
			/no reference gauge/,
		);
	});
});

describe("hko warnings", () => {
	it("maps warning codes to severity", () => {
		assert.equal(warnings.hkoSeverity("TC8NE"), "critical");
		assert.equal(warnings.hkoSeverity("TC10"), "critical");
		assert.equal(warnings.hkoSeverity("TC3"), "watch");
		assert.equal(warnings.hkoSeverity("TC1"), "info");
		assert.equal(warnings.hkoSeverity("WRAINB"), "critical");
		assert.equal(warnings.hkoSeverity("WRAINA"), "watch");
		assert.equal(warnings.hkoSeverity("WTS"), "info");
	});
	it("stores warnings in force, skips cancellations, and {} is quiet", async () => {
		stub([
			[
				/dataType=warnsum/,
				json({
					WTCSGNL: {
						name: "Tropical Cyclone Warning Signal",
						code: "TC8NE",
						actionCode: "ISSUE",
						issueTime: "2026-09-24T09:40:00+08:00",
						updateTime: "2026-09-24T09:40:00+08:00",
					},
					WRAIN: {
						name: "Rainstorm Warning Signal",
						code: "WRAINA",
						actionCode: "CANCEL",
					},
				}),
			],
		]);
		await warnings.collect();
		assert.deepEqual(
			(await rows("hko-warn")).map((x) => [x.id, x.severity, x.title]),
			[
				[
					"hko:WTCSGNL",
					"critical",
					"HKO · Tropical Cyclone Warning Signal — TC8NE",
				],
			],
		);
		stub([[/dataType=warnsum/, json({})]]);
		await warnings.collect();
		assert.equal((await rows("hko-warn")).length, 0);
		assert.equal((await health("hko-warn")).ok, true);
	});
});

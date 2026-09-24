// Collector contract tests, hans: volcano alert levels — USGS HANS and JMA
// eruption warnings. Upstreams stubbed at fetch.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
	collect as hans,
	hansSeverity,
	jmaVolcanoRows,
	jmaVolcanoSeverity,
} from "../src/workers/collectors/hans.js";
import {
	eventsOf,
	healthOf,
	json,
	resetTables,
	restoreFetch,
	stubFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

const USGS = [
	{
		volcano_name: "Kilauea",
		vnum: "332010",
		alert_level: "WATCH",
		color_code: "ORANGE",
		obs_abbr: "HVO",
		notice_url: "https://example.test/kilauea",
	},
	{
		volcano_name: "Quiet Cone",
		vnum: null,
		alert_level: "NORMAL",
		color_code: "GREEN",
		obs_abbr: "AVO",
	},
	{ alert_level: "NORMAL", color_code: "GREEN" },
];

/** One warning.json event: the volcano block plus the municipal block the
 * collector must ignore. */
const jmaEvent = (
	code: string,
	name: string,
	warnCode: string,
	warnName: string,
	at: string,
) => ({
	reportDatetime: at,
	eventId: code,
	volcanoInfos: [
		{
			type: "噴火警報・予報（対象火山）",
			items: [
				{
					name: warnName,
					code: warnCode,
					condition: "継続",
					areas: [{ name, code }],
				},
			],
		},
		{
			type: "噴火警報・予報（対象市町村等）",
			items: [
				{
					name: "火口周辺警報",
					code: "02",
					areas: [{ name: "鹿児島市", code: "4620100" }],
				},
			],
		},
	],
});
const JMA_LIST = [
	{ code: "506", latlon: ["31.593", "130.657"], name_en: "Sakurajima" },
	{ code: "108", latlon: ["43.418", "142.686"], name_en: "Tokachidake" },
	{ code: "329", latlon: ["24.751", "141.289"], name_en: "Ioto" },
];

describe("hans: USGS", () => {
	it("severity maps color/level words", () => {
		assert.equal(hansSeverity("RED", "WARNING"), "critical");
		assert.equal(hansSeverity("ORANGE", "WATCH"), "watch");
		assert.equal(hansSeverity("YELLOW", "ADVISORY"), "watch");
		assert.equal(hansSeverity("GREEN", "NORMAL"), "info");
		assert.equal(hansSeverity(null, null), "info");
	});
});

describe("hans: JMA eruption warnings", () => {
	it("grades warning codes", () => {
		assert.equal(jmaVolcanoSeverity("15"), "critical");
		assert.equal(jmaVolcanoSeverity("14"), "critical");
		assert.equal(jmaVolcanoSeverity("13"), "watch");
		assert.equal(jmaVolcanoSeverity("22"), "watch");
		assert.equal(jmaVolcanoSeverity("36"), "watch");
		assert.equal(jmaVolcanoSeverity("11"), "info");
		assert.equal(jmaVolcanoSeverity("25", "居住地域厳重警戒"), "critical");
	});
	it("reads only the volcano block, in English", () => {
		const rows = jmaVolcanoRows([
			jmaEvent(
				"506",
				"桜島",
				"13",
				"レベル３（入山規制）",
				"2022-07-27T20:00:00+09:00",
			),
		]);
		assert.deepEqual(rows, [
			{
				code: "506",
				volcano: "桜島",
				warning: "Level 3 (do not approach the volcano)",
				warningCode: "13",
				condition: "継続",
				since: "2022-07-27T20:00:00+09:00",
			},
		]);
	});
});

describe("hans collect()", () => {
	it("stores both agencies; JMA at the summit, pruned when lowered off", async () => {
		let events = [
			jmaEvent(
				"506",
				"桜島",
				"13",
				"レベル３（入山規制）",
				"2022-07-27T20:00:00+09:00",
			),
			jmaEvent(
				"108",
				"十勝岳",
				"14",
				"レベル４（高齢者等避難）",
				"2026-09-12T09:30:00+09:00",
			),
		];
		stubFetch([
			[/volcanoes\.usgs\.gov/, json(USGS)],
			[/volcano\/data\/warning\.json/, () => json(events)()],
			[/volcano_list\.json/, json(JMA_LIST)],
		]);
		const r = await hans();
		assert.deepEqual(r, { ok: true, count: 4 });
		assert.deepEqual(
			(await eventsOf("hans")).map((x) => [x.id, x.severity]),
			[
				["hans:332010", "watch"],
				["hans:Quiet-Cone", "info"],
			],
		);
		assert.deepEqual(
			(await eventsOf("jma-volcano")).map((x) => [
				x.id,
				x.severity,
				x.title,
				x.lat,
				x.lon,
			]),
			[
				[
					"jma-volcano:108",
					"critical",
					"Tokachidake — Level 4 (prepare to evacuate)",
					43.418,
					142.686,
				],
				[
					"jma-volcano:506",
					"watch",
					"Sakurajima — Level 3 (do not approach the volcano)",
					31.593,
					130.657,
				],
			],
		);
		// Tokachidake drops back to normal: it leaves the list and the map.
		events = events.slice(0, 1);
		await hans();
		assert.deepEqual(
			(await eventsOf("jma-volcano")).map((x) => x.id),
			["jma-volcano:506"],
		);
	});
	it("one agency down fails only its own source", async () => {
		stubFetch([
			[/volcanoes\.usgs\.gov/, json(USGS)],
			[/volcano\/data\/warning\.json/, json({ error: "maintenance" })],
		]);
		const r = await hans();
		assert.equal(r.ok, true);
		assert.equal((await healthOf("hans")).ok, true);
		assert.equal((await healthOf("jma-volcano")).ok, false);
		// Its last good picture stays until it answers again.
		assert.equal((await eventsOf("jma-volcano")).length, 1);
	});
});

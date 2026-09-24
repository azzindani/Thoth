// Collector contract tests, warnings: official public warnings (Environment Canada, EA floods, warnung.bund.de providers, Hong Kong Observatory, Japan Meteorological Agency).
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as warnings from "../src/workers/collectors/warnings.js";
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

const ECCC = {
	type: "FeatureCollection",
	features: [
		{
			id: "a1",
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[-80, 46],
						[-78, 46],
						[-78, 48],
						[-80, 48],
						[-80, 46],
					],
				],
			},
			properties: {
				alert_type: "warning",
				alert_short_name_en: "Rainfall (warning)",
				risk_colour_en: "orange",
				feature_name_en: "Sudbury",
				province: "ON",
				publication_datetime: "2026-09-24T01:00:00Z",
				expiration_datetime: "2099-01-01T00:00:00Z",
			},
		},
		{
			id: "a2",
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[-70, 46],
						[-69, 46],
						[-69, 47],
						[-70, 46],
					],
				],
			},
			properties: {
				alert_type: "advisory",
				alert_short_name_en: "Frost (advisory)",
				risk_colour_en: "yellow",
				feature_name_en: "Old",
				expiration_datetime: "2000-01-01T00:00:00Z",
			},
		},
	],
};
const EA = {
	items: [
		{
			floodAreaID: "053FWF",
			description: "River Witham at Lincoln",
			severity: "Flood Warning",
			severityLevel: 2,
			timeRaised: "2026-09-24T02:00:00",
			message: "Flooding expected",
			floodArea: { county: "Lincolnshire", riverOrSea: "River Witham" },
		},
		{
			floodAreaID: "999WAF",
			description: "Lifted",
			severity: "Warning no Longer in Force",
			severityLevel: 4,
		},
	],
};
const MOWAS = [
	{
		id: "mow.DE-1",
		version: 2,
		startDate: "2026-09-04T13:05:28+02:00",
		severity: "Severe",
		type: "Alert",
		i18nTitle: { de: "Gefahr durch Rauchgase", en: "Fumes" },
	},
	{
		id: "mow.DE-2",
		severity: "Minor",
		type: "Cancel",
		i18nTitle: { en: "Alert" },
	},
];
const MOWAS_GEO = {
	type: "FeatureCollection",
	features: [
		{
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[7, 49],
						[9, 49],
						[9, 51],
						[7, 51],
						[7, 49],
					],
				],
			},
		},
	],
};

describe("warnings: Environment Canada, EA floods, MoWaS", () => {
	it("severity rules", () => {
		assert.equal(warnings.ecccSeverity("red", "warning"), "critical");
		assert.equal(warnings.ecccSeverity("", "warning"), "watch");
		assert.equal(warnings.ecccSeverity("yellow", "advisory"), "info");
		assert.equal(warnings.eaSeverity(1), "critical");
		assert.equal(warnings.eaSeverity(4), null);
		assert.equal(warnings.capSeverity("Extreme"), "critical");
		assert.equal(warnings.capSeverity("Moderate"), "watch");
	});
	it("stores current warnings as located markers and skips lifted ones", async () => {
		let areaCalls = 0;
		stubFetch([
			[/weather-alerts/, json(ECCC)],
			[
				/floodAreas\/053FWF/,
				() => {
					areaCalls++;
					return json({ items: { lat: 53.22, long: -0.55 } })();
				},
			],
			[/flood-monitoring\/id\/floods/, json(EA)],
			[/mowas\/mapData/, json(MOWAS)],
			[/warnings\/mow\.DE-1\.geojson/, json(MOWAS_GEO)],
		]);
		const r = await warnings.collect();
		assert.equal(r.ok, true);
		const ec = await eventsOf("eccc-alerts");
		assert.deepEqual(
			ec.map((x) => [x.id, x.severity, x.layer]),
			[["eccc:a1", "watch", "weather"]],
		);
		assert.ok(ec[0].lon !== null && ec[0].lon > -80 && ec[0].lon < -78);
		const ea = await eventsOf("ea-floods");
		assert.deepEqual(
			ea.map((x) => [x.id, x.severity, x.layer, x.lat, x.lon]),
			[["ea-flood:053FWF", "watch", "disasters", 53.22, -0.55]],
		);
		const mw = await eventsOf("mowas");
		assert.deepEqual(
			mw.map((x) => [x.id, x.severity, x.layer]),
			[["mowas:mow.DE-1", "critical", "disasters"]],
		);
		assert.ok(mw[0].lat !== null && mw[0].lat > 49 && mw[0].lat < 51);
		// Second run: area lookups come from the cache.
		await warnings.collect();
		assert.equal(areaCalls, 1);
	});
	it("prunes lifted warnings after a successful poll", async () => {
		stubFetch([
			[/weather-alerts/, json({ type: "FeatureCollection", features: [] })],
			[/flood-monitoring\/id\/floods/, json({ items: [] })],
			[/mowas\/mapData/, json([])],
		]);
		const r = await warnings.collect();
		assert.equal(r.ok, true);
		for (const s of ["eccc-alerts", "ea-floods", "mowas"])
			assert.equal((await eventsOf(s)).length, 0, s);
	});
});

describe("warnings: warnung.bund.de providers", () => {
	it("lists every provider and stores each under its own source", async () => {
		assert.deepEqual(
			warnings.BBK_PROVIDERS.map((p) => p.source),
			["mowas", "katwarn", "biwapp", "lhp-floods", "de-police"],
		);
		const geo = json({
			type: "FeatureCollection",
			features: [
				{
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[7, 49],
								[9, 49],
								[9, 51],
								[7, 51],
								[7, 49],
							],
						],
					},
				},
			],
		});
		stubFetch([
			[/api31\/mowas\/mapData/, json([])],
			[
				/api31\/katwarn\/mapData/,
				json([
					{
						id: "kat.1",
						severity: "Moderate",
						type: "Alert",
						i18nTitle: { de: "Unwetter", en: "Storm" },
					},
				]),
			],
			[/api31\/biwapp\/mapData/, json([])],
			[
				/api31\/lhp\/mapData/,
				json([
					{
						id: "lhp.1",
						severity: "Severe",
						type: "Update",
						i18nTitle: { de: "Hochwasser" },
					},
				]),
			],
			[/api31\/police\/mapData/, json([])],
			[/api31\/warnings\/(kat|lhp)\.1\.geojson/, geo],
		]);
		await warnings.collect();
		const kat = await eventsOf("katwarn");
		assert.deepEqual(
			kat.map((x) => [x.id, x.severity, x.title]),
			[["katwarn:kat.1", "watch", "KATWARN · Storm"]],
		);
		const lhp = await eventsOf("lhp-floods");
		assert.deepEqual(
			lhp.map((x) => [x.id, x.severity, x.title]),
			[["lhp-floods:lhp.1", "critical", "LHP flood · Hochwasser"]],
		);
		assert.ok(lhp[0].lat !== null && lhp[0].lat > 49 && lhp[0].lat < 51);
	});
});

describe("warnings: Hong Kong Observatory", () => {
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
		stubFetch([
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
			(await eventsOf("hko-warn")).map((x) => [x.id, x.severity, x.title]),
			[
				[
					"hko:WTCSGNL",
					"critical",
					"HKO · Tropical Cyclone Warning Signal — TC8NE",
				],
			],
		);
		stubFetch([[/dataType=warnsum/, json({})]]);
		await warnings.collect();
		assert.equal((await eventsOf("hko-warn")).length, 0);
		assert.equal((await healthOf("hko-warn")).ok, true);
	});
});

describe("warnings: Japan Meteorological Agency", () => {
	const square = (lon: number, lat: number) => ({
		type: "MultiPolygon",
		coordinates: [
			[
				[
					[lon, lat],
					[lon + 1, lat],
					[lon + 1, lat + 1],
					[lon, lat + 1],
					[lon, lat],
				],
			],
		],
	});
	const AREAS = {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties: {
					code: "130010",
					name: "東京地方",
					enName: "Tokyo Region",
				},
				geometry: square(139, 35),
			},
			// The same code again as an island part: no English name, and it
			// must not move or rename the area.
			{
				type: "Feature",
				properties: { code: "130010", name: "東京地方", islandBold: true },
				geometry: square(150, 20),
			},
			{
				type: "Feature",
				properties: {
					code: "460040",
					name: "奄美地方",
					enName: "Amami Region",
				},
				geometry: square(129, 28),
			},
		],
	};
	// Two data types from the same office: the area's picture is the union.
	const REPORTS = [
		{
			reportDatetime: "2026-09-24T10:00:00+09:00",
			warning: {
				class10Items: [
					{
						areaCode: "130010",
						kinds: [
							{ code: "03", status: "発表" },
							{ code: "14", status: "継続" },
							{ code: "10", status: "解除" },
						],
					},
					{
						areaCode: "460040",
						kinds: [{ status: "発表警報・注意報はなし" }],
					},
				],
			},
		},
		{
			reportDatetime: "2026-09-24T11:00:00+09:00",
			warning: {
				class10Items: [
					{ areaCode: "130010", kinds: [{ code: "48", status: "発表" }] },
					{ areaCode: "999999", kinds: [{ code: "24", status: "継続" }] },
				],
			},
		},
	];
	it("grades r8 levels", () => {
		assert.equal(warnings.jmaSeverity(50), "critical");
		assert.equal(warnings.jmaSeverity(40), "critical");
		assert.equal(warnings.jmaSeverity(30), "watch");
		assert.equal(warnings.jmaSeverity(20), "info");
	});
	it("one row per area at its worst level; lifted and quiet areas left out", async () => {
		const calls = stubFetch([
			[/warning\/data\/r8\/map\.json/, json(REPORTS)],
			[/geojson\/class10s\.json/, json(AREAS)],
		]);
		await warnings.collect();
		const rows = await eventsOf("jma-warn");
		assert.deepEqual(
			rows.map((x) => [x.id, x.severity, x.title, x.lon, x.lat]),
			[
				[
					"jma:130010",
					"critical",
					"JMA · Tokyo Region — storm surge danger warning, heavy rain warning, thunderstorm advisory",
					// lib/geo averages the ring's vertices (closing one included).
					139.4,
					35.4,
				],
				// Unknown area code: kept, unplaced.
				["jma:999999", "info", "JMA · 999999 — frost advisory", null, null],
			],
		);
		assert.equal(rows[0].ts, "2026-09-24 02:00:00+00");
		// Area polygons are static: a second run does not refetch them.
		await warnings.collect();
		assert.equal(calls.filter((u) => u.includes("class10s")).length, 1);
	});
	it("an empty report list is a moved path, not a quiet day", async () => {
		stubFetch([[/warning\/data\/r8\/map\.json/, json([])]]);
		await warnings.collect();
		assert.match(
			(await healthOf("jma-warn")).error ?? "",
			/unexpected payload: no reports/,
		);
		// The last good picture stays until the feed answers again.
		assert.equal((await eventsOf("jma-warn")).length, 2);
	});
});

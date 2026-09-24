// Collector contract tests, emergencies: IFRC GO events + active appeals.
// Upstream stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as emergencies from "../src/workers/collectors/emergencies.js";
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

const daysAgo = (d: number) =>
	new Date(Date.now() - d * 86400_000).toISOString();

const event = (
	id: number,
	name: string,
	country: [string, string],
	level: number,
	start = daysAgo(3),
) => ({
	id,
	name,
	disaster_start_date: start,
	dtype: { name: "Flood" },
	countries: [{ iso3: country[0], name: country[1] }],
	ifrc_severity_level: level,
	ifrc_severity_level_display: ["Yellow", "Orange", "Red"][level],
	num_affected: 1200,
	glide: "",
	summary: "<p>Heavy&nbsp;rain.</p>",
});

const appeal = (event: number, atype: number, req: number, got: number) => ({
	code: `MDR${event}`,
	event,
	atype,
	atype_display: atype === 1 ? "Emergency Appeal" : "DREF",
	amount_requested: req,
	amount_funded: got,
	num_beneficiaries: 5000,
	status: 0,
});

describe("emergencies parsing", () => {
	it("grades by IFRC level, lifting Yellow with an Emergency Appeal", () => {
		assert.equal(emergencies.ifrcSeverity(2, []), "critical");
		assert.equal(emergencies.ifrcSeverity(1, []), "watch");
		assert.equal(emergencies.ifrcSeverity(0, []), "info");
		assert.equal(emergencies.ifrcSeverity(0, [appeal(1, 1, 10, 5)]), "watch");
		assert.equal(emergencies.ifrcSeverity(0, [appeal(1, 0, 10, 5)]), "info");
	});
	it("drops the leading ISO code from titles", () => {
		assert.equal(
			emergencies.ifrcTitle(
				"LBY: Pluvial/Flash Flood - 09-2026 - Sokna Flood ",
			),
			"Pluvial/Flash Flood - 09-2026 - Sokna Flood",
		);
		assert.equal(
			emergencies.ifrcTitle("Bangladesh: Dengue Outbreak, 2026"),
			"Bangladesh: Dengue Outbreak, 2026",
		);
	});
});

describe("emergencies", () => {
	it("maps the window's events with their appeals and prunes the rest", async () => {
		stubFetch([
			[
				/\/api\/v2\/event\//,
				json({
					results: [
						event(8094, "LBY: Flood - 09-2026 - Sokna ", ["LBY", "Libya"], 0),
						event(
							8090,
							"Bangladesh: Dengue Outbreak, 2026",
							["BGD", "Bangladesh"],
							1,
						),
						event(8001, "XXX: Unknown place", ["XXX", "Atlantis"], 2),
					],
				}),
			],
			[
				/\/api\/v2\/appeal\//,
				json({
					results: [appeal(8090, 0, 494769, 247384), appeal(8094, 1, 1000, 0)],
				}),
			],
		]);
		assert.deepEqual(await emergencies.collect(), { ok: true, count: 3 });
		let rows = await eventsOf("ifrc-go");
		assert.deepEqual(
			rows.map((r) => [r.id, r.severity, r.lat, r.lon, r.meta.fundedPct]),
			[
				["ifrc-go:8001", "critical", null, null, null],
				["ifrc-go:8090", "watch", 23.81, 90.41, 50],
				["ifrc-go:8094", "watch", 32.89, 13.19, 0],
			],
		);
		assert.equal(rows[2].title, "Flood - 09-2026 - Sokna");
		assert.equal(rows[2].url, "https://go.ifrc.org/emergencies/8094");
		// Next run: one event left the window, and appeals are down.
		stubFetch([
			[
				/\/api\/v2\/event\//,
				json({
					results: [
						event(
							8090,
							"Bangladesh: Dengue Outbreak, 2026",
							["BGD", "Bangladesh"],
							1,
						),
					],
				}),
			],
			[/\/api\/v2\/appeal\//, json({}, 503)],
		]);
		assert.deepEqual(await emergencies.collect(), { ok: true, count: 1 });
		rows = await eventsOf("ifrc-go");
		assert.deepEqual(
			rows.map((r) => r.id),
			["ifrc-go:8090"],
		);
		const h = await healthOf("ifrc-go");
		assert.match(h.error ?? "", /appeals: HTTP 503/);
	});
	it("fails honestly on an empty or changed event list", async () => {
		stubFetch([
			[/\/api\/v2\/event\//, json({ results: [] })],
			[/\/api\/v2\/appeal\//, json({ results: [] })],
		]);
		assert.equal((await emergencies.collect()).ok, false);
		assert.match(
			(await healthOf("ifrc-go")).error ?? "",
			/no events in the window/,
		);
		stubFetch([[/goadmin/, json({ detail: "moved" })]]);
		assert.equal((await emergencies.collect()).ok, false);
	});
});

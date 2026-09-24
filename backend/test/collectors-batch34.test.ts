// Collector contract tests, batch 34 (keyless loop-9): agency wildfire
// incidents (CAL FIRE, NSW RFS, VIC EMV) and official warnings (Environment
// Canada, Environment Agency floods, German MoWaS). Upstreams stubbed at fetch.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import * as warnings from "../src/workers/collectors/warnings.js";
import * as wildfires from "../src/workers/collectors/wildfires.js";
import { pointOf } from "../src/workers/lib/geo.js";

const realFetch = globalThis.fetch;
type Route = [RegExp, () => Response];
function stub(routes: Route[]) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [re, r] of routes) if (re.test(u)) return r();
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
}
const json = (x: unknown) => () =>
	new Response(JSON.stringify(x), {
		headers: { "content-type": "application/json" },
	});
const rows = (source: string) =>
	query<{
		id: string;
		title: string;
		severity: string;
		layer: string;
		lon: number | null;
		lat: number | null;
		meta: Record<string, unknown>;
	}>(
		`SELECT id, title, severity, layer, ST_X(geom) AS lon, ST_Y(geom) AS lat, meta
		   FROM events WHERE source=$1 ORDER BY id`,
		[source],
	);
const health = async (source: string) =>
	(
		await query<{ ok: boolean; error: string | null }>(
			"SELECT last_ok IS NOT NULL AS ok, error FROM feed_health WHERE source=$1",
			[source],
		)
	)[0];

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

const CALFIRE = [
	{
		Name: "Timber Fire ",
		UniqueId: "u-1",
		Updated: "2026-09-24T00:26:21Z",
		County: "Monterey",
		Location: "SE of Loma Vista",
		AcresBurned: 25452.4,
		PercentContained: 30,
		Latitude: 36.22,
		Longitude: -121.73,
		Url: "https://www.fire.ca.gov/incidents/2026/8/8/timber-fire/",
		IsActive: true,
	},
	{
		Name: "No coords",
		UniqueId: "u-2",
		Latitude: 0,
		Longitude: 0,
		IsActive: true,
	},
	{
		Name: "Closed",
		UniqueId: "u-3",
		Latitude: 38,
		Longitude: -120,
		IsActive: false,
	},
];
const RFS = {
	type: "FeatureCollection",
	features: [
		{
			geometry: {
				type: "GeometryCollection",
				geometries: [
					{ type: "Point", coordinates: [151.87, -32.77] },
					{
						type: "GeometryCollection",
						geometries: [
							{
								type: "Polygon",
								coordinates: [
									[
										[151, -32],
										[152, -32],
										[152, -33],
										[151, -32],
									],
								],
							},
						],
					},
				],
			},
			properties: {
				title: "ABUNDANCE RD, MEDOWIE",
				category: "Watch and Act",
				guid: "https://incidents.rfs.nsw.gov.au/api/v1/incidents/678279",
				pubDate: "23/09/2026 11:57:00 PM",
				description:
					"ALERT LEVEL: Watch and Act <br />LOCATION: ABUNDANCE RD <br />STATUS: Out of control <br />TYPE: Bush Fire <br />SIZE: 107 ha",
			},
		},
	],
};
const VIC = {
	type: "FeatureCollection",
	features: [
		{
			geometry: { type: "Point", coordinates: [144.5, -37.5] },
			properties: {
				feedType: "incident",
				id: "9",
				category1: "Fire",
				status: "Going",
				location: "Kyneton",
				updated: "2026-09-24T09:00:00+10:00",
				sourceOrg: "CFA",
			},
		},
		{
			geometry: { type: "Point", coordinates: [145, -38] },
			properties: {
				feedType: "incident",
				id: "10",
				category1: "Fire",
				status: "Safe",
				location: "Done",
			},
		},
		{
			geometry: { type: "Point", coordinates: [146, -38] },
			properties: {
				feedType: "incident",
				id: "11",
				category1: "Hazardous Material",
				status: "Going",
				location: "Not a fire",
			},
		},
	],
};

describe("wildfires", () => {
	it("severity rules", () => {
		assert.equal(wildfires.calfireSeverity(25_000, 30), "critical");
		assert.equal(wildfires.calfireSeverity(25_000, 80), "watch");
		assert.equal(wildfires.calfireSeverity(500, 0), "info");
		assert.equal(wildfires.auWarningSeverity("Emergency Warning"), "critical");
		assert.equal(wildfires.auWarningSeverity("Watch and Act"), "watch");
		assert.equal(wildfires.auWarningSeverity("Advice"), "info");
	});
	it("reads NSW description fields and the collection's own Point", () => {
		assert.deepEqual(
			wildfires.rfsFields("ALERT LEVEL: Advice <br />SIZE: 7 ha"),
			{
				"alert level": "Advice",
				size: "7 ha",
			},
		);
		assert.deepEqual(pointOf(RFS.features[0].geometry), {
			lon: 151.87,
			lat: -32.77,
		});
	});
	it("stores active incidents only, located, on fires", async () => {
		stub([
			[/fire\.ca\.gov/, json(CALFIRE)],
			[/rfs\.nsw/, json(RFS)],
			[/emergency\.vic/, json(VIC)],
		]);
		const r = await wildfires.collect();
		assert.equal(r.ok, true);
		assert.equal(r.count, 3);
		const cal = await rows("calfire");
		assert.deepEqual(
			cal.map((x) => [x.id, x.severity, x.layer]),
			[["calfire:u-1", "critical", "fires"]],
		);
		assert.match(cal[0].title, /Timber Fire — 25,452 ac, 30% contained/);
		const nsw = await rows("nsw-rfs");
		assert.deepEqual(
			nsw.map((x) => [x.id, x.severity, x.lon, x.lat]),
			[["nsw-rfs:678279", "watch", 151.87, -32.77]],
		);
		assert.equal(nsw[0].meta.status, "Out of control");
		const vic = await rows("vic-emv");
		assert.deepEqual(
			vic.map((x) => [x.id, x.severity]),
			[["vic-emv:incident:9", "watch"]],
		);
	});
	it("prunes incidents that closed; a changed payload fails without pruning", async () => {
		stub([
			[/fire\.ca\.gov/, json([])],
			[/rfs\.nsw/, json({ error: "maintenance" })],
			[/emergency\.vic/, json(VIC)],
		]);
		const r = await wildfires.collect();
		assert.equal(r.ok, true);
		assert.equal((await rows("calfire")).length, 0);
		assert.equal(
			(await rows("nsw-rfs")).length,
			1,
			"failed poll must not empty the layer",
		);
		const h = await health("nsw-rfs");
		assert.match(h.error ?? "", /unexpected payload/);
	});
});

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

describe("warnings", () => {
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
		stub([
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
		const ec = await rows("eccc-alerts");
		assert.deepEqual(
			ec.map((x) => [x.id, x.severity, x.layer]),
			[["eccc:a1", "watch", "weather"]],
		);
		assert.ok(ec[0].lon !== null && ec[0].lon > -80 && ec[0].lon < -78);
		const ea = await rows("ea-floods");
		assert.deepEqual(
			ea.map((x) => [x.id, x.severity, x.layer, x.lat, x.lon]),
			[["ea-flood:053FWF", "watch", "disasters", 53.22, -0.55]],
		);
		const mw = await rows("mowas");
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
		stub([
			[/weather-alerts/, json({ type: "FeatureCollection", features: [] })],
			[/flood-monitoring\/id\/floods/, json({ items: [] })],
			[/mowas\/mapData/, json([])],
		]);
		const r = await warnings.collect();
		assert.equal(r.ok, true);
		for (const s of ["eccc-alerts", "ea-floods", "mowas"])
			assert.equal((await rows(s)).length, 0, s);
	});
});

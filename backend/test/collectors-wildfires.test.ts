// Collector contract tests, wildfires: official agency fire incidents and warnings (CAL FIRE, NSW RFS, VIC EMV, QLD Fire, WA DFES, ACT ESA) on fires.
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as wildfires from "../src/workers/collectors/wildfires.js";
import { pointOf } from "../src/workers/lib/geo.js";
import {
	eventsOf,
	healthOf,
	json,
	resetTables,
	restoreFetch,
	stubFetch,
	text,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

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

describe("wildfires: CAL FIRE, NSW RFS, VIC EMV", () => {
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
		stubFetch([
			[/fire\.ca\.gov/, json(CALFIRE)],
			[/rfs\.nsw/, json(RFS)],
			[/emergency\.vic/, json(VIC)],
		]);
		const r = await wildfires.collect();
		assert.equal(r.ok, true);
		assert.equal(r.count, 3);
		const cal = await eventsOf("calfire");
		assert.deepEqual(
			cal.map((x) => [x.id, x.severity, x.layer]),
			[["calfire:u-1", "critical", "fires"]],
		);
		assert.match(cal[0].title, /Timber Fire — 25,452 ac, 30% contained/);
		const nsw = await eventsOf("nsw-rfs");
		assert.deepEqual(
			nsw.map((x) => [x.id, x.severity, x.lon, x.lat]),
			[["nsw-rfs:678279", "watch", 151.87, -32.77]],
		);
		assert.equal(nsw[0].meta.status, "Out of control");
		const vic = await eventsOf("vic-emv");
		assert.deepEqual(
			vic.map((x) => [x.id, x.severity]),
			[["vic-emv:incident:9", "watch"]],
		);
	});
	it("prunes incidents that closed; a changed payload fails without pruning", async () => {
		stubFetch([
			[/fire\.ca\.gov/, json([])],
			[/rfs\.nsw/, json({ error: "maintenance" })],
			[/emergency\.vic/, json(VIC)],
		]);
		const r = await wildfires.collect();
		assert.equal(r.ok, true);
		assert.equal((await eventsOf("calfire")).length, 0);
		assert.equal(
			(await eventsOf("nsw-rfs")).length,
			1,
			"failed poll must not empty the layer",
		);
		const h = await healthOf("nsw-rfs");
		assert.match(h.error ?? "", /unexpected payload/);
	});
});

const QLD = {
	type: "FeatureCollection",
	features: [
		{
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[151, -24],
						[152, -24],
						[152, -25],
						[151, -24],
					],
				],
			},
			properties: {
				UniqueID: "WARN-798",
				WarningTitle: "PREPARE TO LEAVE - Lowmead and Colosseum",
				WarningLevel: "Watch and Act",
				WarningArea: "Between Clarkes Road and Mackellor Road",
				Header: "A dangerous fast moving fire is burning near Mackellor Road.",
				Latitude: -24.5079,
				Longitude: 151.6622,
				ItemDateTimeLocal_ISO: "2026-09-24T12:56:23+10:00",
			},
		},
		{
			geometry: { type: "Point", coordinates: [151.84, -28.94] },
			properties: {
				UniqueID: "QF3-26-116096",
				WarningTitle: "Information - ",
				WarningLevel: "Information",
				WarningArea: null,
				CurrentStatus: "Going",
				GroupedType: "FIRE VEGETATION",
				Location: "Unknown",
				Jurisdiction: "3 South Western Region",
				Latitude: -28.94373,
				Longitude: 151.84052,
				ItemDateTimeLocal_ISO: "2026-09-03T03:49:17+10:00",
			},
		},
	],
};
const WA_INCIDENTS = {
	incidents: [
		{
			id: "inc-1",
			"incident-type": "Bushfire",
			"incident-status": "On scene",
			suburbs: ["LOWER CHITTERING"],
			location: { latitude: -31.568, longitude: 116.055 },
			updatedAt: "2026-09-24T05:27:34.006Z",
		},
		{
			id: "inc-2",
			"incident-type": "Other Incident",
			location: { latitude: -31, longitude: 115 },
		},
	],
};
const WA_WARNINGS = {
	warnings: [
		{
			id: "w-1",
			entitySubType: "warnings_bushfire--watch-and-act",
			headline: "Bushfire Watch and Act",
			suburbs: ["STURT CREEK"],
			"alert-line": "<p>A bushfire <b>Watch and Act</b> is in place.</p>",
			"geo-source": {
				features: [
					{
						geometry: {
							type: "Polygon",
							coordinates: [
								[
									[127, -19],
									[128, -19],
									[128, -20],
									[127, -19],
								],
							],
						},
					},
					{ geometry: { type: "Point", coordinates: [127.5, -19.4] } },
				],
			},
			updatedAt: "2026-09-24T01:45:43.585Z",
		},
		{
			id: "w-2",
			entitySubType: "warnings_smoke-alert",
			"geo-source": {
				features: [{ geometry: { type: "Point", coordinates: [116, -32] } }],
			},
		},
		{
			id: "w-3",
			entitySubType: "warnings_flood--advice",
			"geo-source": { features: [] },
		},
	],
};
const ACT = `<?xml version="1.0"?><rss version="2.0"><channel><pubDate>2026-09-24 15:29 AEST</pubDate>
<item><title>GRASS FIRE - BRUCE</title><type>GRASS FIRE</type><agency>Fire</agency><description>Incident: GRASS FIRE - BRUCE&#xD;
Location: RADFORD FIRE TRAIL, BRUCE&#xD;
Status: On Scene&#xD;
Updated: 23 Sep 2026 19:49:20.82&#xD;
</description><guid>015325-22092026</guid><georss:point xmlns:georss="http://www.georss.org/georss">-35.24 149.08</georss:point><controlStatus>Going</controlStatus></item>
<item><title>AMBULANCE RESPONSE - PHILLIP</title><type>AMBULANCE RESPONSE</type><agency>Ambulance</agency><description>Incident: x</description><guid>999</guid><georss:point>-35.3 149.1</georss:point><controlStatus>Not Applicable</controlStatus></item>
</channel></rss>`;

describe("wildfires: QLD Fire, WA DFES, ACT ESA", () => {
	it("helpers", () => {
		assert.equal(
			wildfires.waWarningLevel("warnings_bushfire--emergency-warning"),
			"emergency warning",
		);
		assert.equal(
			wildfires.waWarningLevel("warnings_smoke-alert"),
			"smoke alert",
		);
		assert.equal(
			wildfires.actLocalToIso("23 Sep 2026 19:49:20.82", 10),
			"2026-09-23T09:49:20.000Z",
		);
		assert.equal(wildfires.actLocalToIso("garbage", 10), null);
	});
	it("stores QLD, WA and ACT fire items located, skipping non-fire items", async () => {
		stubFetch([
			[/BushfireCurrentIncidents/, json(QLD)],
			[/emergency\.wa\.gov\.au\/v1\/incidents/, json(WA_INCIDENTS)],
			[/emergency\.wa\.gov\.au\/v1\/warnings/, json(WA_WARNINGS)],
			[/esa\.act\.gov\.au/, text(ACT)],
		]);
		const r = await wildfires.collect();
		assert.equal(r.ok, true);

		const qld = await eventsOf("qld-fire");
		assert.deepEqual(
			qld.map((x) => [x.id, x.severity]),
			[
				["qld-fire:QF3-26-116096", "info"],
				["qld-fire:WARN-798", "watch"],
			],
		);
		assert.match(
			qld[0].title,
			/fire vegetation — 3 South Western Region \(Going\)/,
		);
		assert.deepEqual([qld[1].lat, qld[1].lon], [-24.5079, 151.6622]);

		const wa = await eventsOf("wa-dfes");
		assert.deepEqual(
			wa.map((x) => [x.id, x.severity]),
			[
				["wa-dfes:incident:inc-1", "info"],
				["wa-dfes:warning:w-1", "watch"],
				["wa-dfes:warning:w-2", "info"],
			],
		);
		// The warning's own Point wins over its area polygon.
		assert.deepEqual([wa[1].lon, wa[1].lat], [127.5, -19.4]);

		const act = await eventsOf("act-esa");
		assert.deepEqual(
			act.map((x) => [x.id, x.severity]),
			[["act-esa:015325-22092026", "watch"]],
		);
		assert.match(act[0].ts, /^2026-09-23 09:49:20/);
	});
	it("a WA payload without warnings[] fails without pruning", async () => {
		stubFetch([
			[/emergency\.wa\.gov\.au\/v1\/incidents/, json(WA_INCIDENTS)],
			[/emergency\.wa\.gov\.au\/v1\/warnings/, json({ error: "x" })],
		]);
		await wildfires.collect();
		assert.equal((await eventsOf("wa-dfes")).length, 3);
	});
});

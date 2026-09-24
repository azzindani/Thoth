// Collector contract tests, batch 35 (keyless loop-10): QLD Fire, WA DFES and
// ACT ESA on `wildfires`; the other warnung.bund.de providers (KATWARN,
// BIWAPP, LHP floods, police) on `warnings`. Upstreams stubbed at fetch.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import * as warnings from "../src/workers/collectors/warnings.js";
import * as wildfires from "../src/workers/collectors/wildfires.js";

const realFetch = globalThis.fetch;
type Route = [RegExp, () => Response];
function stub(routes: Route[]) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [re, r] of routes) if (re.test(u)) return r();
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
}
const json = (x: unknown) => () => new Response(JSON.stringify(x));
const text = (x: string) => () => new Response(x);
const rows = (source: string) =>
	query<{
		id: string;
		title: string;
		severity: string;
		ts: string;
		lon: number | null;
		lat: number | null;
		meta: Record<string, unknown>;
	}>(
		`SELECT id, title, severity, ts::text, ST_X(geom) AS lon, ST_Y(geom) AS lat, meta
		   FROM events WHERE source=$1 ORDER BY id`,
		[source],
	);

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
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

describe("wildfires batch35", () => {
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
		stub([
			[/BushfireCurrentIncidents/, json(QLD)],
			[/emergency\.wa\.gov\.au\/v1\/incidents/, json(WA_INCIDENTS)],
			[/emergency\.wa\.gov\.au\/v1\/warnings/, json(WA_WARNINGS)],
			[/esa\.act\.gov\.au/, text(ACT)],
		]);
		const r = await wildfires.collect();
		assert.equal(r.ok, true);

		const qld = await rows("qld-fire");
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

		const wa = await rows("wa-dfes");
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

		const act = await rows("act-esa");
		assert.deepEqual(
			act.map((x) => [x.id, x.severity]),
			[["act-esa:015325-22092026", "watch"]],
		);
		assert.match(act[0].ts, /^2026-09-23 09:49:20/);
	});
	it("a WA payload without warnings[] fails without pruning", async () => {
		stub([
			[/emergency\.wa\.gov\.au\/v1\/incidents/, json(WA_INCIDENTS)],
			[/emergency\.wa\.gov\.au\/v1\/warnings/, json({ error: "x" })],
		]);
		await wildfires.collect();
		assert.equal((await rows("wa-dfes")).length, 3);
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
		stub([
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
		const kat = await rows("katwarn");
		assert.deepEqual(
			kat.map((x) => [x.id, x.severity, x.title]),
			[["katwarn:kat.1", "watch", "KATWARN · Storm"]],
		);
		const lhp = await rows("lhp-floods");
		assert.deepEqual(
			lhp.map((x) => [x.id, x.severity, x.title]),
			[["lhp-floods:lhp.1", "critical", "LHP flood · Hochwasser"]],
		);
		assert.ok(lhp[0].lat !== null && lhp[0].lat > 49 && lhp[0].lat < 51);
	});
});

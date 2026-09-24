// Collector contract tests, batch 32 (ROADMAP P3): FAA NAS status,
// Copernicus EMS, Digitraffic AIS, UNHCR, submarine cables, ENISA EUVD,
// Tor exits, UK FCDO. Upstreams stubbed at fetch.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import * as cables from "../src/workers/collectors/cables.js";
import * as ems from "../src/workers/collectors/ems.js";
import * as euvd from "../src/workers/collectors/euvd.js";
import * as faa from "../src/workers/collectors/faa.js";
import * as fcdo from "../src/workers/collectors/fcdo.js";
import * as tor from "../src/workers/collectors/torexits.js";
import * as unhcr from "../src/workers/collectors/unhcr.js";
import * as vessels from "../src/workers/collectors/vessels.js";

const realFetch = globalThis.fetch;
type Route = [RegExp, () => Response];
let calls: string[] = [];
function stub(routes: Route[]) {
	calls = [];
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		calls.push(u);
		for (const [re, r] of routes) if (re.test(u)) return r();
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
}
const json = (x: unknown) => () =>
	new Response(JSON.stringify(x), {
		headers: { "content-type": "application/json" },
	});
const text = (x: string) => () => new Response(x);
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
		`SELECT id, title, severity, layer, ST_X(ST_Centroid(geom)) AS lon,
		        ST_Y(ST_Centroid(geom)) AS lat, meta
		   FROM events WHERE source=$1 ORDER BY id`,
		[source],
	);

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
	// The FAA collector anchors on the airport catalog.
	await query(
		`INSERT INTO events(id, ts, source, layer, title, geom, meta) VALUES
		 ('static:airports:sfo', now(), 'static', 'airports', 'SFO',
		  ST_SetSRID(ST_MakePoint(-122.375, 37.619), 4326),
		  '{"iata":"SFO","name":"San Francisco International","country":"US","lat":37.619,"lon":-122.375}')`,
	);
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("faa", () => {
	const XML = `<?xml version="1.0"?><AIRPORT_STATUS_INFORMATION>
<Update_Time>Tue Sep 23 12:00:00 2026 GMT</Update_Time>
<Delay_type><Name>Ground Stops</Name><Ground_Stop_List><Program><ARPT>SFO</ARPT><Reason>thunderstorms</Reason><End_Time>1:00 pm PDT</End_Time></Program></Ground_Stop_List></Delay_type>
<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>EWR</ARPT><Reason>low ceilings</Reason><Avg>1 hour</Avg><Max>2 hours</Max></Ground_Delay></Ground_Delay_List></Delay_type>
<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List><Delay><ARPT>ORD</ARPT><Reason>volume</Reason><Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type>
<Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>BAD!</ARPT><Reason>x</Reason></Airport></Airport_Closure_List></Delay_type>
</AIRPORT_STATUS_INFORMATION>`;
	it("parses every status kind, skips malformed codes", () => {
		const s = faa.parseFaaStatus(XML);
		assert.deepEqual(
			s.map((x) => [x.kind, x.arpt]),
			[
				["ground-stop", "SFO"],
				["ground-delay", "EWR"],
				["delay", "ORD"],
			],
		);
		assert.equal(s[0].detail, "until 1:00 pm PDT");
		assert.equal(s[1].detail, "avg 1 hour · max 2 hours");
		assert.equal(s[2].detail, "departure 16 minutes–30 minutes, increasing");
		assert.equal(faa.faaSeverity("ground-stop"), "critical");
	});
	it("stores anchored statuses and clears airports that recover", async () => {
		stub([[/nasstatus/, text(XML)]]);
		assert.equal((await faa.collect()).ok, true);
		const r = await rows("faa-nas");
		assert.equal(r.length, 3);
		const sfo = r.find((x) => x.id === "faa:ground-stop:SFO");
		assert.ok(sfo && Math.abs((sfo.lon ?? 0) + 122.375) < 1e-6);
		assert.match(
			sfo.title,
			/Ground stop · SFO San Francisco International — thunderstorms/,
		);
		assert.equal(sfo.layer, "airwx");
		// Calm day: an empty but valid document clears the layer.
		stub([[/nasstatus/, text("<AIRPORT_STATUS_INFORMATION/>")]]);
		assert.equal((await faa.collect()).ok, true);
		assert.equal((await rows("faa-nas")).length, 0);
		// A broken upstream never empties it.
		stub([[/nasstatus/, text(XML)]]);
		await faa.collect();
		stub([[/nasstatus/, () => new Response("oops", { status: 503 })]]);
		assert.equal((await faa.collect()).ok, false);
		assert.equal((await rows("faa-nas")).length, 3);
	});
});

describe("ems", () => {
	it("reads the API with tolerant field names", () => {
		const a = ems.parseEmsApi({
			results: [
				{
					code: "EMSR812",
					name: "Flood in Emilia-Romagna",
					category: "Flood",
					activationTime: "2026-09-20T08:00:00Z",
					centroid: "POINT (11.3 44.5)",
					countries: [{ name: "Italy" }],
					closed: false,
				},
				{ code: "junk" },
			],
		});
		assert.equal(a.length, 1);
		assert.deepEqual([a[0].lon, a[0].lat], [11.3, 44.5]);
		assert.deepEqual(a[0].countries, ["Italy"]);
	});
	it("falls back to RSS when the API fails", async () => {
		stub([
			[/dashboard-api/, () => new Response("down", { status: 502 })],
			[
				/activations-rapid\/feed/,
				text(
					`<rss><channel><item><title>EMSR900: Wildfire in Attica</title><pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate><georss:point>38.0 23.7</georss:point></item></channel></rss>`,
				),
			],
		]);
		const r = await ems.collect();
		assert.deepEqual([r.ok, (r as { via?: string }).via], [true, "rss"]);
		const [row] = await rows("copernicus-ems");
		assert.equal(row.id, "ems:EMSR900");
		assert.equal(row.severity, "watch");
		assert.deepEqual([row.lat, row.lon], [38, 23.7]);
	});
});

describe("vessels", () => {
	it("keeps recent, valid positions and names them", async () => {
		const now = Date.now();
		stub([
			[
				/ais\/v1\/locations/,
				json({
					type: "FeatureCollection",
					features: [
						{
							mmsi: 230001000,
							type: "Feature",
							geometry: { type: "Point", coordinates: [24.95, 60.16] },
							properties: {
								sog: 12.3,
								cog: 90,
								heading: 88,
								navStat: 0,
								timestampExternal: now - 60e3,
							},
						},
						{
							mmsi: 230002000,
							type: "Feature",
							geometry: { type: "Point", coordinates: [181, 91] },
							properties: { timestampExternal: now },
						},
						{
							mmsi: 230003000,
							type: "Feature",
							geometry: { type: "Point", coordinates: [22, 60] },
							properties: { timestampExternal: now - 3 * 3600e3 },
						},
					],
				}),
			],
			[
				/ais\/v1\/vessels/,
				json([
					{
						mmsi: 230001000,
						name: "FINNSTAR",
						shipType: 70,
						destination: "TRAVEMUNDE",
					},
				]),
			],
		]);
		const r = await vessels.collect();
		assert.equal(r.ok, true);
		const v = await rows("digitraffic-ais");
		assert.deepEqual(
			v.map((x) => x.id),
			["ais:fi:230001000"],
		);
		assert.equal(v[0].title, "FINNSTAR · cargo · 12.3 kn · → TRAVEMUNDE");
		assert.equal(v[0].meta.track, 88);
		assert.ok(calls.every((u) => !u.includes("?key")));
	});
});

describe("unhcr", () => {
	it("uses the newest year with data and sums displacement", async () => {
		const y = new Date().getUTCFullYear();
		stub([
			[new RegExp(`yearFrom=${y - 1}`), json({ items: [] })],
			[
				new RegExp(`yearFrom=${y - 2}`),
				json({
					items: [
						{
							year: y - 2,
							coo_name: "Syrian Arab Rep.",
							coo_iso: "SYR",
							refugees: 6000000,
							asylum_seekers: "100000",
							idps: 7000000,
							oip: 0,
							stateless: "-",
						},
						{
							year: y - 2,
							coo_name: "Tiny",
							coo_iso: "TNY",
							refugees: 5,
							asylum_seekers: 0,
							idps: 0,
							oip: 0,
						},
						{ year: y - 2, coo_name: "-", coo_iso: "-", refugees: 999999 },
					],
				}),
			],
		]);
		const r = await unhcr.collect();
		assert.equal(r.ok, true);
		const [syr] = await rows("unhcr");
		assert.equal(syr.id, "unhcr:origin:syr");
		assert.equal(syr.severity, "critical");
		assert.equal(syr.layer, "displacement");
		assert.match(syr.title, /^13\.1M displaced from Syrian Arab Rep\./);
		assert.ok(syr.lat && Math.abs(syr.lat - 33.51) < 0.01, "Damascus anchor");
		assert.equal((await rows("unhcr")).length, 1);
	});
});

describe("cables", () => {
	it("stores routes as lines and landings as points", async () => {
		stub([
			[
				/cable-geo\.json/,
				json({
					features: [
						{
							type: "Feature",
							properties: { id: "2africa", name: "2Africa", color: "#939597" },
							geometry: {
								type: "MultiLineString",
								coordinates: [
									[
										[0, 0],
										[10, 10],
									],
									[
										[10, 10],
										[20, 5],
									],
								],
							},
						},
						{
							type: "Feature",
							properties: { id: "bad id!" },
							geometry: {
								type: "LineString",
								coordinates: [
									[0, 0],
									[1, 1],
								],
							},
						},
					],
				}),
			],
			[
				/landing-point-geo\.json/,
				json({
					features: [
						{
							type: "Feature",
							properties: { id: "marseille-france", name: "Marseille, France" },
							geometry: { type: "Point", coordinates: [5.37, 43.3] },
						},
					],
				}),
			],
		]);
		const r = await cables.collect();
		assert.equal(r.ok, true);
		const g = await query<{ id: string; t: string }>(
			`SELECT id, GeometryType(geom) AS t FROM events WHERE source='submarine-cables' ORDER BY id`,
		);
		assert.deepEqual(g, [
			{ id: "cable-landing:marseille-france", t: "POINT" },
			{ id: "cable:2africa", t: "MULTILINESTRING" },
		]);
	});
});

describe("euvd", () => {
	it("merges the three lists; exploited wins", async () => {
		const v = (id: string, score: number) => ({
			id,
			description: "Remote code execution",
			datePublished: "2026-09-20T10:00:00Z",
			baseScore: score,
			aliases: "CVE-2026-12345\n",
			enisaIdVendor: [{ vendor: { name: "Acme" } }],
			enisaIdProduct: [{ product: { name: "Gateway" } }],
		});
		stub([
			[/exploitedvulnerabilities/, json([v("EUVD-2026-1", 6.5)])],
			[/criticalvulnerabilities/, json({ items: [v("EUVD-2026-2", 9.8)] })],
			[
				/lastvulnerabilities/,
				json([v("EUVD-2026-1", 6.5), v("EUVD-2026-3", 5)]),
			],
		]);
		assert.equal((await euvd.collect()).ok, true);
		const r = await rows("enisa-euvd");
		assert.deepEqual(
			r.map((x) => [x.id, x.severity]),
			[
				["euvd:EUVD-2026-1", "critical"],
				["euvd:EUVD-2026-2", "critical"],
				["euvd:EUVD-2026-3", "info"],
			],
		);
		assert.match(
			r[0].title,
			/EUVD-2026-1 \(CVE-2026-12345\) · Acme Gateway · CVSS 6\.5 · exploited/,
		);
	});
	it("fails honestly when every list is down", async () => {
		stub([]);
		const r = await euvd.collect();
		assert.equal(r.ok, false);
	});
});

describe("tor exits", () => {
	it("aggregates relays per country with exit share", async () => {
		const relay = (country: string, country_name: string, p: number) => ({
			country,
			country_name,
			exit_probability: p,
		});
		stub([
			[
				/onionoo/,
				json({
					relays_published: "2026-09-23 11:00:00",
					relays: [
						relay("de", "Germany", 0.2),
						relay("de", "Germany", 0.05),
						relay("nl", "Netherlands", 0.1),
						relay("", "", 0.01),
					],
				}),
			],
		]);
		assert.equal((await tor.collect()).ok, true);
		const r = await rows("tor-onionoo");
		assert.deepEqual(
			r.map((x) => x.id),
			["tor:exit:de", "tor:exit:nl"],
		);
		assert.equal(
			r[0].title,
			"Tor exits · Germany: 2 relays, 25% of exit capacity",
		);
		assert.ok(r[0].lat, "anchored on Berlin");
	});
});

describe("fcdo", () => {
	beforeEach(() => {
		calls = [];
	});
	const index = (updated: string) =>
		json({
			links: {
				children: [
					{
						title: "Afghanistan",
						base_path: "/foreign-travel-advice/afghanistan",
						public_updated_at: updated,
						details: { country: { name: "Afghanistan", slug: "afghanistan" } },
					},
					{
						title: "France",
						base_path: "/foreign-travel-advice/france",
						public_updated_at: updated,
						details: { country: { name: "France", slug: "france" } },
					},
				],
			},
		});
	it("maps alert levels", () => {
		assert.equal(
			fcdo.fcdoLevel(["avoid_all_travel_to_whole_country"])?.severity,
			"critical",
		);
		assert.equal(
			fcdo.fcdoLevel(["avoid_all_travel_to_parts"])?.severity,
			"watch",
		);
		assert.equal(
			fcdo.fcdoLevel(["avoid_all_but_essential_travel_to_parts"])?.severity,
			"info",
		);
		assert.equal(fcdo.fcdoLevel([]), null);
	});
	it("stores alerting countries and skips unchanged pages", async () => {
		const routes: Route[] = [
			[/foreign-travel-advice$/, index("2026-09-01T00:00:00Z")],
			[
				/foreign-travel-advice\/afghanistan$/,
				json({
					details: { alert_status: ["avoid_all_travel_to_whole_country"] },
				}),
			],
			[
				/foreign-travel-advice\/france$/,
				json({ details: { alert_status: [] } }),
			],
		];
		stub(routes);
		const r = await fcdo.collect();
		assert.deepEqual([r.ok, (r as { count?: number }).count], [true, 1]);
		const [af] = await rows("uk-fcdo");
		assert.equal(af.id, "travel:uk:afghanistan");
		assert.equal(af.severity, "critical");
		assert.equal(af.layer, "advisories");
		// Same index stamps → no country page is fetched again.
		stub(routes);
		await fcdo.collect();
		assert.deepEqual(
			calls.filter((u) => /advice\/./.test(u)),
			[],
		);
	});
});

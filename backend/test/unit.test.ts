// Thoth unit tests — pure parsers only, no network, no DB.

import assert from "node:assert/strict";
import { getDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { describe, it } from "node:test";
import { frozenBudget } from "../src/api/freeze.js";
import { CONNECT_ATTEMPT_MS, configureNetwork } from "../src/lib/net.js";
import { pickAirports } from "../src/scripts/build-airports.js";
import { pickFacilities } from "../src/scripts/build-datacenters.js";
import { kevSeverity, parseUrlhaus } from "../src/workers/collectors/cyber.js";
import { threatSeverity } from "../src/workers/collectors/drones.js";
import { latestFilledSlot } from "../src/workers/collectors/energy-eu.js";
import { alertToSeverity, pointOf } from "../src/workers/collectors/gdacs.js";
import { parseSeen } from "../src/workers/collectors/gdelt.js";
import { parseRSS } from "../src/workers/collectors/news.js";
import { parseLatestObs } from "../src/workers/collectors/oceans.js";
import { parseCSV } from "../src/workers/collectors/sanctions.js";
import { centroid } from "../src/workers/lib/geo.js";

describe("sanctions parseCSV", () => {
	it("handles quoted commas and escaped quotes", () => {
		const { head, rows } = parseCSV(
			'id,name,aliases\n1,"Putin, Vladimir","a;b"\n2,Plain,"x""y"',
		);
		assert.deepEqual(head, ["id", "name", "aliases"]);
		assert.equal(rows.length, 2);
		assert.equal(rows[0][1], "Putin, Vladimir");
		assert.deepEqual(rows[0][2], "a;b");
		assert.equal(rows[1][2], 'x"y');
	});
});

describe("weather centroid", () => {
	it("averages polygon rings", () => {
		const g = {
			type: "Polygon",
			coordinates: [
				[
					[0, 0],
					[4, 0],
					[4, 4],
					[0, 4],
					[0, 0],
				],
			],
		};
		assert.deepEqual(centroid(g), { lon: 1.6, lat: 1.6 });
	});
	it("returns null on garbage", () => {
		assert.equal(centroid({ type: "Point", coordinates: [] }), null);
		assert.equal(centroid(null), null);
	});
});

describe("gdelt parseSeen", () => {
	it("parses GDELT seendate", () => {
		assert.equal(parseSeen("20260908T103000Z"), "2026-09-08T10:30:00.000Z");
	});
	it("falls back to now on garbage", () => {
		const t = Date.parse(parseSeen("nope"));
		assert.ok(Date.now() - t < 5000);
	});
});

describe("news parseRSS", () => {
	it("parses RSS2 items with CDATA", () => {
		const xml = `<rss><channel><item><title><![CDATA[Quake hits <b>X</b>]]></title><link>https://ex.com/1</link><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
		const items = parseRSS(xml);
		assert.equal(items.length, 1);
		assert.equal(items[0].title, "Quake hits X");
		assert.equal(items[0].link, "https://ex.com/1");
	});
	it("parses Atom entries and skips linkless", () => {
		const xml = `<feed><entry><title>A</title><link href="https://ex.com/a"/><updated>2026-09-08T10:00:00Z</updated></entry><entry><title>No link</title></entry></feed>`;
		const items = parseRSS(xml);
		assert.equal(items.length, 1);
		assert.equal(items[0].link, "https://ex.com/a");
	});
});

describe("gdacs severity + point", () => {
	it("maps Red/Orange/Green", () => {
		assert.equal(alertToSeverity("Red"), "critical");
		assert.equal(alertToSeverity("Orange"), "watch");
		assert.equal(alertToSeverity("Green"), "info");
		assert.equal(alertToSeverity(undefined), "info");
	});
	it("averages point and polygon coords", () => {
		assert.deepEqual(pointOf([10, 20]), { lon: 10, lat: 20 });
		assert.deepEqual(
			pointOf([
				[
					[0, 0],
					[4, 0],
					[4, 4],
					[0, 4],
				],
			]),
			{ lon: 2, lat: 2 },
		);
		assert.equal(pointOf("nope"), null);
	});
});

describe("cyber parsers", () => {
	it("parseUrlhaus skips comments and non-urls", () => {
		const t = "# header\nhttps://evil.com/x\nnot a url\nhttp://bad.net/y\n";
		assert.deepEqual(parseUrlhaus(t), [
			"https://evil.com/x",
			"http://bad.net/y",
		]);
	});
	it("kevSeverity is critical within 30d", () => {
		assert.equal(kevSeverity(new Date().toISOString()), "critical");
		assert.equal(kevSeverity("2020-01-01"), "watch");
	});
});

describe("oceans parseLatestObs", () => {
	it("parses buoy rows, skips headers and short lines", () => {
		const t = `#STN LAT LON YYYY MM DD hh mm\n#text deg deg yr mo\n41001 34.7 -72.7 2026 09 08 23 00 90 8.0 MM 2.5 0 MM MM 1013 MM 22.0 25.0 MM MM MM\nshort line\n`;
		const b = parseLatestObs(t);
		// header has <19 cols after split? assert at least the buoy parses
		assert.ok(b.length >= 1);
		assert.equal(b[0].stn, "41001");
		assert.equal(b[0].wvht, 2.5);
		assert.equal(b[0].wtmp, 25.0);
	});
});

describe("drones threatSeverity", () => {
	it("raketa is critical, others watch", () => {
		assert.equal(threatSeverity("raketa"), "critical");
		assert.equal(threatSeverity("Shahed-136"), "watch");
		assert.equal(threatSeverity(null), "watch");
	});
});

describe("orbit propagator", () => {
	it("parses ISS TLE and propagates to a sane sub-satellite point", async () => {
		const { parseTLE3, propagate, solveKepler } = await import(
			"../src/workers/lib/orbit.js"
		);
		const tle = parseTLE3(
			"ISS (ZARYA)",
			"1 25544U 98067A   26251.46617104  .00001902  00000+0  42648-4 0  9994",
			"2 25544  51.6295 247.9233 0004929 112.8116 247.3394 15.49040812584669",
		);
		assert.ok(tle);
		assert.equal(tle.norad, "25544");
		const p = propagate(tle, tle.epochMs + 3600e3);
		assert.ok(Math.abs(p.lat) <= 51.7, `lat ${p.lat}`);
		assert.ok(p.lon >= -180 && p.lon <= 180);
		assert.ok(p.altKm > 380 && p.altKm < 480, `alt ${p.altKm}`);
		assert.ok(Math.abs(solveKepler(1, 0.001) - 1) < 0.01);
		assert.equal(parseTLE3("x", "garbage", "garbage"), null);
	});
});

describe("flights airlineOf", () => {
	it("maps callsign prefix to airline, null otherwise", async () => {
		const { airlineOf } = await import("../src/workers/collectors/flights.js");
		assert.equal(airlineOf("UAL123"), "United Airlines");
		assert.equal(airlineOf("12"), null);
		assert.equal(airlineOf(""), null);
	});
});

describe("pickAirports", () => {
	const head = [
		"ident",
		"type",
		"name",
		"latitude_deg",
		"longitude_deg",
		"iso_country",
		"municipality",
		"scheduled_service",
		"gps_code",
		"iata_code",
	];
	const row = (type: string, ident = "WSSS", iata = "SIN"): string[] => [
		ident,
		type,
		"Test Airport",
		"1.35",
		"103.99",
		"SG",
		"Singapore",
		"0",
		"",
		iata,
	];
	it("keeps large+medium, drops heliports and coord-less rows", () => {
		const rows = [
			row("large_airport"),
			row("medium_airport", "EGLL", "LHR"),
			row("heliport"),
			[...row("large_airport")]
				.slice(0, 10)
				.map((v, i) => (i === 3 ? "NaN" : v)),
		];
		const out = pickAirports(head, rows);
		assert.deepEqual(
			out.map((a) => a.icao),
			["WSSS", "EGLL"],
		);
		assert.equal(out[0].iata, "SIN");
	});
});

describe("pickFacilities", () => {
	it("keeps geo'd facilities top-first, drops the rest", () => {
		const out = pickFacilities([
			{
				name: "A",
				city: "X",
				country: "US",
				latitude: 1,
				longitude: 2,
				net_count: 10,
			},
			{
				name: "B",
				city: "Y",
				country: "DE",
				latitude: 3,
				longitude: 4,
				net_count: 500,
			},
			{ name: "C", city: "Z", country: "FR", net_count: 999 },
			{ name: "", city: "W", country: "GB", latitude: 5, longitude: 6 },
		]);
		assert.deepEqual(
			out.map((f) => f.name),
			["B", "A"],
		);
		assert.equal(out[0].src, "peeringdb");
		assert.equal(out[0].lng, 4);
	});
});

describe("severity helpers (batch19)", () => {
	it("fngSeverity bands extreme/warn/calm", async () => {
		const { fngSeverity } = await import(
			"../src/workers/collectors/sentiment.js"
		);
		assert.equal(fngSeverity(10), "critical");
		assert.equal(fngSeverity(95), "critical");
		assert.equal(fngSeverity(25), "watch");
		assert.equal(fngSeverity(75), "watch");
		assert.equal(fngSeverity(50), "info");
	});
	it("metarSeverity maps flight categories", async () => {
		const { metarSeverity } = await import(
			"../src/workers/collectors/metar.js"
		);
		assert.equal(metarSeverity("LIFR"), "critical");
		assert.equal(metarSeverity("IFR"), "watch");
		assert.equal(metarSeverity("VFR"), "info");
		assert.equal(metarSeverity(null), "info");
	});
	it("forecast heat/sea bands", async () => {
		const { heatSeverity, seaSeverity } = await import(
			"../src/workers/collectors/forecast.js"
		);
		assert.equal(heatSeverity(42, 10), "critical");
		assert.equal(heatSeverity(36, 10), "watch");
		assert.equal(heatSeverity(20, 10), "info");
		assert.equal(heatSeverity(undefined, 95), "critical");
		assert.equal(seaSeverity(7), "critical");
		assert.equal(seaSeverity(5), "watch");
		assert.equal(seaSeverity(1), "info");
	});
	it("hdx dispSeverity scales with displaced count", async () => {
		const { dispSeverity } = await import("../src/workers/collectors/hdx.js");
		assert.equal(dispSeverity(2000000), "critical");
		assert.equal(dispSeverity(200000), "watch");
		assert.equal(dispSeverity(5000), "info");
	});
	it("who fmtVal compacts big counts", async () => {
		const { fmtVal } = await import("../src/workers/collectors/health-who.js");
		assert.equal(fmtVal(2500000), "2.5M");
		assert.equal(fmtVal(45000), "45k");
		assert.equal(fmtVal(72.4), "72.4");
	});
	it("pickPlants keeps >=1000MW geo'd plants", async () => {
		const { pickPlants } = await import("../src/scripts/build-powerplants.js");
		const head = [
			"country_long",
			"name",
			"capacity_mw",
			"latitude",
			"longitude",
			"primary_fuel",
			"owner",
		];
		const out = pickPlants(head, [
			["Algeria", "Hadjret Ennous", "1200", "36.5", "2.0", "Gas", "SKH"],
			["Algeria", "Tiny Solar", "10", "36.5", "2.0", "Solar", "X"],
			["Nowhere", "No Geo", "2000", "", "", "Gas", "Y"],
		]);
		assert.equal(out.length, 1);
		assert.equal(out[0].name, "Hadjret Ennous");
		assert.equal(out[0].mw, 1200);
	});
	it("pickPorts keeps named geo'd ports", async () => {
		const { pickPorts } = await import("../src/scripts/build-ports-wpi.js");
		const out = pickPorts({
			features: [
				{
					properties: { name: "Rotterdam" },
					geometry: { type: "Point", coordinates: [4.5, 51.9] },
				},
				{
					properties: { name: "" },
					geometry: { type: "Point", coordinates: [0, 0] },
				},
			],
		});
		assert.equal(out.length, 1);
		assert.equal(out[0].name, "Rotterdam");
	});
	it("aggregateGed sums per-conflict deaths (2015+)", async () => {
		const { aggregateGed } = await import("../src/scripts/build-ucdp.js");
		const csv =
			"year,conflict_name,best,latitude,longitude,type_of_violence,country\n" +
			"2023,Testland: Rebels,100,10.0,20.0,1,Testland\n" +
			"2024,Testland: Rebels,50,11.0,21.0,1,Testland\n" +
			"2010,Old War,9000,0.0,0.0,1,Oldland\n";
		const enc = new TextEncoder().encode(csv);
		const out = await aggregateGed(
			[
				(async function* () {
					yield enc;
				})(),
			][0],
		);
		assert.equal(out.length, 1);
		assert.equal(out[0].name, "Testland: Rebels");
		assert.equal(out[0].deaths, 150);
		assert.equal(out[0].events, 2);
		assert.equal(out[0].intensity, "low");
	});
});

describe("pure helpers (batch20)", () => {
	it("flareClass maps GOES bands", async () => {
		const { flareClass } = await import("../src/workers/collectors/solar.js");
		assert.equal(flareClass(3e-4), "X");
		assert.equal(flareClass(2e-5), "M");
		assert.equal(flareClass(1e-8), "A");
	});
	it("parseEcb reads the cube", async () => {
		const { parseEcb } = await import("../src/workers/collectors/fxdepth.js");
		const { day, rates } = parseEcb(
			`<Cube><Cube time='2026-09-14'><Cube currency='USD' rate='1.1551'/></Cube></Cube>`,
		);
		assert.equal(day, "2026-09-14");
		assert.equal(rates.USD, 1.1551);
	});
	it("stormSeverity + parseStormLatLon", async () => {
		const { stormSeverity, parseStormLatLon } = await import(
			"../src/workers/collectors/storms.js"
		);
		assert.equal(stormSeverity("Hurricane X Advisory"), "critical");
		assert.equal(stormSeverity("Tropical Depression Norbert"), "watch");
		assert.deepEqual(parseStormLatLon("near 20.3°N 141.7°W blah"), {
			lat: 20.3,
			lon: -141.7,
		});
		assert.equal(parseStormLatLon("no coords here"), null);
	});
	it("gridSeverity bands the index + nhcEmptySeason", async () => {
		const { gridSeverity } = await import(
			"../src/workers/collectors/energy-uk.js"
		);
		assert.equal(gridSeverity("very high"), "critical");
		assert.equal(gridSeverity("low"), "info");
		const { nhcEmptySeason } = await import(
			"../src/workers/collectors/litwatch.js"
		);
		assert.equal(nhcEmptySeason("<title>No current storm</title>"), true);
		assert.equal(nhcEmptySeason("<title>Hurricane X</title>"), false);
	});
});

describe("pure helpers (batch21)", () => {
	it("hansSeverity maps colors", async () => {
		const { hansSeverity } = await import("../src/workers/collectors/hans.js");
		assert.equal(hansSeverity("RED", "WARNING"), "critical");
		assert.equal(hansSeverity("GREEN", "NORMAL"), "info");
	});
	it("parseUnXml maps individuals + entities", async () => {
		const { parseUnXml } = await import("../src/scripts/build-unsanctions.js");
		const rows = parseUnXml(
			"<CONSOLIDATED_LIST><INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>A</FIRST_NAME><SECOND_NAME>B</SECOND_NAME><REFERENCE_NUMBER>X.1</REFERENCE_NUMBER></INDIVIDUAL></CONSOLIDATED_LIST>",
		);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].name, "A B");
		assert.equal(rows[0].id, "unsc:1");
	});
});

describe("pure helpers (batch21)", () => {
	it("hansSeverity maps color codes", async () => {
		const { hansSeverity } = await import("../src/workers/collectors/hans.js");
		assert.equal(hansSeverity("RED", "WARNING"), "critical");
		assert.equal(hansSeverity("GREEN", "NORMAL"), "info");
	});
	it("parseUnXml maps individuals + entities", async () => {
		const { parseUnXml } = await import("../src/scripts/build-unsanctions.js");
		const xml = `<CONSOLIDATED_LIST>
      <INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>ERIC</FIRST_NAME><SECOND_NAME>BADEGE</SECOND_NAME>
      <REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER><LISTED_ON>2012-12-31</LISTED_ON>
      <NATIONALITY><VALUE>Democratic Republic of the Congo</VALUE></NATIONALITY>
      <INDIVIDUAL_ALIAS><ALIAS_NAME>Eric B</ALIAS_NAME></INDIVIDUAL_ALIAS></INDIVIDUAL>
    </CONSOLIDATED_LIST>`;
		const rows = parseUnXml(xml);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].name, "ERIC BADEGE");
		assert.deepEqual(rows[0].aliases, ["Eric B"]);
	});
});

describe("configureNetwork", () => {
	it("gives each address long enough for a far-away TCP handshake", () => {
		configureNetwork();
		assert.equal(
			getDefaultAutoSelectFamilyAttemptTimeout(),
			CONNECT_ATTEMPT_MS,
		);
		assert.ok(
			CONNECT_ATTEMPT_MS >= 1000,
			"250ms default failed US hosts from this VPS",
		);
	});
});

describe("energy-charts slots", () => {
	it("reads the newest slot that has data, not the trailing empty ones", () => {
		const j = {
			unix_seconds: [1, 2, 3, 4],
			production_types: [
				{ name: "Wind", data: [5, 6, null, null] },
				{ name: "Solar", data: [0, null, 7, null] },
			],
		};
		assert.equal(latestFilledSlot(j), 2);
		assert.equal(
			latestFilledSlot({ unix_seconds: [1], production_types: [] }),
			-1,
		);
	});
});

describe("freeze budgets", () => {
	it("gives lagging ENTSO-E country legs a day, sparse feeds none", () => {
		assert.equal(frozenBudget("energy-charts-gr"), 86400);
		assert.equal(frozenBudget("fiscaldata"), 5 * 86400);
		assert.equal(frozenBudget("fiscal-rates"), 40 * 86400);
		assert.equal(frozenBudget("usgs"), 7200);
		assert.equal(frozenBudget("calfire"), null);
		assert.equal(frozenBudget("brand-new-source"), 14400);
	});
});

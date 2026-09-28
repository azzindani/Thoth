import { describe, expect, it } from "vitest";
import { hostOf, sourceHome, verifyLinks } from "../src/lib/sources";

describe("sourceHome", () => {
	it("exact ids, then the longest matching family prefix", () => {
		expect(sourceHome("usgs")).toBe("https://earthquake.usgs.gov");
		expect(sourceHome("usgs-blast")).toBe("https://www.usgs.gov");
		expect(sourceHome("energy-charts-de")).toBe(
			"https://www.energy-charts.info",
		);
		expect(sourceHome("tfl-arr-vic")).toBe("https://tfl.gov.uk");
	});
	it("unknown sources get no link rather than a guess", () => {
		expect(sourceHome("metalarm")).toBeNull();
		expect(sourceHome("")).toBeNull();
	});
});

describe("hostOf", () => {
	it("strips www and ignores non-web links", () => {
		expect(hostOf("https://www.bbc.com/news/x")).toBe("bbc.com");
		expect(hostOf("javascript:alert(1)")).toBeNull();
		expect(hostOf(null)).toBeNull();
	});
});

describe("verifyLinks", () => {
	const labels = (p: Parameters<typeof verifyLinks>[0]) =>
		verifyLinks(p).map((l) => l.label);
	it("aircraft by transponder hex and airline callsign", () => {
		const l = verifyLinks({
			id: "adsb:4ca7b3",
			layer: "flights",
			title: "RYR12AB",
		});
		expect(l[0].href).toBe("https://globe.adsbexchange.com/?icao=4ca7b3");
		expect(l.map((x) => x.label)).toContain("FlightAware");
	});
	it("virtual traffic is not sent to real-world trackers", () => {
		expect(
			labels({ id: "ivao:INK5EF", layer: "flights", title: "INK5EF B77L" }),
		).toEqual([]);
	});
	it("vessels by MMSI, satellites by NORAD id", () => {
		expect(labels({ id: "ais:fi:230123456", layer: "vessels" })).toEqual([
			"MarineTraffic",
			"VesselFinder",
		]);
		expect(verifyLinks({ id: "sat:25544", layer: "satellites" })[0].href).toBe(
			"https://www.n2yo.com/satellite/?s=25544",
		);
	});
	it("any located object gets the spot on public maps", () => {
		expect(labels({ id: "x", layer: "quakes", lat: 1.5, lon: 2.25 })).toEqual([
			"OpenStreetMap",
			"Google Maps",
		]);
	});
});

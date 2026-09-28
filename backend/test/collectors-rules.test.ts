// Cross-layer rules: outage at cable landings, air traffic drop near
// conflict. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { storeNormalized } from "../src/workers/lib/store.js";
import {
	landingCountry,
	outageCountry,
	RULES_SOURCE,
	rulesPass,
} from "../src/workers/rules.js";

const now = () => new Date().toISOString();
const findings = () =>
	query<{
		id: string;
		title: string;
		severity: string;
		meta: { rule: string; timeline: { id: string; url: string | null }[] };
	}>(
		"SELECT id, title, severity, meta FROM events WHERE source = $1 ORDER BY id",
		[RULES_SOURCE],
	);

const landing = (id: string, place: string, lat: number, lon: number) =>
	storeNormalized({
		id: `cable-landing:${id}`,
		ts: now(),
		source: "telegeography",
		layer: "cables",
		title: `Cable landing · ${place}`,
		url: `https://www.submarinecablemap.com/landing-point/${id}`,
		severity: "info",
		confidence: 0.9,
		lat,
		lon,
		meta: { kind: "landing" },
	});

/** A flights-drop anomaly cell (5° square) with its SW corner at lon/lat. */
const flightsDrop = (id: string, lon: number, lat: number) =>
	storeNormalized({
		id: `anomaly:flights:${id}`,
		ts: now(),
		source: "thoth-anomaly",
		layer: "anomalies",
		title: "Air traffic drop: 2 in the last hour vs usual 40 (−95%)",
		severity: "watch",
		confidence: 0.8,
		geomJson: {
			type: "Polygon",
			coordinates: [
				[
					[lon, lat],
					[lon + 5, lat],
					[lon + 5, lat + 5],
					[lon, lat + 5],
					[lon, lat],
				],
			],
		},
		meta: { layer: "flights", dir: "drop" },
	});

beforeEach(async () => {
	await query("TRUNCATE events, event_dups");
});

describe("rules", () => {
	it("reads countries from outage and landing titles", () => {
		assert.equal(
			outageCountry("internet outage — Egypt (country · EG)"),
			"egypt",
		);
		assert.equal(
			outageCountry("internet outage — Cairo (region · Egypt)"),
			"egypt",
		);
		assert.equal(outageCountry("something else"), null);
		assert.equal(landingCountry("Cable landing · Alexandria, Egypt"), "egypt");
		assert.equal(landingCountry("Cable landing · Nowhere"), null);
	});

	it("flags an internet outage where cables land, with the evidence", async () => {
		await storeNormalized({
			id: "ioda:x:country:EG:1",
			ts: now(),
			source: "ioda",
			layer: "cyber",
			title: "internet outage — Egypt (country · EG)",
			severity: "critical",
			confidence: 0.85,
		});
		await landing("alex", "Alexandria, Egypt", 31.2, 29.9);
		await landing("ps", "Port Said, Egypt", 31.26, 32.3);
		await landing("mrs", "Marseille, France", 43.3, 5.37);
		const r = await rulesPass();
		assert.equal(r["outage-at-cable-landings"], 1);
		const [f] = await findings();
		assert.ok(f);
		assert.equal(f.meta.rule, "outage-at-cable-landings");
		assert.equal(f.severity, "critical");
		assert.match(f.title, /2 landings \(Alexandria, Port Said\)/);
		// the outage and both Egyptian landings, each linked
		assert.equal(f.meta.timeline.length, 3);
		assert.ok(
			f.meta.timeline
				.filter((t) => t.id.startsWith("cable-landing:"))
				.every((t) => t.url?.startsWith("https://")),
		);
	});

	it("ignores outages in countries without landings", async () => {
		await storeNormalized({
			id: "ioda:x:country:CH:1",
			ts: now(),
			source: "ioda",
			layer: "cyber",
			title: "internet outage — Switzerland (country · CH)",
			severity: "watch",
			confidence: 0.85,
		});
		await landing("mrs", "Marseille, France", 43.3, 5.37);
		await rulesPass();
		assert.equal((await findings()).length, 0);
	});

	it("flags an air traffic drop within 300 km of conflict reports", async () => {
		await flightsDrop("near", 35, 45); // centroid 37.5E, 47.5N
		await flightsDrop("far", -100, 30);
		await storeNormalized({
			id: "conflicts:1",
			ts: now(),
			source: "usgs-blast",
			layer: "conflicts",
			title: "Explosion reported",
			severity: "watch",
			confidence: 0.6,
			lat: 47.8,
			lon: 37.8,
		});
		const r = await rulesPass();
		assert.equal(r["airspace-near-conflict"], 1);
		const [f] = await findings();
		assert.ok(f);
		assert.equal(f.id, "rule:airspace-near-conflict:anomaly:flights:near");
		assert.match(f.title, /1 conflict report within 300 km/);
	});

	it("drops a finding once its cause is gone", async () => {
		await flightsDrop("near", 35, 45);
		await storeNormalized({
			id: "conflicts:1",
			ts: now(),
			source: "usgs-blast",
			layer: "conflicts",
			title: "Explosion reported",
			severity: "watch",
			confidence: 0.6,
			lat: 47.8,
			lon: 37.8,
		});
		await rulesPass();
		assert.equal((await findings()).length, 1);
		await query("DELETE FROM events WHERE layer = 'conflicts'");
		await rulesPass();
		assert.equal((await findings()).length, 0);
	});
});

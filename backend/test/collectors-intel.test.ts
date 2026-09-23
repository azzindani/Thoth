// Intelligence layer (ROADMAP P4): duplicate quakes, incidents, anomalies.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { getAlerts, getLayerSlice } from "../src/db/queries.js";
import {
	buildIncidents,
	detectAnomalies,
	groupQuakes,
	judge,
	markDuplicates,
	sampleLayers,
} from "../src/workers/intel.js";
import { storeNormalized } from "../src/workers/lib/store.js";

const ago = (min: number) => new Date(Date.now() - min * 60e3).toISOString();

before(async () => {
	await query(
		"TRUNCATE events, raw_events, feed_health, event_dups, layer_samples",
	);
});

describe("duplicates", () => {
	it("groups one quake across agencies, USGS primary", () => {
		const base = { lat: 38.3, lon: 142.4, mag: 6.1 };
		const pairs = groupQuakes([
			{ id: "emsc:1", source: "emsc", ts: ago(10), ...base },
			{ id: "usgs:1", source: "usgs", ts: ago(10.5), ...base, lat: 38.4 },
			{ id: "geofon:1", source: "geofon", ts: ago(9.5), ...base, mag: 6.0 },
			// same place, 20 minutes later: an aftershock, not a duplicate
			{ id: "usgs:2", source: "usgs", ts: ago(-10), ...base, mag: 5.2 },
			// same time, far away
			{ id: "emsc:far", source: "emsc", ts: ago(10), ...base, lat: 10 },
		]);
		assert.deepEqual(pairs.sort(), [
			["emsc:1", "usgs:1"],
			["geofon:1", "usgs:1"],
		]);
	});
	it("hides duplicates from slices and alerts", async () => {
		for (const [id, source, lat] of [
			["usgs:q1", "usgs", 38.3],
			["emsc:q1", "emsc", 38.35],
		] as const)
			await storeNormalized({
				id,
				ts: ago(30),
				source,
				layer: "quakes",
				title: "M6.2 off Honshu",
				severity: "critical",
				lat,
				lon: 142.4,
				meta: { mag: 6.2 },
			});
		assert.equal(await markDuplicates(), 1);
		const ids = (await getLayerSlice("quakes")).map(
			(r) => (r as { id: string }).id,
		);
		assert.deepEqual(ids, ["usgs:q1"]);
		const alerts = (await getAlerts(50)).map((r) => (r as { id: string }).id);
		assert.ok(alerts.includes("usgs:q1") && !alerts.includes("emsc:q1"));
	});
});

describe("incidents", () => {
	it("clusters corroborating events across layers into one incident", async () => {
		// The quake above + a tsunami bulletin + a GDACS alert nearby.
		await storeNormalized({
			id: "ntwc:t1",
			ts: ago(20),
			source: "ntwc",
			layer: "quakes",
			title: "Tsunami advisory Honshu",
			severity: "watch",
			lat: 38.6,
			lon: 142.0,
		});
		await storeNormalized({
			id: "gdacs:eq1",
			ts: ago(15),
			source: "gdacs",
			layer: "gdacs",
			title: "Orange earthquake alert Japan",
			severity: "watch",
			lat: 38.2,
			lon: 142.9,
		});
		// Lone single-source pair elsewhere: no corroboration, no incident.
		for (const i of [1, 2])
			await storeNormalized({
				id: `firms:x${i}`,
				ts: ago(40),
				source: "firms",
				layer: "fires",
				title: "Fire",
				severity: "watch",
				lat: -15 + i * 0.1,
				lon: 130,
			});
		const r = await buildIncidents();
		assert.equal(r.incidents, 1);
		const [inc] = await query<{
			id: string;
			severity: string;
			title: string;
			meta: {
				layers: string[];
				sources: string[];
				reports: number;
				timeline: { id: string; dups: number }[];
			};
		}>(`SELECT id, severity, title, meta FROM events WHERE layer='incidents'`);
		assert.equal(inc.id, "incident:usgs:q1");
		assert.equal(inc.severity, "critical");
		assert.deepEqual(inc.meta.layers.sort(), ["gdacs", "quakes"]);
		assert.deepEqual(inc.meta.sources.sort(), ["gdacs", "ntwc", "usgs"]);
		// The EMSC duplicate is folded in as a report, not a separate event.
		assert.equal(inc.meta.reports, 4);
		assert.equal(inc.meta.timeline.find((t) => t.id === "usgs:q1")?.dups, 1);
		assert.match(inc.title, /^M6\.2 off Honshu — 4 reports · /);
		assert.match(inc.title, /near Japan$/);
	});
	it("an incident whose events age out is removed", async () => {
		await query(
			`UPDATE events SET ts = now() - interval '3 days' WHERE layer <> 'incidents'`,
		);
		assert.equal((await buildIncidents()).incidents, 0);
		const left = await query(`SELECT 1 FROM events WHERE layer='incidents'`);
		assert.equal(left.length, 0);
	});
});

describe("anomalies", () => {
	it("judges spikes and drops against a robust baseline", () => {
		const flat = Array.from({ length: 48 }, (_, i) => 10 + (i % 3));
		assert.equal(judge(12, flat, "spike"), null);
		assert.equal(judge(40, flat, "spike")?.severity, "critical");
		assert.equal(judge(26, flat, "spike")?.severity, "watch");
		assert.equal(judge(1, flat, "drop")?.severity, "critical");
		assert.equal(judge(3, flat, "drop")?.severity, "watch");
		assert.equal(judge(9, flat, "drop"), null);
		assert.equal(
			judge(99, flat.slice(0, 10), "spike"),
			null,
			"too little history",
		);
	});
	it("samples the live picture and flags an emptied cell", async () => {
		await query("TRUNCATE events, event_dups, layer_samples");
		// Two cells of flights; baseline 40/cell for two days.
		await query(
			`INSERT INTO layer_samples (ts, layer, cell, n)
			 SELECT date_trunc('hour', now()) - make_interval(hours => h), 'flights', c, 40
			   FROM generate_series(1, 48) h, unnest(ARRAY['4,11', '-15,9']) c`,
		);
		// Now: cell 4,11 (Baltic) is full, cell -15,9 empty.
		for (let i = 0; i < 80; i++)
			await storeNormalized({
				id: `flight:${i}`,
				ts: ago(1),
				source: "adsb.lol",
				layer: "flights",
				title: "flight",
				lat: 56 + (i % 4) * 0.1,
				lon: 22 + (i % 5) * 0.1,
			});
		await sampleLayers();
		const cur = await query<{ cell: string; n: number }>(
			`SELECT cell, n FROM layer_samples
			  WHERE layer='flights' AND ts = date_trunc('hour', now()) ORDER BY cell`,
		);
		assert.deepEqual(cur, [
			{ cell: "-15,9", n: 0 },
			{ cell: "4,11", n: 80 },
		]);
		const r = await detectAnomalies();
		assert.equal(r.anomalies, 1);
		const [a] = await query<{
			id: string;
			severity: string;
			title: string;
			t: string;
		}>(
			`SELECT id, severity, title, GeometryType(geom) AS t FROM events WHERE layer='anomalies'`,
		);
		assert.equal(a.id, "anomaly:flights:-15,9");
		assert.equal(a.severity, "critical");
		assert.equal(a.t, "POLYGON");
		assert.match(
			a.title,
			/^Air traffic drop near .+: 0 in the last hour vs usual 40 \(−100%\)$/,
		);
	});
	it("a dead feed never reads as an emptied sky", async () => {
		await query(`DELETE FROM events WHERE layer='flights'`);
		await sampleLayers();
		const r = await detectAnomalies();
		assert.ok(r.skipped.includes("flights"));
		const left = await query(`SELECT 1 FROM events WHERE layer='anomalies'`);
		assert.equal(left.length, 0);
	});
});

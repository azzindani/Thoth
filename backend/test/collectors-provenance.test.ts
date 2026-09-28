// Provenance read path (/api/event → getEventProvenance): the record, its
// feed's health and latest fetch, and corroborating duplicate reports.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { getEventProvenance } from "../src/db/queries.js";

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health, event_dups");
	const ins = (id: string, source: string, url: string | null) =>
		query(
			`INSERT INTO events(id, ts, source, layer, title, url, severity, geom)
       VALUES ($1, now(), $2, 'quakes', $1, $3, 'watch',
               ST_SetSRID(ST_MakePoint(100, 30), 4326))`,
			[id, source, url],
		);
	await ins("usgs:a", "usgs", "https://earthquake.usgs.gov/a");
	await ins("emsc:a", "emsc", "https://seismicportal.eu/a");
	await ins("gfz:a", "gfz", null);
	await query(
		`INSERT INTO event_dups(id, primary_id, reason) VALUES
       ('emsc:a', 'usgs:a', 'same quake'), ('gfz:a', 'usgs:a', 'same quake')`,
	);
	await query(
		`INSERT INTO feed_health(source, last_ok, last_attempt) VALUES ('usgs', now(), now())`,
	);
	await query(
		`INSERT INTO raw_events(source, layer, http_status, payload) VALUES ('usgs', 'quakes', 200, '{}')`,
	);
});

describe("provenance", () => {
	it("primary: record, feed, fetch and its corroborating reports", async () => {
		const p = await getEventProvenance("usgs:a");
		assert.ok(p);
		assert.equal(p.item.url, "https://earthquake.usgs.gov/a");
		assert.ok(p.item.ingested_at);
		assert.equal((p.feed as { source: string }).source, "usgs");
		assert.equal((p.lastFetch as { http_status: number }).http_status, 200);
		assert.deepEqual((p.related as { id: string }[]).map((r) => r.id).sort(), [
			"emsc:a",
			"gfz:a",
		]);
	});

	it("duplicate: points back at the primary and its siblings", async () => {
		const p = await getEventProvenance("emsc:a");
		const rel = p?.related as { id: string; reason: string }[];
		assert.deepEqual(rel.map((r) => r.id).sort(), ["gfz:a", "usgs:a"]);
		assert.equal(rel.find((r) => r.id === "usgs:a")?.reason, "primary");
		assert.equal(p?.feed, null);
	});

	it("unknown id is null", async () => {
		assert.equal(await getEventProvenance("nope"), null);
	});
});

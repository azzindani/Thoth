// Collector contract tests, sanctions: bulk loader + collect. Consolidated from collectors-batch5 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	parseCSV,
	collect as sanctions,
} from "../src/workers/collectors/sanctions.js";

const realFetch = globalThis.fetch;
function stub(text: string, status = 200) {
	globalThis.fetch = (async () =>
		new Response(text, { status })) as typeof fetch;
}
before(async () => {
	await query("TRUNCATE sanctions_entities, sanctions_meta");
});
after(() => {
	globalThis.fetch = realFetch;
});

const GOOD =
	`id,schema,name,aliases,countries,dataset\r\n` +
	`ofac-1,Person,"DOE, JOHN","J. DOE;JOHN DOE",IR|RU,us_ofac_sdn\r\n` +
	`ofac-2,Company,"ACME ""BEST"" CORP",,CN,us_ofac_sdn\r\n` +
	`\r\n`;

describe("sanctions parseCSV()", () => {
	it("handles quoted commas, escaped quotes, CRLF, blank lines", () => {
		const { head, rows } = parseCSV(GOOD);
		assert.deepEqual(head, [
			"id",
			"schema",
			"name",
			"aliases",
			"countries",
			"dataset",
		]);
		assert.equal(rows.length, 2);
		assert.equal(rows[0][2], "DOE, JOHN");
		assert.equal(rows[1][2], 'ACME "BEST" CORP');
	});
	it("returns empty rows on empty input", () => {
		assert.deepEqual(parseCSV("").rows, []);
	});
});

describe("sanctions collect()", () => {
	it("bulk-loads entities with split lists + meta count", async () => {
		stub(GOOD);
		const r = await sanctions();
		assert.equal(r.ok, true);
		assert.equal(r.count, 2);
		const n = await query("SELECT COUNT(*)::int c FROM sanctions_entities");
		assert.equal(n[0].c, 2);
		const e = await query(
			"SELECT aliases, countries FROM sanctions_entities WHERE id='ofac-1'",
		);
		assert.deepEqual(e[0].aliases, ["J. DOE", "JOHN DOE"]);
		assert.deepEqual(e[0].countries, ["IR", "RU"]);
		const m = await query(
			"SELECT value FROM sanctions_meta WHERE key='us_ofac_sdn_count'",
		);
		assert.equal(m[0].value, "2");
	});
	it("tolerates missing optional columns", async () => {
		stub(`id,name\nofac-9,SOLO ACTOR\n`);
		const r = await sanctions();
		assert.equal(r.ok, true);
		assert.equal(r.count, 1);
		const e = await query(
			"SELECT dataset FROM sanctions_entities WHERE id='ofac-9'",
		);
		assert.equal(e[0].dataset, "us_ofac_sdn");
	});
	it("rejects unexpected header honestly", async () => {
		stub(`foo,bar\n1,2\n`);
		const r = await sanctions();
		assert.equal(r.ok, false);
		assert.match(String(r.error), /unexpected header/);
	});
	it("marks health on HTTP failure", async () => {
		stub("down", 503);
		const r = await sanctions();
		assert.equal(r.ok, false);
		const h = await query(
			"SELECT last_ok, error FROM feed_health WHERE source='opensanctions'",
		);
		// freeze contract: failure keeps the last good timestamp, records error
		assert.ok(h[0].last_ok !== null);
		assert.match(String(h[0].error), /HTTP 503/);
	});
});

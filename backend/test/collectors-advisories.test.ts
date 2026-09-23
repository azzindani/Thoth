// Collector contract tests, advisories: US State Dept travel advisories +
// the country locator they depend on.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	collect as advisories,
	advisorySeverity,
	parseAdvisoryTitle,
} from "../src/workers/collectors/advisories.js";
import { locateCountry } from "../src/workers/lib/countries.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("advisories", () => {
	it("locates State Dept country labels", () => {
		const k = (s: string) => locateCountry(s)?.key ?? null;
		assert.equal(k("Burma (Myanmar)"), "burma");
		assert.equal(k("Korea, North"), "north korea");
		assert.equal(k("South Korea"), "south korea");
		assert.equal(
			k("Congo, Democratic Republic of the"),
			"democratic republic of the congo",
		);
		assert.equal(k("Republic of the Congo"), "republic of the congo");
		assert.equal(k("Israel, the West Bank and Gaza"), "israel");
		assert.equal(k("Côte d'Ivoire"), "cote divoire");
		assert.equal(k("The Bahamas"), "bahamas");
		assert.equal(k("Türkiye"), "turkey");
		assert.equal(k("St. Kitts and Nevis"), "saint kitts and nevis");
		assert.equal(k("Guinea-Bissau"), "guinea bissau");
		assert.equal(k("Niger"), "niger"); // never fuzzy-matched to Nigeria
		assert.equal(k("Atlantis"), null);
	});
	it("parses titles and levels", () => {
		assert.deepEqual(
			parseAdvisoryTitle("Afghanistan - Level 4: Do Not Travel"),
			{ country: "Afghanistan", level: 4, advice: "Do Not Travel" },
		);
		assert.equal(parseAdvisoryTitle("Travel Advisory Updates"), null);
		assert.deepEqual([1, 2, 3, 4].map(advisorySeverity), [
			"info",
			"info",
			"watch",
			"critical",
		]);
	});
	it("stores one row per country, located when known", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify([
					{
						Title: "Afghanistan - Level 4: Do Not Travel",
						Link: "https://travel.state.gov/af",
						Category: ["AF"],
						Summary: "<p>Do not travel&nbsp;due to armed conflict.</p>",
						Updated: "2026-09-01T00:00:00-04:00",
					},
					{ Title: "Atlantis - Level 2: Exercise Increased Caution" },
					{ Title: "Not an advisory" },
				]),
				{ status: 200 },
			)) as typeof fetch;
		const r = await advisories();
		assert.equal(r.ok, true);
		const rows = await query<{
			id: string;
			severity: string;
			body: string | null;
			located: boolean;
		}>(
			"SELECT id, severity, body, geom IS NOT NULL AS located FROM events WHERE source='state-travel' ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => [x.id, x.severity, x.located]),
			[
				["travel:us:afghanistan", "critical", true],
				["travel:us:atlantis", "info", false],
			],
		);
		assert.equal(rows[0].body, "Do not travel due to armed conflict.");
	});
});

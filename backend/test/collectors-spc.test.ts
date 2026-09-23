// Collector contract tests, spc: NOAA SPC local storm reports.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	convectiveDay,
	parseSpcCsv,
	reportTime,
	collect as spc,
	spcSeverity,
} from "../src/workers/collectors/spc.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

const CSV = `Time,F_Scale,Location,County,State,Lat,Lon,Comments
1845,UNK,2 N Pratt,Pratt,KS,37.67,-98.74,Tornado on the ground, brief. (ICT)
Time,Speed,Location,County,State,Lat,Lon,Comments
2310,80,Salina,Saline,KS,38.84,-97.61,Roof damage. (ICT)
0105,UNK,Hays,Ellis,KS,38.88,-99.33,Trees down. (GLD)
Time,Size,Location,County,State,Lat,Lon,Comments
1930,275,Wichita,Sedgwick,KS,37.69,-97.34,Baseball hail. (ICT)
1935,100,Derby,Sedgwick,KS,37.54,-97.27,(ICT)
`;

describe("spc", () => {
	it("parses the three sections, keeps commas in comments", () => {
		const r = parseSpcCsv(CSV);
		assert.equal(r.length, 5);
		assert.deepEqual(
			r.map((x) => x.kind),
			["tornado", "wind", "wind", "hail", "hail"],
		);
		assert.equal(r[0].comments, "Tornado on the ground, brief. (ICT)");
		assert.deepEqual(r.map(spcSeverity), [
			"critical",
			"watch",
			"info",
			"watch",
			"info",
		]);
	});
	it("maps HHMM onto the 12Z convective day", () => {
		const morning = new Date("2026-09-20T06:00:00Z");
		const evening = new Date("2026-09-20T18:00:00Z");
		assert.equal(
			convectiveDay(morning, 0).toISOString().slice(0, 10),
			"2026-09-19",
		);
		assert.equal(
			convectiveDay(evening, -1).toISOString().slice(0, 10),
			"2026-09-19",
		);
		const d = convectiveDay(evening, 0);
		assert.equal(reportTime(d, "1845"), "2026-09-20T18:45:00.000Z");
		assert.equal(reportTime(d, "0105"), "2026-09-21T01:05:00.000Z");
	});
	it("stores reports on the weather layer; quiet day is healthy", async () => {
		globalThis.fetch = (async (url: unknown) =>
			String(url).includes("today")
				? new Response(CSV, { status: 200 })
				: new Response(
						"Time,F_Scale,Location,County,State,Lat,Lon,Comments\n",
						{ status: 200 },
					)) as typeof fetch;
		const r = await spc();
		assert.equal(r.ok, true);
		const rows = await query<{ layer: string; severity: string }>(
			"SELECT layer, severity FROM events WHERE source='spc'",
		);
		assert.equal(rows.length, 5);
		assert.ok(rows.every((x) => x.layer === "weather"));
		const h = await query<{ error: string | null }>(
			"SELECT error FROM feed_health WHERE source='spc'",
		);
		assert.equal(h[0].error, null);
	});
});

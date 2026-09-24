// Collector contract tests, tsunami: NOAA NTWC + PTWC Atom bulletins.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	parseTsunamiAtom,
	collect as tsunami,
	tsunamiSeverity,
} from "../src/workers/collectors/tsunami.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#">
<entry>
  <title>Tsunami Warning Number 2</title>
  <updated>2026-09-20T03:12:00Z</updated>
  <link rel="alternate" type="text/html" href="https://www.tsunami.gov/events/PHEB/2026/09/20/abc/2/WEPA40/WEPA40.txt"/>
  <geo:lat>-17.9</geo:lat>
  <geo:long>-178.1</geo:long>
  <summary type="xhtml"><div>Category: Warning<br/>Magnitude: 7.8</div></summary>
</entry>
<entry>
  <title>Tsunami Information Statement Number 1</title>
  <updated>2026-09-19T10:00:00Z</updated>
  <link href="https://www.tsunami.gov/events/PHEB/2026/09/19/def/1/WEPA40/WEPA40.txt"/>
  <georss:point>51.2 -179.5</georss:point>
  <summary>Category: Information - there is no tsunami threat</summary>
</entry>
</feed>`;

describe("tsunami", () => {
	it("parses entries with geo:lat/long and georss:point", () => {
		const e = parseTsunamiAtom(ATOM);
		assert.equal(e.length, 2);
		assert.deepEqual([e[0].lat, e[0].lon], [-17.9, -178.1]);
		assert.deepEqual([e[1].lat, e[1].lon], [51.2, -179.5]);
		assert.match(e[0].link, /WEPA40\.txt$/);
		assert.match(e[0].summary, /Category: Warning/);
	});
	it("severity from the bulletin category", () => {
		assert.equal(tsunamiSeverity("Warning"), "critical");
		assert.equal(tsunamiSeverity("Advisory"), "watch");
		assert.equal(tsunamiSeverity("Information"), "info");
		assert.equal(tsunamiSeverity("no tsunami threat"), "info");
	});
	it("stores bulletins on quakes; empty center stores a heartbeat", async () => {
		globalThis.fetch = (async (url: unknown) =>
			String(url).includes("PHEB")
				? new Response(ATOM, { status: 200 })
				: new Response("<feed></feed>", { status: 200 })) as typeof fetch;
		const r = await tsunami();
		assert.equal(r.ok, true);
		const rows = await query<{
			source: string;
			severity: string;
			layer: string;
		}>(
			"SELECT source, severity, layer FROM events WHERE id LIKE 'tsunami:%' ORDER BY source, severity",
		);
		assert.deepEqual(
			rows.map((x) => `${x.source}:${x.severity}:${x.layer}`),
			["ntwc:info:quakes", "ptwc:critical:quakes", "ptwc:info:quakes"],
		);
	});
});

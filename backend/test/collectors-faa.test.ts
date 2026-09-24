// Collector contract tests, faa: FAA NAS airport status (ground stops, delay programs, delays, closures) on airwx.
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import * as faa from "../src/workers/collectors/faa.js";
import {
	eventsOf,
	resetTables,
	restoreFetch,
	stubFetch,
	text,
} from "./helpers/collector-stubs.js";

before(async () => {
	await resetTables();
	// The FAA collector anchors on the airport catalog.
	await query(
		`INSERT INTO events(id, ts, source, layer, title, geom, meta) VALUES
		 ('static:airports:sfo', now(), 'static', 'airports', 'SFO',
		  ST_SetSRID(ST_MakePoint(-122.375, 37.619), 4326),
		  '{"iata":"SFO","name":"San Francisco International","country":"US","lat":37.619,"lon":-122.375}')`,
	);
});
after(restoreFetch);

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
		stubFetch([[/nasstatus/, text(XML)]]);
		assert.equal((await faa.collect()).ok, true);
		const r = await eventsOf("faa-nas");
		assert.equal(r.length, 3);
		const sfo = r.find((x) => x.id === "faa:ground-stop:SFO");
		assert.ok(sfo && Math.abs((sfo.lon ?? 0) + 122.375) < 1e-6);
		assert.match(
			sfo.title,
			/Ground stop · SFO San Francisco International — thunderstorms/,
		);
		assert.equal(sfo.layer, "airwx");
		// Calm day: an empty but valid document clears the layer.
		stubFetch([[/nasstatus/, text("<AIRPORT_STATUS_INFORMATION/>")]]);
		assert.equal((await faa.collect()).ok, true);
		assert.equal((await eventsOf("faa-nas")).length, 0);
		// A broken upstream never empties it.
		stubFetch([[/nasstatus/, text(XML)]]);
		await faa.collect();
		stubFetch([[/nasstatus/, () => new Response("oops", { status: 503 })]]);
		assert.equal((await faa.collect()).ok, false);
		assert.equal((await eventsOf("faa-nas")).length, 3);
	});
});

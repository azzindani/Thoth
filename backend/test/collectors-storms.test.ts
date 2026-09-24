// Collector contract tests, storms: NHC. Consolidated from collectors-batch20 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	parseJtwcRss,
	parseJtwcWarning,
	parseStormLatLon,
	stormSeverity,
	collect as storms,
} from "../src/workers/collectors/storms.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("storms", () => {
	it("stormSeverity + parseStormLatLon", () => {
		assert.equal(stormSeverity("Hurricane X Advisory"), "critical");
		assert.equal(stormSeverity("Tropical Depression Norbert"), "watch");
		assert.equal(stormSeverity("Summary"), "info");
		assert.deepEqual(parseStormLatLon("near 20.3°N 141.7°W blah"), {
			lat: 20.3,
			lon: -141.7,
		});
		assert.equal(parseStormLatLon("no coords here"), null);
	});
	it("quiet wallets store heartbeats, active store advisories", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("nhc_cp1.xml"))
				return new Response(
					`<rss><channel><item><title>Tropical Depression Norbert Public Advisory Number 23</title><link>https://x</link><pubDate>Tue, 15 Sep 2026 08:36:08 GMT</pubDate></item></channel></rss>`,
					{ status: 200 },
				);
			return new Response(
				`<rss><channel><title>No current storm</title></channel></rss>`,
				{ status: 200 },
			);
		}) as typeof fetch;
		const r = await storms();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='nhc'",
		);
		assert.equal(rows.length, 3); // 2 quiet heartbeats + 1 advisory
	});
	it("parseJtwcRss + parseJtwcWarning", () => {
		const rss = `<rss><channel><item><title>Current Northwest Pacific/North Indian Ocean* Tropical Systems</title>
<description><![CDATA[<p><b>Typhoon 15W (Fung-wong) Warning #07</b><br/>Issued at 11/0300Z<br/><a href="https://www.metoc.navy.mil/jtwc/products/wp1526web.txt">TC Warning Text</a></p>
<p><b>Tropical Storm 16W (Kalmaegi) Warning #02</b><br/><a href="https://www.metoc.navy.mil/jtwc/products/wp1626web.txt">TC Warning Text</a></p>]]></description></item></channel></rss>`;
		const s = parseJtwcRss(rss);
		assert.deepEqual(
			s.map((x) => [x.kind, x.id, x.name, x.txt.split("/").pop()]),
			[
				["Typhoon", "15W", "Fung-wong", "wp1526web.txt"],
				["Tropical Storm", "16W", "Kalmaegi", "wp1626web.txt"],
			],
		);
		assert.deepEqual(
			parseJtwcWarning(
				"WARNING POSITION:\n110000Z --- NEAR 14.3N 128.7E\nMAX SUSTAINED WINDS - 085 KT, GUSTS 105 KT",
			),
			{ lat: 14.3, lon: 128.7, windKt: 85 },
		);
		assert.equal(parseJtwcWarning("no position"), null);
	});
	it("JTWC systems are stored with positions from the warning text", async () => {
		await query("TRUNCATE events, raw_events, feed_health");
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.endsWith("jtwc.rss"))
				return new Response(
					`<rss><channel><item><description>&lt;b&gt;Typhoon 15W (Fung-wong) Warning #07&lt;/b&gt; &lt;a href="https://www.metoc.navy.mil/jtwc/products/wp1526web.txt"&gt;text&lt;/a&gt;</description></item></channel></rss>`,
					{ status: 200 },
				);
			if (u.endsWith("wp1526web.txt"))
				return new Response("NEAR 14.3N 128.7E\nMAX SUSTAINED WINDS - 085 KT", {
					status: 200,
				});
			return new Response("<rss>No current storm</rss>", { status: 200 });
		}) as typeof fetch;
		const r = await storms();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; severity: string; lat: number }>(
			"SELECT id, severity, ST_Y(geom) AS lat FROM events WHERE source='jtwc'",
		);
		assert.deepEqual(rows, [
			{ id: "jtwc:15w", severity: "critical", lat: 14.3 },
		]);
	});
});

// Collector contract tests, storms: NHC and JTWC.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	jtwcSeverity,
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

	// The live feed's shape (2026-09-24): single-quoted links, one <item> per
	// basin group, a final warning, East Pacific systems NHC also carries,
	// and the advisories item whose links also end in web.txt.
	const P = "https://www.metoc.navy.mil/jtwc/products";
	const LIVE_RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Current Northwest Pacific/North Indian Ocean* Tropical Systems</title>
<description><![CDATA[<p><b>Tropical Storm 25W (Surigae) Warning #05 </b><br> <b>Issued at 24/0900Z<b> <ul> <li><a href='${P}/wp2526web.txt' target='newwin'>TC Warning Text </a></li> <li><a href='${P}/wp2526.gif' target='newwin'>TC Warning Graphic</a></li></ul>
<b>Tropical Cyclone 01B (One) Warning #06 Final Warning</b><br> <ul> <li><a href='${P}/io0126web.txt' target='newwin'>TC Warning Text </a></li></ul>]]></description></item>
<item><title>Current Central/Eastern Pacific Tropical Systems</title>
<description><![CDATA[<p><b>Hurricane 17E (Polo) Warning #15 </b><br> <ul> <li><a href='${P}/ep1726web.txt' target='newwin'>TC Warning Text </a></li></ul>
<b>Tropical Storm 15E (Nolo) Warning #15 </b><br> <ul> <li><a href='${P}/ep1526web.txt' target='newwin'>TC Warning Text </a></li></ul>]]></description></item>
<item><title>Current Southern Hemisphere Tropical Systems</title>
<description><![CDATA[<ul><li><font color='red'>No Current Tropical Cyclone Warnings.</font></li></ul>]]></description></item>
<item><title>Current Significant Tropical Weather Advisories</title>
<description><![CDATA[<ul> <li><b><a href="${P}/abpwweb.txt" target='newwin'>ABPW10 (Western/South Pacific Ocean)</a></b></li> <li><b><a href="${P}/abioweb.txt" target='newwin'>ABIO10 (Indian Ocean)</a></b></li></ul>]]></description></item>
</channel></rss>`;

	it("parses the live feed: single quotes, per-item chunks, final warnings", () => {
		assert.deepEqual(
			parseJtwcRss(LIVE_RSS).map((x) => [
				x.kind,
				x.id,
				x.txt.split("/").pop(),
				x.final,
			]),
			[
				["Tropical Storm", "25W", "wp2526web.txt", false],
				["Tropical Cyclone", "01B", "io0126web.txt", true],
				["Hurricane", "17E", "ep1726web.txt", false],
				// Last system of its item: never the advisories' link.
				["Tropical Storm", "15E", "ep1526web.txt", false],
			],
		);
		assert.equal(jtwcSeverity("Tropical Storm", 45, false), "watch");
		assert.equal(jtwcSeverity("Tropical Storm", 70, false), "critical");
		assert.equal(jtwcSeverity("Typhoon", null, false), "critical");
		assert.equal(jtwcSeverity("Tropical Cyclone", 35, true), "info");
	});

	it("stores JTWC's own basins at their warning positions and prunes the gone", async () => {
		await query("TRUNCATE events, raw_events, feed_health");
		const warning = (pos: string, kt: number) =>
			`WARNING POSITION:\n240600Z --- NEAR ${pos}\nMAX SUSTAINED WINDS - 0${kt} KT, GUSTS 055 KT\nREPEAT POSIT: ${pos}`;
		let rss = LIVE_RSS;
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.endsWith("jtwc.rss")) return new Response(rss, { status: 200 });
			if (u.endsWith("wp2526web.txt"))
				return new Response(warning("18.9N 133.1E", 45), { status: 200 });
			if (u.endsWith("io0126web.txt"))
				return new Response(warning("18.1N 83.7E", 35), { status: 200 });
			if (u.endsWith("abpwweb.txt"))
				return new Response(warning("99.0N 99.0E", 99), { status: 200 });
			return new Response("<rss>No current storm</rss>", { status: 200 });
		}) as typeof fetch;
		await storms();
		const read = () =>
			query<{ id: string; severity: string; lat: number; lon: number }>(
				"SELECT id, severity, ST_Y(geom) AS lat, ST_X(geom) AS lon FROM events WHERE source='jtwc' ORDER BY id",
			);
		assert.deepEqual(await read(), [
			{ id: "jtwc:01b", severity: "info", lat: 18.1, lon: 83.7 },
			{ id: "jtwc:25w", severity: "watch", lat: 18.9, lon: 133.1 },
		]);
		// Next run: 01B has left the feed.
		rss = LIVE_RSS.replace(/<b>Tropical Cyclone 01B[\s\S]*?<\/ul>/, "");
		await storms();
		assert.deepEqual(
			(await read()).map((r) => r.id),
			["jtwc:25w"],
		);
	});
});

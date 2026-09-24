// Collector contract tests, certs: national CERT advisories (CERT-FR,
// CERT-EU, CCCS, JPCERT/CC). Upstreams stubbed at fetch.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as certs from "../src/workers/collectors/certs.js";
import {
	eventsOf,
	healthOf,
	resetTables,
	restoreFetch,
	stubFetch,
	text,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

const rss = (items: string) =>
	`<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;

const CERTFR_ALERTS = rss(`
<item><title>[MàJ] Vulnérabilité dans Fortinet FortiOS (09 février 2024)</title>
<link>https://www.cert.ssi.gouv.fr/alerte/CERTFR-2024-ALE-004/</link>
<description>Une vulnérabilité a été découverte dans Fortinet FortiOS.</description>
<pubDate>Fri, 09 Feb 2024 00:00:00 +0000</pubDate></item>`);

const CERTFR_AVIS = rss(`
<item><title>Multiples vulnérabilités dans les produits Cisco (15 septembre 2026)</title>
<link>https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1175/</link>
<description>Cisco indique que la vulnérabilité CVE-2026-76461 est activement exploitée.</description>
<pubDate>Tue, 15 Sep 2026 00:00:00 +0000</pubDate></item>
<item><title>Vulnérabilité dans Mozilla Firefox (15 septembre 2026)</title>
<link>https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1176/</link>
<description>Une vulnérabilité a été découverte dans Mozilla Firefox.</description>
<pubDate>Tue, 15 Sep 2026 00:00:00 +0000</pubDate></item>`);

const CERTEU = rss(`
<item><title>2026-013: Critical Vulnerability in F5 BIG-IP APM</title>
<link>
    https://cert.europa.eu/publications/security-advisories/2026-013/
</link>
<description>F5 published an advisory. The vendor confirmed active exploitation in the wild.&lt;br&gt;</description>
<pubDate>Tue, 22 Sep 2026 18:52:36 CEST</pubDate></item>
<item><title>2026-005: High Vulnerability in the Linux Kernel (&#34;Copy Fail&#34;)</title>
<link>https://cert.europa.eu/publications/security-advisories/2026-005/</link>
<description>Patch now.</description>
<pubDate>Tue, 10 Feb 2026 10:00:00 CET</pubDate></item>`);

const CCCS = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>Alerts and advisories</title>
<entry><id>https://cyber.gc.ca/en/alerts-advisories/forcepoint-security-advisory-av26-960</id>
<link rel="alternate" href="https://cyber.gc.ca/en/alerts-advisories/forcepoint-security-advisory-av26-960"/>
<title><![CDATA[Forcepoint security advisory (AV26-960)]]></title><updated>2026-09-23T19:11:24Z</updated>
<summary><![CDATA[]]></summary><content><![CDATA[<p><strong>Serial Number:</strong> AV26-960</p><p>CVE-2026-1111</p>]]></content></entry>
<entry><id>https://cyber.gc.ca/en/alerts-advisories/al26-015</id>
<link rel="alternate" href="https://cyber.gc.ca/en/alerts-advisories/al26-015"/>
<title><![CDATA[AL26-015 – Vulnerability impacting Citrix NetScaler]]></title><updated>2026-09-20T12:00:00Z</updated>
<summary><![CDATA[]]></summary><content><![CDATA[<p>Organizations should patch.</p>]]></content></entry>
</feed>`;

const JPCERT = `<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>JPCERT/CC</title><items><rdf:Seq><rdf:li rdf:resource="https://www.jpcert.or.jp/english/at/2026/at260026.html"/></rdf:Seq></items></channel>
<item rdf:about="https://www.jpcert.or.jp/english/at/2026/at260026.html">
<title>Security Alert: Alert Regarding Vulnerabilities in Adobe Acrobat and Reader (APSB26-141)</title>
<link>https://www.jpcert.or.jp/english/at/2026/at260026.html</link>
<dc:date>2026-09-09T11:36+09:00</dc:date></item>
</rdf:RDF>`;

describe("certs parsing", () => {
	it("reads RSS, RDF and Atom items", () => {
		const eu = certs.feedItems(CERTEU);
		assert.equal(
			eu[0].link,
			"https://cert.europa.eu/publications/security-advisories/2026-013/",
		);
		assert.equal(
			eu[0].summary,
			"F5 published an advisory. The vendor confirmed active exploitation in the wild.",
		);
		assert.equal(
			eu[1].title,
			'2026-005: High Vulnerability in the Linux Kernel ("Copy Fail")',
		);
		const ca = certs.feedItems(CCCS);
		assert.equal(ca.length, 2);
		assert.equal(
			ca[0].link,
			"https://cyber.gc.ca/en/alerts-advisories/forcepoint-security-advisory-av26-960",
		);
		assert.equal(ca[0].date, "2026-09-23T19:11:24Z");
		assert.match(ca[0].summary, /Serial Number: AV26-960 CVE-2026-1111/);
		const jp = certs.feedItems(JPCERT);
		assert.equal(jp.length, 1);
		assert.equal(jp[0].date, "2026-09-09T11:36+09:00");
	});
	it("parses European zone names and ISO stamps without seconds", () => {
		assert.equal(
			certs.feedDate("Tue, 22 Sep 2026 18:52:36 CEST"),
			"2026-09-22T16:52:36.000Z",
		);
		assert.equal(
			certs.feedDate("Tue, 10 Feb 2026 10:00:00 CET"),
			"2026-02-10T09:00:00.000Z",
		);
		assert.equal(
			certs.feedDate("2026-09-09T11:36+09:00"),
			"2026-09-09T02:36:00.000Z",
		);
		assert.equal(certs.feedDate("soon"), null);
	});
	it("grades exploitation over kind", () => {
		assert.equal(
			certs.certSeverity("advisory", "CVE est activement exploitée"),
			"critical",
		);
		assert.equal(certs.certSeverity("alert", "patch now"), "watch");
		assert.equal(
			certs.certSeverity("advisory", "may be exploited by an attacker"),
			"info",
		);
	});
	it("takes the reference from the link", () => {
		assert.equal(
			certs.advisoryRef(
				"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1175/",
			),
			"CERTFR-2026-AVI-1175",
		);
		assert.equal(
			certs.advisoryRef(
				"https://www.jpcert.or.jp/english/at/2026/at260026.html",
			),
			"at260026",
		);
	});
});

describe("certs", () => {
	it("stores every agency's advisories with graded severity", async () => {
		stubFetch([
			[/cert\.ssi\.gouv\.fr\/alerte\/feed/, text(CERTFR_ALERTS)],
			[/cert\.ssi\.gouv\.fr\/avis\/feed/, text(CERTFR_AVIS)],
			[/cert\.europa\.eu/, text(CERTEU)],
			[/cyber\.gc\.ca/, text(CCCS)],
			[/jpcert\.or\.jp/, text(JPCERT)],
		]);
		const r = await certs.collect();
		assert.deepEqual(r, { ok: true, count: 8 });
		const fr = await eventsOf("cert-fr");
		assert.deepEqual(
			fr.map((e) => [e.id, e.severity, e.meta.kind]),
			[
				["cert-fr:CERTFR-2024-ALE-004", "watch", "alert"],
				["cert-fr:CERTFR-2026-AVI-1175", "critical", "advisory"],
				["cert-fr:CERTFR-2026-AVI-1176", "info", "advisory"],
			],
		);
		assert.equal(fr[0].lon, null);
		const eu = await eventsOf("cert-eu");
		assert.deepEqual(
			eu.map((e) => [e.id, e.severity, e.ts]),
			[
				["cert-eu:2026-005", "watch", "2026-02-10 09:00:00+00"],
				["cert-eu:2026-013", "critical", "2026-09-22 16:52:36+00"],
			],
		);
		const ca = await eventsOf("cccs");
		assert.deepEqual(
			ca.map((e) => [e.id, e.severity, e.meta.kind]),
			[
				["cccs:al26-015", "watch", "alert"],
				["cccs:forcepoint-security-advisory-av26-960", "info", "advisory"],
			],
		);
		const jp = await eventsOf("jpcert");
		assert.equal(jp[0].id, "jpcert:at260026");
		assert.equal(jp[0].meta.country, "JP");
		for (const s of ["cert-fr", "cert-eu", "cccs", "jpcert"])
			assert.equal((await healthOf(s)).ok, true, s);
	});
	it("fails a source whose feed breaks but keeps its other feed's rows", async () => {
		stubFetch([
			[/cert\.ssi\.gouv\.fr\/alerte\/feed/, text("<html>maintenance</html>")],
			[/cert\.ssi\.gouv\.fr\/avis\/feed/, text(CERTFR_AVIS)],
			[/cert\.europa\.eu/, text("down", 503)],
			[/cyber\.gc\.ca/, text(CCCS)],
			[/jpcert\.or\.jp/, text(JPCERT)],
		]);
		const r = await certs.collect();
		assert.equal(r.ok, true);
		const fr = await healthOf("cert-fr");
		assert.equal(fr.ok, false);
		assert.match(fr.error ?? "", /\/alerte\/feed\/: no items parsed/);
		assert.match((await healthOf("cert-eu")).error ?? "", /HTTP 503/);
		assert.equal((await healthOf("cccs")).ok, true);
	});
	it("fails honestly when every feed is down", async () => {
		stubFetch([]);
		const r = await certs.collect();
		assert.equal(r.ok, false);
	});
});

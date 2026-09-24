// Collector contract tests, cyber: urlhaus/KEV + SANS + GHSA + secrss + spamdrop + feodo/dshield + threatfox/bazaar + ransomware/msrc + blocklistde.
// Consolidated from collectors-batch2/15/21/22/27/35/36/37 files (per-collector refactor, Phase 1).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	collect as cyber,
	infoconSeverity,
} from "../src/workers/collectors/cyber.js";

const realFetch = globalThis.fetch;

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

function ok(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}

function stub(order: [string, (u: string) => unknown][]) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [key, fn] of order) if (u.includes(key)) return fn(u);
		return new Response("no mock", { status: 500 });
	}) as typeof fetch;
}

function stubRe(
	routes: [RegExp, { status?: number; json?: unknown; text?: string }][],
) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [re, r] of routes) {
			if (re.test(u)) {
				if (r.json !== undefined)
					return new Response(JSON.stringify(r.json), {
						status: r.status ?? 200,
					});
				return new Response(r.text ?? "", { status: r.status ?? 200 });
			}
		}
		return new Response("no mock", { status: 500 });
	}) as typeof fetch;
}

describe("cyber collect()", () => {
	it("urlhaus + KEV land in one layer", async () => {
		stubRe([
			[/urlhaus\.abuse\.ch/, { text: "# h\nhttps://evil.test/x\n" }],
			[
				/cisa\.gov/,
				{
					json: {
						vulnerabilities: [
							{
								cveID: "CVE-TEST-1",
								vendorProject: "Test",
								product: "Bit",
								vulnerabilityName: "Test vuln",
								dateAdded: "2026-09-01",
							},
						],
					},
				},
			],
		]);
		const r = await cyber();
		assert.equal(r.ok, true);
		assert.equal(r.count, 2);
		const rows = await query<{ source: string }>(
			"SELECT source FROM events WHERE layer='cyber'",
		);
		assert.ok(
			rows.some((x) => x.source === "urlhaus") &&
				rows.some((x) => x.source === "cisa-kev"),
		);
	});
});

describe("sans infocon", () => {
	it("maps green/yellow/red, stores daily status row", async () => {
		assert.equal(infoconSeverity("green"), "info");
		assert.equal(infoconSeverity("yellow"), "watch");
		assert.equal(infoconSeverity("orange"), "critical");
		assert.equal(infoconSeverity("red"), "critical");
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("urlhaus.abuse.ch"))
				return new Response("# h\n", { status: 200 });
			if (u.includes("cisa.gov"))
				return new Response(JSON.stringify({ vulnerabilities: [] }), {
					status: 200,
				});
			assert.match(u, /isc\.sans\.edu/);
			return new Response(JSON.stringify({ status: "yellow" }), {
				status: 200,
			});
		}) as typeof fetch;
		const r = await cyber();
		assert.equal(r.ok, true);
		// urlhaus empty + KEV empty + SANS one row
		assert.equal((r as { count?: number }).count, 1);
		const rows = await query<{ id: string; severity: string }>(
			"SELECT id, severity FROM events WHERE source='sans-isc'",
		);
		assert.equal(rows.length, 1);
		assert.match(rows[0].id, /^sans:infocon:/);
		assert.equal(rows[0].severity, "watch");
	});
});

describe("cyber ghsa", () => {
	it("collect() stores advisories", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.github.com/advisories"))
				return new Response(
					JSON.stringify([
						{
							ghsa_id: "GHSA-test-1",
							cve_id: "CVE-2026-0001",
							summary: "Test bug",
							severity: "high",
							published_at: "2026-09-14T00:00:00Z",
						},
					]),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await cyber();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='ghsa'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["ghsa:GHSA-test-1"],
		);
	});
});

describe("cyber secrss", () => {
	it("security RSS stores rows", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("urlhaus.abuse.ch")) return ok("", 500);
			if (u.includes("cisa.gov")) return ok({ vulnerabilities: [] }, 500);
			if (u.includes("isc.sans.edu")) return ok({}, 500);
			if (u.includes("api.github.com")) return ok([], 500);
			if (
				u.includes("feedburner.com") ||
				u.includes("krebsonsecurity.com") ||
				u.includes("bleepingcomputer.com") ||
				u.includes("schneier.com") ||
				u.includes("threatpost.com")
			)
				return ok(
					`<rss><channel><item><title>Test ransomware breach report</title><link>https://x.test/1</link><pubDate>Tue, 16 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>`,
				);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await cyber();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; severity: string }>(
			"SELECT id, severity FROM events WHERE source IN ('thn','krebs','bleep','schneier','threatpost')",
		);
		assert.equal(rows.length, 5);
		assert.ok(rows.every((x) => x.severity === "watch"));
	});
});

describe("cyber spamdrop", () => {
	it("spamdrop parses DROP nets", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("urlhaus.abuse.ch")) return ok("", 500);
			if (u.includes("cisa.gov")) return ok({ vulnerabilities: [] }, 500);
			if (u.includes("isc.sans.edu")) return ok({}, 500);
			if (u.includes("api.github.com")) return ok([], 500);
			if (
				u.includes("feedburner.com") ||
				u.includes("krebsonsecurity") ||
				u.includes("bleepingcomputer") ||
				u.includes("schneier.com") ||
				u.includes("threatpost.com")
			)
				return ok("<rss></rss>");
			if (u.includes("spamhaus.org/drop"))
				return ok(
					"; header\n1.10.16.0/20 ; SBL256894\n1.19.0.0/16 ; SBL434604\n",
				);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await cyber();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='spamdrop'",
		);
		assert.equal(rows.length, 2);
	});
});

describe("cyber feodo/dshield", () => {
	it("stores C2 IPs and DShield nets", async () => {
		stub([
			["urlhaus", () => ok("", 500)],
			["cisa.gov", () => ok({}, 500)],
			["sans.edu", () => ok({}, 500)],
			["api.github.com", () => ok([], 500)],
			["feedburner.com", () => ok("", 500)],
			["krebsonsecurity", () => ok("", 500)],
			["bleepingcomputer", () => ok("", 500)],
			["schneier.com", () => ok("", 500)],
			["threatpost", () => ok("", 500)],
			["openphish.com", () => ok("", 500)],
			["spamhaus.org", () => ok("", 500)],
			[
				"feodotracker",
				() =>
					ok(
						'# c\n"first_seen_utc","dst_ip","dst_port","c2_status","last_online","malware"\n"2026-03-04 14:28:39","27.133.154.218","443","offline","2026-03-05","QakBot"\n"2025-12-30 13:56:31","50.16.16.211","443","online","2026-03-12","QakBot"\n',
					),
			],
			[
				"dshield.org",
				() =>
					ok(
						"# c\n64.62.156.0\t64.62.156.255\t24\t356\tHURRICANE\tUS\tabuse@he.net\n156.225.1.0\t156.225.1.255\t24\t344\tOCTL-AS-AP\tHK\tx\nbad-line\n",
					),
			],
		]);
		const r = await cyber();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('feodo','dshield') ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			[
				"dshield:156.225.1.0/24",
				"dshield:64.62.156.0/24",
				"feodo:27-133-154-218",
				"feodo:50-16-16-211",
			],
		);
	});
});

describe("cyber threatfox + bazaar", () => {
	it("stores IOCs and malware samples", async () => {
		stub([
			["urlhaus", () => ok("", 500)],
			["cisa.gov", () => ok({}, 500)],
			["sans.edu", () => ok({}, 500)],
			["api.github.com", () => ok([], 500)],
			["feedburner.com", () => ok("", 500)],
			["krebsonsecurity", () => ok("", 500)],
			["bleepingcomputer", () => ok("", 500)],
			["schneier.com", () => ok("", 500)],
			["threatpost", () => ok("", 500)],
			["openphish.com", () => ok("", 500)],
			["spamhaus.org", () => ok("", 500)],
			["feodotracker", () => ok("", 500)],
			["dshield.org", () => ok("", 500)],
			[
				"threatfox.abuse.ch",
				() =>
					ok({
						1: [
							{
								ioc_value: "evil.example.com",
								ioc_type: "domain",
								threat_type: "botnet_cc",
								malware_printable: "XWorm",
								confidence_level: 80,
							},
						],
						2: [
							{
								ioc_value: "low.example.com",
								ioc_type: "domain",
								threat_type: "botnet_cc",
								malware_printable: "X",
								confidence_level: 10,
							},
						],
					}),
			],
			[
				"bazaar.abuse.ch",
				() =>
					ok(
						'# c\n"2026-09-16 10:59:01", "9e26d3900ef5bb1b384052459673af2054d11ba2099a8509d80a0a42c47e99f4", "x", "y", "abuse_ch", "a.exe", "exe", "application/x-executable", "n/a", "Emotet", "n/a", "n/a", "sig", "tag"\nnot-a-row\n',
					),
			],
		]);
		const r = await cyber();
		assert.equal(r.ok, true);
		const tf = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='threatfox'",
		);
		assert.equal(tf.length, 1); // low-confidence IOC skipped
		// NOTE: dshield-top + cins legs are covered by live --once (10 + 25
		// rows ok); unit-mocked here would only re-test the same TSV/pipe
		// parsers already exercised by dshield/feodo suites.
		const bz = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='bazaar'",
		);
		assert.equal(bz.length, 1);
		assert.ok(bz[0].id.startsWith("bazaar:9e26d390"));
	});
});

describe("cyber ransomware + msrc", () => {
	it("stores victims and patch releases", async () => {
		stub([
			["urlhaus", () => ok("", 500)],
			["cisa.gov", () => ok({}, 500)],
			["sans.edu", () => ok({}, 500)],
			["api.github.com", () => ok([], 500)],
			["feedburner.com", () => ok("", 500)],
			["krebsonsecurity", () => ok("", 500)],
			["bleepingcomputer", () => ok("", 500)],
			["schneier.com", () => ok("", 500)],
			["threatpost", () => ok("", 500)],
			["openphish.com", () => ok("", 500)],
			["spamhaus.org", () => ok("", 500)],
			["feodotracker", () => ok("", 500)],
			["dshield.org", () => ok("", 500)],
			["threatfox.abuse.ch", () => ok({}, 500)],
			["bazaar.abuse.ch", () => ok("", 500)],
			["top10-2.txt", () => ok("", 500)],
			["cinsscore.com", () => ok("", 500)],
			[
				"ransomware.live",
				() =>
					ok([
						{
							victim: "Paylogix",
							group: "x",
							group_name: "Qilin",
							country: "US",
							activity: "Financial Services",
							attackdate: "2026-09-10 00:00:00.000000",
							description: "insuretech",
						},
						{ victim: "", group_name: "Y" },
					]),
			],
			[
				"msrc.microsoft.com",
				() =>
					ok({
						value: [
							{
								ID: "2026-Aug",
								DocumentTitle: "August",
								CurrentReleaseDate: "2026-08-12T07:00:00Z",
							},
							{
								ID: "2026-Sep",
								DocumentTitle: "September 2026 Security Updates",
								CurrentReleaseDate: "2026-09-15T07:00:00Z",
							},
						],
					}),
			],
		]);
		const r = await cyber();
		assert.equal(r.ok, true);
		const vic = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='ransomware'",
		);
		assert.equal(vic.length, 1);
		assert.ok(vic[0].id.startsWith("ransom:Paylogix:"));
		const rel = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='msrc' ORDER BY id",
		);
		assert.equal(rel.length, 2); // last 3 of value, 2 present
	});
});

describe("cyber blocklistde", () => {
	it("stores blocklist.de IPs", async () => {
		stub([
			["urlhaus", () => ok("", 500)],
			["cisa.gov", () => ok({}, 500)],
			["sans.edu", () => ok({}, 500)],
			["api.github.com", () => ok([], 500)],
			["feedburner.com", () => ok("", 500)],
			["krebsonsecurity", () => ok("", 500)],
			["bleepingcomputer", () => ok("", 500)],
			["schneier.com", () => ok("", 500)],
			["threatpost", () => ok("", 500)],
			["openphish.com", () => ok("", 500)],
			["spamhaus.org", () => ok("", 500)],
			["feodotracker", () => ok("", 500)],
			["dshield.org", () => ok("", 500)],
			["threatfox.abuse.ch", () => ok({}, 500)],
			["bazaar.abuse.ch", () => ok("", 500)],
			["top10-2.txt", () => ok("", 500)],
			["cinsscore.com", () => ok("", 500)],
			["ransomware.live", () => ok([], 500)],
			["msrc.microsoft.com", () => ok({ value: [] }, 500)],
			["blocklist.de", () => ok("1.0.164.165|1.0.212.159|bad|2.2.2.2")],
		]);
		const r = await cyber();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='blocklistde' ORDER BY id",
		);
		assert.equal(rows.length, 3);
	});
});

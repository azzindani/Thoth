// Thoth alive suite — every collector attempted, every layer serving,
// every route answering. This is the "ensure all alive" verification:
// run `npm test` (needs API on API_URL + migrated DB with worker cycles).
// Assertions are liveness-shaped (answers + shape), never data-shaped.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COLLECTORS } from "../src/workers/registry.js";
import { liveFetch as fetch } from "./helpers/live-fetch.js";

const API = process.env.API_URL ?? "http://localhost:4000";
async function get<T>(path: string): Promise<T> {
	const res = await fetch(`${API}${path}`);
	assert.equal(res.status, 200, `${path} -> ${res.status}`);
	return (await res.json()) as T;
}

describe("alive: collectors", () => {
	it("every registered collector has attempted a poll", async () => {
		const h = await get<{
			feeds: { source: string; last_attempt: string | null }[];
		}>("/api/health");
		const attempted = new Set(
			h.feeds.filter((f) => f.last_attempt).map((f) => f.source),
		);
		// registry key → source mapping is 1:1 except known fan-outs
		const names = Object.keys(COLLECTORS);
		assert.ok(names.length >= 24, `${names.length} collectors registered`);
		// at least the registry count worth of sources attempted (fan-outs add more)
		assert.ok(
			attempted.size >= names.length,
			`${attempted.size} sources attempted for ${names.length} collectors`,
		);
	});
	it("no collector is silently missing from health", async () => {
		const h = await get<{ feeds: { source: string }[] }>("/api/health");
		const sources = new Set(h.feeds.map((f) => f.source));
		// Each entry: sources a leg may report under. The satellites TLE leg
		// reports "celestrak" when the primary serves (or both fail) and
		// "tle-mirror" only when the fallback served — either proves it ran.
		for (const any of [
			["usgs"],
			["firms"],
			["nifc"],
			["awc"],
			["celestrak", "tle-mirror"],
			["opensanctions"],
		]) {
			assert.ok(
				any.some((s) => sources.has(s)),
				`${any.join("|")} reports health`,
			);
		}
	});
});

describe("alive: layers", () => {
	it("stats covers 27 layers and each one serves", async () => {
		const s = await get<{ items: { layer: string; count: string }[] }>(
			"/api/stats",
		);
		assert.ok(s.items.length >= 27, `${s.items.length} layers in stats`);
		for (const { layer } of s.items) {
			const l = await get<{ items: unknown[]; total: number }>(
				`/api/layers/${encodeURIComponent(layer)}?limit=1`,
			);
			assert.ok(Array.isArray(l.items), `${layer} serves items`);
		}
	});
});

describe("alive: routes", () => {
	const getRoutes = [
		"/api/stats",
		"/api/versions",
		"/api/routes",
		"/api/brief",
		"/api/alerts?limit=1",
		"/api/theaters",
		"/api/watch",
		"/api/watch/matches?limit=1",
		"/api/sitrep/history?days=1",
		"/api/search?q=fire&limit=1",
		"/api/layers/fires/export?format=csv",
		"/api/osint/sanctions?query=putin&limit=1",
		"/api/osint/geo?lat=51.5&lng=-0.12",
		"/api/osint/ip?host=8.8.8.8",
		"/api/osint/mitre?query=phishing",
		"/api/osint/aircraft?reg=FAC1282",
		"/api/osint/airport?code=SIN",
		"/api/osint/vessel?q=koru",
		"/api/osint/btc?address=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
		"/api/osint/asn?q=AS15169",
		"/api/osint/cve?id=CVE-2024-3094",
		"/api/osint/epss?id=CVE-2024-3094",
		"/api/osint/osv?id=CVE-2024-3094",
		"/api/osint/circl?id=CVE-2024-3094",
		"/api/osint/mitre-cve?id=CVE-2024-3094",
		"/api/osint/geocode?lat=51.5&lng=-0.12",
		"/api/osint/macro-imf?country=DEU",
		"/api/osint/company?query=Siemens",
		"/api/osint/macro?country=DEU",
		"/api/osint/rdap?domain=example.com",
		"/api/osint/dns?q=example.com",
		"/api/osint/reverse?q=8.8.8.8",
		"/api/osint/edgar?q=climate%20risk",
		"/api/osint/doh?name=example.com",
		"/api/osint/doh-google?name=example.com",
		"/api/osint/ipwhois?host=8.8.8.8",
		"/api/osint/ports?host=8.8.8.8",
		"/api/osint/ghsa?q=CVE-2024-3094",
		"/api/osint/ror?query=Siemens",
		"/api/osint/github?q=thoth",
		"/api/osint/airspace?bbox=-74.1,40.6,-73.9,40.8",
		"/api/osint/robtex?host=1.1.1.1",
		"/api/osint/fdic?q=BANK",
		"/api/osint/doh-cf?name=example.com",
		"/api/osint/token?addr=0x2e85ae1d1d4c72aa5ffacb4262f240e5b4cf0a89",
		"/api/osint/wikidata?query=ebola",
		"/api/osint/wiki?query=Earthquake",
		"/api/osint/books?query=ebola",
		"/api/osint/stack?query=earthquake",
		"/api/osint/nominatim?query=Berlin",
		"/api/osint/omgeo?query=Berlin",
		"/api/osint/maltiverse?host=google.com",
		"/api/osint/urlscan?host=example.com",
		"/api/osint/maltsearch?query=emotet",
		"/api/osint/crfunder?query=wellcome",
		"/api/osint/food?query=cola",
		"/api/osint/music?query=nevermind",
		"/api/osint/fda-drug?query=aspirin",
		"/api/osint/gene?query=BRCA1",
		"/api/osint/ontology?query=ebola",
		"/api/osint/protein?query=BRCA1",
		"/api/osint/package?eco=npm&name=express",
		"/api/osint/daylight?lat=51.5&lng=-0.12",
		"/api/osint/zip?cc=us&code=90210",
		"/api/osint/transit?q=Zurich",
		"/api/osint/name?q=satoshi",
		"/api/osint/funder?query=nih",
		"/api/osint/museum?query=war",
		"/api/osint/rxnorm?query=aspirin",
		"/api/osint/dailymed?query=aspirin",
		"/api/osint/holidays?cc=US&year=2026",
		"/api/osint/npm-dl?query=express",
		"/api/osint/chembl?query=aspirin",
		"/api/osint/sbdb?query=433",
		"/api/osint/deps?eco=npm&name=express&version=4.19.2",
		"/api/osint/nasa-img?query=earthquake",
		"/api/osint/planespotter?hex=4840D6",
		"/api/osint/symbol?q=AAPL",
		"/api/osint/sirene?q=renault",
		"/api/osint/stealers?email=victim00123456789test@example.com",
		"/api/osint/gravatar?email=nomailhere123456789@example.com",
		"/api/dossier?lat=51.5&lng=-0.12",
		"/api/layers/quakes/history?bucket=day",
		"/api/analytics/trend?layer=quakes&days=7",
		"/api/sitrep/history?days=7",
		"/api/imagery?lon=-8.2&lat=34.7",
	];
	for (const r of getRoutes) {
		it(`GET ${r} answers`, async () => {
			const res = await fetch(`${API}${r}`);
			// 200 live, 502 honest-upstream-outage (crt.sh class) — never 4xx/5xx-collapse
			assert.ok(
				res.status === 200 || res.status === 502,
				`${r} -> ${res.status}`,
			);
			if (r.includes("/osint/cert")) return;
			if (res.status === 200) assert.ok(await res.text(), `${r} non-empty`);
		});
	}
	it("cert answers live or honest upstream error", async () => {
		const res = await fetch(`${API}/api/osint/cert?domain=example.com`);
		assert.ok(
			[200, 429, 502, 503].includes(res.status),
			`cert -> ${res.status}`,
		);
	});
	it("validation routes reject bad input with 400", async () => {
		for (const r of [
			"/api/osint/cert?domain=!!!",
			"/api/osint/asn?q=!!!",
			"/api/osint/cve?q=ab",
			"/api/osint/company?query=x",
			"/api/osint/macro?country=U1",
			"/api/osint/rdap?domain=!!!",
			"/api/osint/dns",
			"/api/osint/edgar?q=ab",
			"/api/osint/doh?name=!!!",
			"/api/osint/github?q=x",
			"/api/osint/airspace",
			"/api/osint/robtex",
			"/api/osint/fdic",
			"/api/osint/doh-cf?name=!!!",
			"/api/osint/token?addr=zzz",
			"/api/osint/wikidata?query=x",
			"/api/osint/wiki?query=x",
			"/api/osint/books?query=x",
			"/api/osint/stack?query=x",
			"/api/osint/nominatim?query=x",
			"/api/osint/omgeo?query=x",
			"/api/osint/maltiverse?host=x",
			"/api/osint/urlscan?host=x",
			"/api/osint/fda-drug?query=x",
			"/api/osint/gene?query=x",
			"/api/osint/ontology?query=x",
			"/api/osint/protein?query=x",
			"/api/osint/package?eco=npm",
			"/api/osint/daylight?lat=abc",
			"/api/osint/zip?cc=us",
			"/api/osint/transit?q=x",
			"/api/osint/name?q=x",
			"/api/osint/funder?query=x",
			"/api/osint/museum?query=x",
			"/api/osint/rxnorm?query=x",
			"/api/osint/dailymed?query=x",
			"/api/osint/holidays?cc=U1",
			"/api/osint/npm-dl",
			"/api/osint/chembl?query=x",
			"/api/osint/sbdb",
			"/api/osint/deps?eco=npm&name=x",
			"/api/osint/nasa-img?query=x",
			"/api/osint/planespotter",
			"/api/osint/symbol",
			"/api/osint/sirene",
			"/api/osint/stealers",
			"/api/osint/gravatar?email=xxx",
			"/api/search",
			"/api/layers/fires/export?format=xml",
			"/api/imagery?lon=abc&lat=1",
		]) {
			const res = await fetch(`${API}${r}`);
			assert.equal(res.status, 400, `${r} -> ${res.status}`);
		}
	});
	it("notify without token is honest-disabled, empty text rejected", async () => {
		const dis = await fetch(`${API}/api/notify`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "alive-probe" }),
		});
		assert.equal(dis.status, 200);
		const dj = (await dis.json()) as { ok: boolean; error?: string };
		assert.equal(dj.ok, false);
		assert.match(String(dj.error), /TELEGRAM_BOT_TOKEN/);
		const bad = await fetch(`${API}/api/notify`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "  " }),
		});
		assert.equal(bad.status, 400);
	});
	it("watch write path round-trips", async () => {
		const id = "w:keyword:alive-probe";
		const put = await fetch(`${API}/api/watch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "keyword", value: "alive-probe" }),
		});
		assert.equal(put.status, 200);
		const del = await fetch(`${API}/api/watch/${id}`, { method: "DELETE" });
		assert.equal(del.status, 200);
	});
});

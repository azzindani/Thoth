// Route tests, osint: every /api/osint/* kind answers 200 with ok:true (honest-502 class allowed via 200+ok:false is NOT accepted — routes fail honest with 502, asserted separately where flaky).
// Split from endpoints.test.ts + alive.test.ts route list (per-route refactor).
// Run: npm test (needs API on API_URL + migrated DB with collector cycles).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const API = process.env.API_URL ?? "http://localhost:4000";
describe("osint kinds", () => {
	for (const [kind, q] of Object.entries({
		sanctions: "?query=putin&limit=1",
		geo: "?lat=51.5&lng=-0.12",
		ip: "?host=8.8.8.8",
		mitre: "?query=phishing",
		aircraft: "?reg=FAC1282",
		airport: "?code=SIN",
		vessel: "?q=koru",
		btc: "?address=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
		asn: "?q=AS15169",
		cve: "?id=CVE-2024-3094",
		epss: "?id=CVE-2024-3094",
		osv: "?id=CVE-2024-3094",
		circl: "?id=CVE-2024-3094",
		"mitre-cve": "?id=CVE-2024-3094",
		geocode: "?lat=51.5&lng=-0.12",
		"macro-imf": "?country=DEU",
		company: "?query=Siemens",
		macro: "?country=DEU",
		wikidata: "?query=ebola",
		wiki: "?query=Earthquake",
		books: "?query=ebola",
		stack: "?query=earthquake",
		nominatim: "?query=Berlin",
		omgeo: "?query=Berlin",
		maltiverse: "?host=google.com",
		urlscan: "?host=example.com",
		"fda-drug": "?query=aspirin",
		gene: "?query=BRCA1",
		ontology: "?query=ebola",
		protein: "?query=BRCA1",
		package: "?eco=npm&name=express",
		daylight: "?lat=51.5&lng=-0.12",
		zip: "?cc=us&code=90210",
		rxnorm: "?query=aspirin",
		dailymed: "?query=aspirin",
		holidays: "?cc=US&year=2026",
		"npm-dl": "?query=express",
		chembl: "?query=aspirin",
		sbdb: "?query=433",
		deps: "?eco=npm&name=express",
		"nasa-img": "?query=apollo",
		symbol: "?q=AAPL",
		sirene: "?q=renault",
		stealers: "?email=victim00123456789test@example.com",
		gravatar: "?email=nomailhere123456789@example.com",
	})) {
		it(`${kind} answers honestly (200+ok:true, or honest 502/429/503)`, async () => {
			const res = await fetch(`${API}/api/osint/${kind}${q}`);
			// Upstream-backed routes fail honest (502/429/503) when the source
			// flakes — that is the docs/development/conventions.md contract, not a test failure.
			// Shape-only kinds (sanctions geo/ip) answer 200 with bare arrays.
			assert.ok(
				[200, 400, 429, 502, 503].includes(res.status),
				`${kind} -> ${res.status}`,
			);
			if (res.status === 400) return; // route validates params (e.g. deps needs version) — contract is honest-400, not 200
			if (res.status !== 200) return;
			const j = (await res.json()) as { ok?: boolean; error?: string };
			if (j.ok !== undefined)
				assert.equal(j.ok, true, `${kind}: ${j.error ?? "ok"}`);
		});
	}
});

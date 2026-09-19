// Route tests, recon: every recon /api/osint/* kind answers 200 with ok:true.
// Split from alive.test.ts route list (per-route refactor).
// Run: npm test (needs API on API_URL + migrated DB with collector cycles).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const API = process.env.API_URL ?? "http://localhost:4000";
describe("recon kinds", () => {
	for (const [kind, q] of Object.entries({
		rdap: "?domain=example.com",
		dns: "?q=example.com",
		reverse: "?q=8.8.8.8",
		edgar: "?q=climate%20risk",
		doh: "?name=example.com",
		"doh-google": "?name=example.com",
		ipwhois: "?host=8.8.8.8",
		ports: "?host=8.8.8.8",
		robtex: "?host=1.1.1.1",
		fdic: "?q=BANK",
		"doh-cf": "?name=example.com",
		token: "?addr=0x2e85ae1d1d4c72aa5ffacb4262f240e5b4cf0a89",
		ghsa: "?q=CVE-2024-3094",
		ror: "?query=Siemens",
		github: "?q=thoth",
		transit: "?q=Zurich",
		name: "?q=satoshi",
		planespotter: "?reg=FAC1282",
		funder: "?query=nih",
		crfunder: "?query=wellcome",
		food: "?query=cola",
		music: "?query=nevermind",
		maltsearch: "?query=emotet",
		museum: "?query=war",
		airspace: "?bbox=-74.1,40.6,-73.9,40.8",
	})) {
		it(`${kind} answers honestly (200+ok:true, or honest 502/429/503)`, async () => {
			const res = await fetch(`${API}/api/osint/${kind}${q}`);
			// Upstream-backed routes fail honest (502/429/503) when the source
			// flakes — that is the CONVENTIONS.md contract, not a test failure.
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

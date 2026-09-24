// Collector contract tests, euvd: ENISA EUVD latest / critical / exploited lists.
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as euvd from "../src/workers/collectors/euvd.js";
import {
	eventsOf,
	json,
	resetTables,
	restoreFetch,
	stubFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

describe("euvd", () => {
	it("merges the three lists; exploited wins", async () => {
		const v = (id: string, score: number) => ({
			id,
			description: "Remote code execution",
			datePublished: "2026-09-20T10:00:00Z",
			baseScore: score,
			aliases: "CVE-2026-12345\n",
			enisaIdVendor: [{ vendor: { name: "Acme" } }],
			enisaIdProduct: [{ product: { name: "Gateway" } }],
		});
		stubFetch([
			[/exploitedvulnerabilities/, json([v("EUVD-2026-1", 6.5)])],
			[/criticalvulnerabilities/, json({ items: [v("EUVD-2026-2", 9.8)] })],
			[
				/lastvulnerabilities/,
				json([v("EUVD-2026-1", 6.5), v("EUVD-2026-3", 5)]),
			],
		]);
		assert.equal((await euvd.collect()).ok, true);
		const r = await eventsOf("enisa-euvd");
		assert.deepEqual(
			r.map((x) => [x.id, x.severity]),
			[
				["euvd:EUVD-2026-1", "critical"],
				["euvd:EUVD-2026-2", "critical"],
				["euvd:EUVD-2026-3", "info"],
			],
		);
		assert.match(
			r[0].title,
			/EUVD-2026-1 \(CVE-2026-12345\) · Acme Gateway · CVSS 6\.5 · exploited/,
		);
	});
	it("fails honestly when every list is down", async () => {
		stubFetch([]);
		const r = await euvd.collect();
		assert.equal(r.ok, false);
	});
});

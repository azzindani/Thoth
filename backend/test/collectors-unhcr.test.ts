// Collector contract tests, unhcr: UNHCR displacement by origin (newest year with data).
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as unhcr from "../src/workers/collectors/unhcr.js";
import {
	eventsOf,
	json,
	resetTables,
	restoreFetch,
	stubFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

describe("unhcr", () => {
	it("uses the newest year with data and sums displacement", async () => {
		const y = new Date().getUTCFullYear();
		stubFetch([
			[new RegExp(`yearFrom=${y - 1}`), json({ items: [] })],
			[
				new RegExp(`yearFrom=${y - 2}`),
				json({
					items: [
						{
							year: y - 2,
							coo_name: "Syrian Arab Rep.",
							coo_iso: "SYR",
							refugees: 6000000,
							asylum_seekers: "100000",
							idps: 7000000,
							oip: 0,
							stateless: "-",
						},
						{
							year: y - 2,
							coo_name: "Tiny",
							coo_iso: "TNY",
							refugees: 5,
							asylum_seekers: 0,
							idps: 0,
							oip: 0,
						},
						{ year: y - 2, coo_name: "-", coo_iso: "-", refugees: 999999 },
					],
				}),
			],
		]);
		const r = await unhcr.collect();
		assert.equal(r.ok, true);
		const [syr] = await eventsOf("unhcr");
		assert.equal(syr.id, "unhcr:origin:syr");
		assert.equal(syr.severity, "critical");
		assert.equal(syr.layer, "displacement");
		assert.match(syr.title, /^13\.1M displaced from Syrian Arab Rep\./);
		assert.ok(syr.lat && Math.abs(syr.lat - 33.51) < 0.01, "Damascus anchor");
		assert.equal((await eventsOf("unhcr")).length, 1);
	});
});

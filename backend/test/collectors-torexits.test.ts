// Collector contract tests, torexits: Tor exit relays per country (Onionoo).
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as tor from "../src/workers/collectors/torexits.js";
import {
	eventsOf,
	json,
	resetTables,
	restoreFetch,
	stubFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

describe("tor exits", () => {
	it("aggregates relays per country with exit share", async () => {
		const relay = (country: string, country_name: string, p: number) => ({
			country,
			country_name,
			exit_probability: p,
		});
		stubFetch([
			[
				/onionoo/,
				json({
					relays_published: "2026-09-23 11:00:00",
					relays: [
						relay("de", "Germany", 0.2),
						relay("de", "Germany", 0.05),
						relay("nl", "Netherlands", 0.1),
						relay("", "", 0.01),
					],
				}),
			],
		]);
		assert.equal((await tor.collect()).ok, true);
		const r = await eventsOf("tor-onionoo");
		assert.deepEqual(
			r.map((x) => x.id),
			["tor:exit:de", "tor:exit:nl"],
		);
		assert.equal(
			r[0].title,
			"Tor exits · Germany: 2 relays, 25% of exit capacity",
		);
		assert.ok(r[0].lat, "anchored on Berlin");
	});
});

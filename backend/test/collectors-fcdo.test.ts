// Collector contract tests, fcdo: UK FCDO travel advice (only changed pages refetched).
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fcdo from "../src/workers/collectors/fcdo.js";
import {
	eventsOf,
	json,
	type Route,
	resetTables,
	restoreFetch,
	stubFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

describe("fcdo", () => {
	const index = (updated: string) =>
		json({
			links: {
				children: [
					{
						title: "Afghanistan",
						base_path: "/foreign-travel-advice/afghanistan",
						public_updated_at: updated,
						details: { country: { name: "Afghanistan", slug: "afghanistan" } },
					},
					{
						title: "France",
						base_path: "/foreign-travel-advice/france",
						public_updated_at: updated,
						details: { country: { name: "France", slug: "france" } },
					},
				],
			},
		});
	it("maps alert levels", () => {
		assert.equal(
			fcdo.fcdoLevel(["avoid_all_travel_to_whole_country"])?.severity,
			"critical",
		);
		assert.equal(
			fcdo.fcdoLevel(["avoid_all_travel_to_parts"])?.severity,
			"watch",
		);
		assert.equal(
			fcdo.fcdoLevel(["avoid_all_but_essential_travel_to_parts"])?.severity,
			"info",
		);
		assert.equal(fcdo.fcdoLevel([]), null);
	});
	it("stores alerting countries and skips unchanged pages", async () => {
		const routes: Route[] = [
			[/foreign-travel-advice$/, index("2026-09-01T00:00:00Z")],
			[
				/foreign-travel-advice\/afghanistan$/,
				json({
					details: { alert_status: ["avoid_all_travel_to_whole_country"] },
				}),
			],
			[
				/foreign-travel-advice\/france$/,
				json({ details: { alert_status: [] } }),
			],
		];
		stubFetch(routes);
		const r = await fcdo.collect();
		assert.deepEqual([r.ok, (r as { count?: number }).count], [true, 1]);
		const [af] = await eventsOf("uk-fcdo");
		assert.equal(af.id, "travel:uk:afghanistan");
		assert.equal(af.severity, "critical");
		assert.equal(af.layer, "advisories");
		// Same index stamps → no country page is fetched again.
		const calls = stubFetch(routes);
		await fcdo.collect();
		assert.deepEqual(
			calls.filter((u) => /advice\/./.test(u)),
			[],
		);
	});
});

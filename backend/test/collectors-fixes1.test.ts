// Collector contract tests, fix-or-drop pass #1 (2026-09-24): behaviours the
// production failures taught us. Upstreams stubbed at fetch.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { collect as energy } from "../src/workers/collectors/energy-eu.js";
import { collect as flights } from "../src/workers/collectors/flights.js";
import { collect as relief } from "../src/workers/collectors/relief.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

const ok = (body: unknown, status = 200) =>
	new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	});
const health = async (source: string) =>
	(
		await query<{ ok: boolean; error: string | null }>(
			"SELECT (last_ok IS NOT NULL AND error IS NULL) AS ok, error FROM feed_health WHERE source=$1",
			[source],
		)
	)[0];

describe("adsb.lol radius query", () => {
	it('keeps aircraft on the ground (alt_baro "ground")', async () => {
		globalThis.fetch = (async (url: unknown) =>
			String(url).includes("api.adsb.lol/v2/point/")
				? ok({
						ac: [
							{
								hex: "4b1880",
								flight: "SWR3W",
								lat: 48.7,
								lon: 4.1,
								alt_baro: 39000,
								track: 114,
							},
							{
								hex: "3c6444",
								flight: "DLH1",
								lat: 50.03,
								lon: 8.56,
								alt_baro: "ground",
							},
						],
					})
				: ok({}, 500)) as typeof fetch;
		const r = await flights();
		assert.deepEqual([r.ok, (r as { count?: number }).count], [true, 2]);
		assert.equal((await health("adsb.lol")).ok, true);
	});
});

describe("OCHA feed", () => {
	it("retries the load balancer's 406 on a fresh connection", async () => {
		let ochaCalls = 0;
		globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
			const u = String(url);
			if (u.includes("unocha.org")) {
				ochaCalls++;
				const accept = new Headers(init?.headers).get("accept") ?? "";
				assert.match(accept, /rss\+xml/);
				// a fresh connection per try: a kept-alive one stays on the 406 node
				assert.equal(new Headers(init?.headers).get("connection"), "close");
				return ochaCalls === 1
					? ok("", 406)
					: ok(
							"<rss><channel><item><title>Flash update</title><link>https://www.unocha.org/x</link><pubDate>Wed, 24 Sep 2026 01:00:00 GMT</pubDate></item></channel></rss>",
						);
			}
			return ok("", 500);
		}) as typeof fetch;
		await relief();
		assert.equal(ochaCalls, 2);
		assert.equal((await health("ocha")).ok, true);
	});
});

describe("energy-charts country legs", () => {
	it("asks for a 48 h window and retries a 429 once", async () => {
		const seen: string[] = [];
		const tries = new Map<string, number>();
		const payload = {
			unix_seconds: [1_790_000_000, 1_790_000_900],
			production_types: [{ name: "Wind onshore", data: [120, null] }],
		};
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			const cc = u.match(/country=([a-z]{2})&start=/)?.[1];
			if (!cc) return ok({}, 500);
			seen.push(u);
			const n = (tries.get(cc) ?? 0) + 1;
			tries.set(cc, n);
			return cc === "lu" && n === 1 ? ok({}, 429) : ok(payload);
		}) as typeof fetch;
		await energy();
		assert.ok(
			seen.every((u) => /&start=\d{4}-\d\d-\d\dT\d\d:\d\dZ&end=/.test(u)),
		);
		assert.equal(tries.get("lu"), 2);
		assert.equal((await health("energy-charts-lu")).ok, true);
		// The trailing empty slot is skipped: the row is stamped with the filled one.
		const [row] = await query<{ ts: string }>(
			"SELECT ts::text FROM events WHERE source='energy-charts-lu'",
		);
		assert.match(row.ts, /^2026-09-21 /);
	});
});

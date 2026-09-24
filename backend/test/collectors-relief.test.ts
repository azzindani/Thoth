// Collector contract tests, relief: ReliefWeb + OCHA + IFRC feeds.
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { collect as relief } from "../src/workers/collectors/relief.js";
import {
	healthOf,
	resetTables,
	restoreFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

const ok = (body: string, status = 200) => new Response(body, { status });

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
		assert.equal((await healthOf("ocha")).ok, true);
	});
});

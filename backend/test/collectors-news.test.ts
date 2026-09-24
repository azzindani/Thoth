// Collector contract tests, news: the keyless world-news RSS bundle.
// Upstreams stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as news from "../src/workers/collectors/news.js";
import {
	eventsOf,
	healthOf,
	resetTables,
	restoreFetch,
	stubFetch,
	text,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title>Storm hits coast</title><link>https://example.org/a</link>
<pubDate>Thu, 24 Sep 2026 10:00:00 +0000</pubDate></item></channel></rss>`;

/** Undici's shape for a failed connect. */
const connectFail = () => {
	throw new TypeError("fetch failed");
};

describe("news feed fetch", () => {
	it("retries a failed connect once and lands the feed", async () => {
		let bbc = 0;
		stubFetch([
			[
				/feeds\.bbci\.co\.uk/,
				() => (++bbc === 1 ? connectFail() : text(RSS)()),
			],
			[/./, text(RSS)],
		]);
		await news.collect();
		assert.equal(bbc, 2);
		assert.equal((await healthOf("bbc")).ok, true);
		assert.equal((await eventsOf("bbc")).length, 1);
	});
	it("fails a feed whose host stays unreachable, after one retry", async () => {
		let tries = 0;
		stubFetch([
			[
				/aljazeera\.com/,
				() => {
					tries++;
					return connectFail();
				},
			],
			[/./, text(RSS)],
		]);
		await news.collect();
		assert.equal(tries, 2);
		assert.match((await healthOf("aljazeera")).error ?? "", /fetch failed/);
		assert.equal((await healthOf("guardian")).ok, true);
	});
	it("does not retry an HTTP error", async () => {
		const calls = stubFetch([
			[/rss\.dw\.com/, text("busy", 503)],
			[/./, text(RSS)],
		]);
		await news.collect();
		assert.equal(calls.filter((u) => u.includes("rss.dw.com")).length, 1);
		assert.match((await healthOf("dw")).error ?? "", /HTTP 503/);
	});
});

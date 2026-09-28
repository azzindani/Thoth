// Outbound webhooks: baseline, delivery, signing, watch matches, retries.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { storeNormalized } from "../src/workers/lib/store.js";
import {
	parseTargets,
	sign,
	type Target,
	webhookPass,
} from "../src/workers/webhooks.js";

type Call = { url: string; headers: Record<string, string>; body: string };

/** A fetch stand-in that records calls and answers with `status`. */
function receiver(initial = 200) {
	const r = {
		status: initial,
		calls: [] as Call[],
		impl: (async (url: string | URL, init?: RequestInit) => {
			r.calls.push({
				url: String(url),
				headers: init?.headers as Record<string, string>,
				body: String(init?.body),
			});
			return new Response(null, { status: r.status });
		}) as typeof fetch,
	};
	return r;
}

const [T] = parseTargets("https://hooks.example.org/thoth") as [Target];
let n = 0;
const critical = (title = "Critical thing") =>
	storeNormalized({
		id: `test:crit:${++n}`,
		ts: new Date().toISOString(),
		source: "test",
		layer: "quakes",
		title,
		severity: "critical",
		confidence: 1,
		lat: 10,
		lon: 20,
	});

beforeEach(async () => {
	await query("TRUNCATE events, event_dups, watchlists, webhook_deliveries");
});

describe("webhooks", () => {
	it("parses targets, dropping non-http entries", () => {
		const t = parseTargets(
			" https://a.example/x ,ftp://b, not a url,http://c.local/y",
		);
		assert.deepEqual(
			t.map((x) => x.url),
			["https://a.example/x", "http://c.local/y"],
		);
		assert.match(t[0]?.id ?? "", /^[0-9a-f]{12}$/);
	});

	it("is off without targets", async () => {
		await critical();
		assert.deepEqual(await webhookPass({ targets: [] }), {
			sent: 0,
			failed: 0,
			baseline: 0,
		});
	});

	it("baselines what is live, then sends only new items, once", async () => {
		await critical("already live");
		const r = receiver();
		const first = await webhookPass({ targets: [T], fetchImpl: r.impl });
		assert.equal(first.baseline, 1);
		assert.equal(r.calls.length, 0);

		await critical("new one");
		const second = await webhookPass({
			targets: [T],
			secret: "s3cret",
			fetchImpl: r.impl,
		});
		assert.equal(second.sent, 1);
		assert.equal(r.calls.length, 1);
		const call = r.calls[0] as Call;
		const body = JSON.parse(call.body);
		assert.equal(body.type, "alert.critical");
		assert.equal(body.event.title, "new one");
		assert.equal(call.headers["X-Thoth-Event"], "alert.critical");
		const ts = call.headers["X-Thoth-Timestamp"] as string;
		const expected = `sha256=${createHmac("sha256", "s3cret").update(`${ts}.${call.body}`).digest("hex")}`;
		assert.equal(call.headers["X-Thoth-Signature"], expected);
		assert.equal(sign("s3cret", ts, call.body), expected);

		// Re-seen by the next poll: not sent again.
		await query("UPDATE events SET ingested_at = now()");
		const third = await webhookPass({ targets: [T], fetchImpl: r.impl });
		assert.equal(third.sent, 0);
		assert.equal(r.calls.length, 1);
	});

	it("an empty baseline still delivers the first item", async () => {
		const r = receiver();
		await webhookPass({ targets: [T], fetchImpl: r.impl });
		await critical();
		assert.equal(
			(await webhookPass({ targets: [T], fetchImpl: r.impl })).sent,
			1,
		);
	});

	it("delivers watch matches with the watch", async () => {
		const r = receiver();
		await webhookPass({ targets: [T], fetchImpl: r.impl });
		await query(
			"INSERT INTO watchlists (id, kind, value) VALUES ('w1', 'keyword', 'pipeline')",
		);
		await storeNormalized({
			id: "test:info:1",
			ts: new Date().toISOString(),
			source: "test",
			layer: "news",
			title: "Pipeline explosion reported",
			severity: "info",
			confidence: 1,
		});
		await webhookPass({ targets: [T], fetchImpl: r.impl });
		assert.equal(r.calls.length, 1);
		const body = JSON.parse((r.calls[0] as Call).body);
		assert.equal(body.type, "watch.match");
		assert.deepEqual(body.watch, {
			id: "w1",
			kind: "keyword",
			value: "pipeline",
		});
	});

	it("retries a failing receiver, then gives up", async () => {
		const r = receiver(500);
		await webhookPass({ targets: [T], fetchImpl: r.impl });
		await critical();
		for (let i = 0; i < 7; i++)
			await webhookPass({ targets: [T], fetchImpl: r.impl });
		assert.equal(r.calls.length, 5);
		const [row] = await query<{ status: string; attempts: number }>(
			"SELECT status, attempts FROM webhook_deliveries WHERE event_id <> '*'",
		);
		assert.deepEqual(row, { status: "failed", attempts: 5 });
	});

	it("recovers once the receiver answers", async () => {
		const r = receiver(503);
		await webhookPass({ targets: [T], fetchImpl: r.impl });
		await critical();
		assert.equal(
			(await webhookPass({ targets: [T], fetchImpl: r.impl })).failed,
			1,
		);
		r.status = 204;
		assert.equal(
			(await webhookPass({ targets: [T], fetchImpl: r.impl })).sent,
			1,
		);
	});
});

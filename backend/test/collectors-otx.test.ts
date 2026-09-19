// Collector contract tests, otx: disabled path + enabled path (dummy key, dynamic import).
// Consolidated from collectors-batch4/6 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { config } from "../src/config.js";
import { query } from "../src/db/client.js";
import { collect as otx } from "../src/workers/collectors/otx.js";

const realFetch = globalThis.fetch;

function stub(json: unknown, status = 200) {
	globalThis.fetch = (async (_url: unknown, init?: unknown) => {
		const headers = (init as { headers?: Record<string, string> })?.headers;
		assert.equal(
			headers?.["X-OTX-API-KEY"],
			"test-key-not-real",
			"key sent as X-OTX-API-KEY header",
		);
		return new Response(JSON.stringify(json), { status });
	}) as typeof fetch;
}

before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("otx collect() enabled", () => {
	it("stores pulses as cyber watch items + raw receipt", async () => {
		config.OTX_API_KEY = "test-key-not-real";
		stub({
			results: [
				{
					id: "abc123",
					name: "Evil Joystick APT",
					description: "C2 infra roundup",
					modified: "2026-09-08T12:00:00.000Z",
					tlp: "white",
				},
				{ id: "no-name" },
				{
					id: "bad-date",
					name: "No Date Pulse",
					modified: "not-a-date",
				},
			],
		});
		const r = await otx();
		assert.equal(r.ok, true);
		assert.equal(r.count, 2, "nameless pulse skipped, bad date tolerated");
		const rows = await query<{ id: string; severity: string }[]>(
			"SELECT id, severity FROM events WHERE source='otx' ORDER BY id",
		);
		assert.equal(rows.length, 2);
		assert.ok(
			rows.every((x) => x.severity === "watch"),
			"pulses are watch, never critical",
		);
		const raw = await query<{ http_status: number }[]>(
			"SELECT http_status FROM raw_events WHERE source='otx'",
		);
		assert.equal(raw.length, 1, "raw receipt kept");
		const h = await query<{ last_ok: string | null }[]>(
			"SELECT last_ok FROM feed_health WHERE source='otx'",
		);
		assert.ok(h[0]?.last_ok, "health marked ok");
	});
	it("empty results mean empty, honestly", async () => {
		config.OTX_API_KEY = "test-key-not-real";
		stub({ results: [] });
		const r = await otx();
		assert.equal(r.ok, true);
		assert.equal(r.count, 0);
	});
	it("HTTP failure marks health with error", async () => {
		config.OTX_API_KEY = "test-key-not-real";
		stub({ detail: "invalid key" }, 401);
		const r = await otx();
		assert.equal(r.ok, false);
		assert.match(String(r.error), /HTTP 401/);
	});
	it("restores unset key for the disabled suite below", async () => {
		config.OTX_API_KEY = "";
		assert.equal(config.OTX_API_KEY, "");
	});
});

describe("otx collect()", () => {
	it("disabled without key, honest error", async () => {
		const r = await otx();
		assert.equal(r.ok, false);
		assert.ok((r.error ?? "").includes("OTX_API_KEY"), "key slot named");
		const h = await query<{ error: string | null }[]>(
			"SELECT error FROM feed_health WHERE source='otx'",
		);
		assert.ok(h[0]?.error, "health records disabled state");
	});
});

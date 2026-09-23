// Monitoring (ROADMAP P1): run telemetry, endpoint log redaction, feed
// alerts raise/clear, retention, run-now queue.
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { markHealth, storeNormalized } from "../src/workers/lib/store.js";
import {
	instrumentFetch,
	outcomeOf,
	redactPath,
	withRun,
} from "../src/workers/lib/telemetry.js";
import {
	checkAlerts,
	claimRequests,
	finishRequests,
	prune,
} from "../src/workers/ops.js";

const realFetch = globalThis.fetch;
const TABLES =
	"events, raw_events, feed_health, source_runs, endpoint_calls, collector_runs, collector_requests";
before(async () => {
	await query(`TRUNCATE ${TABLES}`);
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("telemetry", () => {
	it("redacts secrets from stored paths", () => {
		assert.equal(
			redactPath("/bot123456:AAH-abc_DEF/sendMessage"),
			"/bot***/sendMessage",
		);
		assert.equal(
			redactPath("/v1/keys/0123456789abcdef0123456789abcdef/data"),
			"/v1/keys/***/data",
		);
		assert.equal(redactPath("/lookup/user@example.com"), "/lookup/***");
		assert.equal(redactPath("/api/v2/states/all"), "/api/v2/states/all");
	});
	it("maps collector results to outcomes", () => {
		assert.deepEqual(outcomeOf({ ok: true, count: 4 }), {
			ok: true,
			count: 4,
			error: null,
		});
		assert.deepEqual(outcomeOf({ ok: false, error: "HTTP 503" }), {
			ok: false,
			count: null,
			error: "HTTP 503",
		});
		assert.equal(outcomeOf(undefined).ok, true);
	});
	it("records the run and every upstream call inside it", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("down.example")) throw new Error("ECONNRESET");
			return new Response("{}", {
				status: u.includes("missing") ? 404 : 200,
				headers: { "content-length": "2" },
			});
		}) as typeof fetch;
		instrumentFetch();
		const r = await withRun("testcoll", "manual", async () => {
			await fetch("https://api.example.org/v1/items?key=SECRET");
			await fetch("https://api.example.org/missing");
			await fetch("https://down.example/x").catch(() => {});
			return { ok: false, error: "partial" };
		});
		assert.deepEqual(r, { ok: false, error: "partial" });
		// Outside a run: passes through, records nothing.
		await fetch("https://api.example.org/outside");
		const runs = await query<{ ok: boolean; error: string; trigger: string }>(
			"SELECT ok, error, trigger FROM collector_runs WHERE collector='testcoll'",
		);
		assert.deepEqual(runs, [
			{ ok: false, error: "partial", trigger: "manual" },
		]);
		const calls = await query<{
			host: string;
			path: string;
			status: number | null;
			error: string | null;
		}>(
			"SELECT host, path, status, error FROM endpoint_calls WHERE collector='testcoll' ORDER BY ts, path",
		);
		assert.equal(calls.length, 3);
		assert.deepEqual(calls[0], {
			host: "api.example.org",
			path: "/v1/items", // query string (with the key) never stored
			status: 200,
			error: null,
		});
		assert.equal(calls[1].status, 404);
		assert.equal(calls[2].status, null);
		assert.match(calls[2].error ?? "", /ECONNRESET/);
	});
	it("a crashing collector is recorded as a failed run", async () => {
		await assert.rejects(
			withRun("crashcoll", "schedule", async () => {
				throw new Error("boom");
			}),
		);
		const r = await query<{ ok: boolean; error: string }>(
			"SELECT ok, error FROM collector_runs WHERE collector='crashcoll'",
		);
		assert.deepEqual(r, [{ ok: false, error: "boom" }]);
	});
});

describe("feed alerts", () => {
	const pushed: string[] = [];
	const push = async (t: string) => {
		pushed.push(t);
		return { ok: true };
	};
	beforeEach(() => {
		pushed.length = 0;
	});
	it("markHealth keeps a per-outcome history", async () => {
		await markHealth("alertsrc", true);
		const n = await query("SELECT 1 FROM source_runs WHERE source='alertsrc'");
		assert.equal(n.length, 1);
	});
	it("3 failures in a row raise one alert; recovery clears it", async () => {
		for (let i = 0; i < 3; i++) await markHealth("alertsrc", false, "HTTP 503");
		const a = await checkAlerts(push);
		assert.deepEqual(a.raised, ["ops:failing:alertsrc"]);
		const ev = await query<{ layer: string; severity: string; title: string }>(
			"SELECT layer, severity, title FROM events WHERE id='ops:failing:alertsrc'",
		);
		assert.equal(ev[0].layer, "ops");
		assert.equal(ev[0].severity, "watch");
		assert.match(ev[0].title, /3 runs in a row · HTTP 503/);
		assert.equal(pushed.length, 1);
		// Re-check while still failing: no duplicate, no second push.
		const again = await checkAlerts(push);
		assert.deepEqual(again.raised, []);
		assert.equal(pushed.length, 1);
		// Recovery.
		await markHealth("alertsrc", true);
		const c = await checkAlerts(push);
		assert.deepEqual(c.cleared, ["ops:failing:alertsrc"]);
		assert.match(pushed[1], /recovered: alertsrc/);
		const left = await query("SELECT 1 FROM events WHERE layer='ops'");
		assert.equal(left.length, 0);
	});
	it("a long failure run escalates to critical", async () => {
		for (let i = 0; i < 9; i++) await markHealth("deadsrc", false, "timeout");
		await checkAlerts(push);
		const ev = await query<{ severity: string }>(
			"SELECT severity FROM events WHERE id='ops:failing:deadsrc'",
		);
		assert.equal(ev[0].severity, "critical");
	});
	it("a frozen feed raises a frozen alert", async () => {
		// usgs has a 2h budget: succeeding, newest observation 5h old.
		await storeNormalized({
			id: "test:usgs:old",
			ts: new Date(Date.now() - 5 * 3600e3).toISOString(),
			source: "usgs",
			layer: "quakes",
			title: "old quake",
		});
		await markHealth("usgs", true);
		const a = await checkAlerts(push);
		assert.ok(a.raised.includes("ops:frozen:usgs"));
	});
});

describe("retention + run-now", () => {
	it("prunes old history and stale events, keeps statics and fresh rows", async () => {
		await query(
			`INSERT INTO source_runs(ts, source, ok) VALUES (now() - interval '30 days', 'old', true), (now(), 'new', true)`,
		);
		await query(
			`INSERT INTO endpoint_calls(ts, host, path, ms) VALUES (now() - interval '30 days', 'h', '/', 1)`,
		);
		const old = new Date(Date.now() - 400 * 86400e3).toISOString();
		for (const [id, source] of [
			["p:old", "rss"],
			["p:static", "static"],
		])
			await query(
				`INSERT INTO events(id, ts, ingested_at, source, layer) VALUES ($1, $2, $2, $3, 'news')`,
				[id, old, source],
			);
		await query(
			`INSERT INTO events(id, ts, source, layer) VALUES ('p:fresh-seen', $1, 'rss', 'news')`,
			[old], // observed long ago but re-seen now (ingested_at default now)
		);
		const r = await prune();
		assert.ok(r.source_runs >= 1);
		assert.ok(r.endpoint_calls >= 1);
		assert.equal(r.events, 1);
		const ids = (
			await query<{ id: string }>(
				"SELECT id FROM events WHERE id LIKE 'p:%' ORDER BY id",
			)
		).map((x) => x.id);
		assert.deepEqual(ids, ["p:fresh-seen", "p:static"]);
		const runs = await query("SELECT 1 FROM source_runs WHERE source='new'");
		assert.equal(runs.length, 1);
	});
	it("run-now requests are claimed once and collapse per collector", async () => {
		await query(
			`INSERT INTO collector_requests(collector) VALUES ('quakes'), ('quakes'), ('news')`,
		);
		const got = (await claimRequests()).sort();
		assert.deepEqual(got, ["news", "quakes"]);
		assert.deepEqual(await claimRequests(), []);
		await finishRequests("quakes");
		const open = await query(
			"SELECT 1 FROM collector_requests WHERE done_at IS NULL",
		);
		assert.equal(open.length, 1); // news still running
	});
});

describe("mass failure", () => {
	it("many failing sources → one critical summary, one push each way", async () => {
		await query(`TRUNCATE ${TABLES}`);
		const pushed: string[] = [];
		const push = async (t: string) => {
			pushed.push(t);
			return { ok: true };
		};
		const srcs = Array.from({ length: 12 }, (_, i) => `mass${i}`);
		for (const s of srcs)
			for (let i = 0; i < 9; i++) await markHealth(s, false, "HTTP 403");
		const a = await checkAlerts(push);
		assert.ok(a.raised.includes("ops:mass"));
		const sev = await query<{ id: string; severity: string }>(
			"SELECT id, severity FROM events WHERE layer='ops' ORDER BY id",
		);
		assert.equal(sev.find((x) => x.id === "ops:mass")?.severity, "critical");
		// Individual alerts exist but are capped at watch during a mass failure.
		assert.ok(
			sev
				.filter((x) => x.id !== "ops:mass")
				.every((x) => x.severity === "watch"),
		);
		assert.deepEqual(pushed.length, 1);
		assert.match(pushed[0], /Mass feed failure: 12 of 12/);
		// Everything recovers: one recovery push, not thirteen.
		for (const s of srcs) await markHealth(s, true);
		const c = await checkAlerts(push);
		assert.equal(c.cleared.length, 13);
		assert.equal(pushed.length, 2);
		assert.match(pushed[1], /recovered: mass feed failure/);
	});
});

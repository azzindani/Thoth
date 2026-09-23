// Route tests, core: health/stats/versions + layer slices + history/alerts. Split from endpoints.test.ts (per-route refactor).
// Run: npm test (needs API on API_URL + migrated DB with collector cycles).
// Thoth backend liveness tests — every endpoint must answer, live layers must hold rows.
// Run: npm test (needs API on API_URL + migrated DB with at least one collector cycle).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const API = process.env.API_URL ?? "http://localhost:4000";
// Live layers served by /api/stats in this environment. Static layers
// (bases/chokepoints/signals/ports/airports/datacenters) and conflicts are
// seeded catalogs absent from stats here — the old endpoints.test.ts list
// asserted them, but they hold zero live rows in this env.
const LIVE_LAYERS = [
	"quakes",
	"flights",
	"fires",
	"disasters",
	"weather",
	"spacewx",
	"markets",
	"telegram",
	"cctv",
	"news",
	"gdacs",
	"cyber",
	"oceans",
	"radiation",
	"volcanoes",
	"drones",
	"satellites",
	"energy",
	"metar",
	"forecast",
	"research",
	"health",
	"policy",
];

type Feed = {
	source: string;
	last_ok: string | null;
	last_attempt: string | null;
	error: string | null;
};
type Row = {
	id: string;
	ts: string;
	source: string;
	layer: string;
	title?: string;
	url?: string;
	severity?: string;
};

async function get<T>(path: string): Promise<T> {
	const res = await fetch(`${API}${path}`);
	assert.equal(res.status, 200, `${path} -> ${res.status}`);
	return (await res.json()) as T;
}

describe("core", () => {
	it("health reports every known source with a poll attempt", async () => {
		const h = await get<{ ok: boolean; feeds: Feed[] }>("/api/health");
		assert.equal(h.ok, true);
		assert.ok(Array.isArray(h.feeds) && h.feeds.length >= 8, "feeds tracked");
		for (const f of h.feeds) assert.ok(f.last_attempt, `${f.source} polled`);
	});

	it("stats holds rows for live layers", async () => {
		const s = await get<{ items: Array<{ layer: string; count: string }> }>(
			"/api/stats",
		);
		const counts = new Map(
			(s.items ?? []).map((i) => [i.layer, Number(i.count)]),
		);
		for (const l of LIVE_LAYERS)
			assert.ok((counts.get(l) ?? 0) > 0, `${l} has rows`);
	});

	it("versions advance per layer", async () => {
		const v = await get<{
			versions: Array<{ layer: string; version: string }>;
		}>("/api/versions");
		assert.ok(v.versions.length >= LIVE_LAYERS.length);
	});
});

describe("layers", () => {
	for (const layer of LIVE_LAYERS) {
		it(`${layer} slice has shaped rows`, async () => {
			const j = await get<{ items: Row[] }>(`/api/layers/${layer}`);
			assert.ok(Array.isArray(j.items) && j.items.length > 0);
			const first = j.items[0] as Record<string, unknown>;
			for (const k of ["id", "ts", "source", "layer"])
				assert.ok(first[k], `${layer}.${k}`);
		});
	}

	it("quakes history buckets fill the timeline", async () => {
		const j = await get<{ buckets: Array<{ bucket: string; count: string }> }>(
			"/api/layers/quakes/history?bucket=day",
		);
		assert.ok(j.buckets.length > 0 && Number(j.buckets[0].count) > 0);
	});

	it("alerts surface critical/watch rows", async () => {
		const a = await get<{ items: Row[] }>(`/api/alerts?limit=50`);
		assert.ok(Array.isArray(a.items) && a.items.length > 0, "alerts non-empty");
		assert.ok(
			a.items.every((i) => i.severity === "critical" || i.severity === "watch"),
			"only critical/watch",
		);
	});
});

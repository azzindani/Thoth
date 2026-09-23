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

	// Viewport slices (ROADMAP P2) — airports is the 5,280-row static catalog.
	type View = {
		items: { geom: { coordinates: number[] } }[];
		total: number;
		matched: number;
		truncated: boolean;
	};
	const regions = (v: View) =>
		new Set(
			v.items.map(
				(i) =>
					`${Math.floor(i.geom.coordinates[0] / 30)},${Math.floor(i.geom.coordinates[1] / 30)}`,
			),
		).size;
	it("world view samples every region instead of the newest 500", async () => {
		const flat = await get<View>("/api/layers/airports");
		const world = await get<View>("/api/layers/airports?z=1.5");
		assert.equal(world.matched, 5280);
		assert.ok(world.truncated && world.total === 1000);
		assert.ok(
			regions(world) > regions(flat) * 2,
			`${regions(world)} regions vs ${regions(flat)}`,
		);
	});
	it("a zoomed-in view returns every row inside it", async () => {
		const v = await get<View>("/api/layers/airports?z=6&bbox=-10,35,30,60");
		assert.equal(v.truncated, false);
		assert.equal(v.total, v.matched);
		assert.ok(v.total > 500);
		for (const i of v.items) {
			const [x, y] = i.geom.coordinates;
			assert.ok(x >= -10 && x <= 30 && y >= 35 && y <= 60);
		}
	});
	it("a view across the antimeridian covers both sides", async () => {
		const v = await get<View>("/api/layers/airports?z=4&bbox=170,-50,-170,-10");
		const xs = v.items.map((i) => i.geom.coordinates[0]);
		assert.ok(xs.some((x) => x > 170) && xs.some((x) => x < -170));
		assert.ok(xs.every((x) => x >= 170 || x <= -170));
	});
	it("rejects a malformed view", async () => {
		for (const q of ["z=4&bbox=1,2,3", "z=abc", "z=4&bbox=0,60,10,50"]) {
			const r = await fetch(`${API}/api/layers/airports?${q}`);
			assert.equal(r.status, 400, q);
		}
	});

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

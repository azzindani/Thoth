// Route tests, monitor (ROADMAP P1): summary, sources, collectors,
// endpoints, catalog, source detail, run-now, Prometheus metrics.
// Run: npm test (needs API on API_URL + migrated DB).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const API = process.env.API_URL ?? "http://localhost:4000";
const KEY = process.env.API_WRITE_KEY ?? "";

async function get<T>(path: string, status = 200): Promise<T> {
	const res = await fetch(`${API}${path}`);
	assert.equal(res.status, status, `${path} -> ${res.status}`);
	return (await res.json()) as T;
}

describe("monitor routes", () => {
	it("summary: worker, source states, db, retention", async () => {
		const j = await get<{
			ok: boolean;
			worker: { alive: boolean };
			sources: Record<string, number>;
			collectors: number;
			db: { size_bytes: number };
			retention: { monitor_days: number };
		}>("/api/monitor/summary");
		assert.equal(j.ok, true);
		assert.equal(typeof j.worker.alive, "boolean");
		const s = j.sources;
		assert.equal(
			s.ok + s.failing + s.frozen + s.stale + s.warming,
			s.total,
			"every source has exactly one state",
		);
		assert.ok(j.collectors >= 60);
		assert.ok(j.db.size_bytes > 0);
		assert.ok(j.retention.monitor_days >= 1);
	});
	it("sources: history fields on every row", async () => {
		const j = await get<{
			items: {
				source: string;
				state: string;
				strip: string;
				runs24: number;
				ok24: number;
				fail_streak: number;
			}[];
		}>("/api/monitor/sources");
		assert.ok(j.items.length > 5);
		for (const r of j.items) {
			assert.match(r.state, /^(ok|failing|frozen|stale|warming)$/);
			assert.match(r.strip, /^[01]{0,48}$/);
			assert.ok(r.ok24 <= r.runs24);
			assert.ok(r.fail_streak >= 0);
		}
	});
	it("collectors: every registered collector with cadence", async () => {
		const j = await get<{
			items: { collector: string; interval_sec: number; sources: string[] }[];
		}>("/api/monitor/collectors");
		const names = j.items.map((c) => c.collector);
		for (const n of ["quakes", "navwarn", "gpsjam", "storms"])
			assert.ok(names.includes(n), n);
		assert.ok(j.items.every((c) => c.interval_sec > 0));
		const storms = j.items.find((c) => c.collector === "storms");
		assert.ok(storms?.sources.includes("jtwc"));
	});
	it("endpoints + catalog answer", async () => {
		const e = await get<{ ok: boolean; items: unknown[] }>(
			"/api/monitor/endpoints",
		);
		assert.equal(e.ok, true);
		assert.ok(Array.isArray(e.items));
		const c = await get<{
			items: { collector: string; key: string | null; hosts: string[] }[];
		}>("/api/monitor/catalog");
		assert.equal(
			c.items.find((x) => x.collector === "otx")?.key,
			"OTX_API_KEY",
		);
	});
	it("source detail: known source vs unknown", async () => {
		const src = (
			await get<{ items: { source: string }[] }>("/api/monitor/sources")
		).items[0].source;
		const d = await get<{ source: string; runs: unknown[] }>(
			`/api/monitor/sources/${encodeURIComponent(src)}`,
		);
		assert.equal(d.source, src);
		await get("/api/monitor/sources/no-such-source-xyz", 404);
	});
	it("run now: unknown 404, write key required, known queued once", async () => {
		const unauth = await fetch(`${API}/api/monitor/run/quakes`, {
			method: "POST",
		});
		// Dev without a key configured leaves writes open; with one, 401.
		if (KEY) assert.equal(unauth.status, 401);
		const post = (name: string) =>
			fetch(`${API}/api/monitor/run/${name}`, {
				method: "POST",
				headers: KEY ? { "X-Thoth-Key": KEY } : {},
			});
		assert.equal((await post("nope")).status, 404);
		const a = await post("volcanoes");
		assert.equal(a.status, 202);
		const b = (await (await post("volcanoes")).json()) as { queued: boolean };
		assert.equal(b.queued, false, "second request collapses into the first");
	});
	it("/metrics is Prometheus text", async () => {
		const res = await fetch(`${API}/metrics`);
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
		const t = await res.text();
		assert.match(t, /^# HELP thoth_worker_up/m);
		assert.match(t, /^thoth_worker_up [01]$/m);
		assert.match(
			t,
			/^thoth_source_up\{source="[^"]+",collector="[^"]*"\} [01]$/m,
		);
		assert.match(t, /^thoth_db_size_bytes \d+$/m);
	});
});

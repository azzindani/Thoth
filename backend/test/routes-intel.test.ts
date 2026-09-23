// Route tests, intel: dossier/brief/theaters + search/watch + sitrep/stream/export/trend. Split from endpoints.test.ts (per-route refactor).
// Run: npm test (needs API on API_URL + migrated DB with collector cycles).
// Thoth backend liveness tests — every endpoint must answer, live layers must hold rows.
// Run: npm test (needs API on API_URL + migrated DB with at least one collector cycle).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveFetch as fetch } from "./helpers/live-fetch.js";

const API = process.env.API_URL ?? "http://localhost:4000";
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
	"bases",
	"chokepoints",
	"conflicts",
	"radiation",
	"volcanoes",
	"drones",
	"satellites",
	"ports",
	"airports",
	"datacenters",
	"energy",
	"signals",
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

describe("intel", () => {
	it("dossier over London finds CCTV + context", async () => {
		const d = await get<{
			items: Row[];
			counts: Array<{ layer: string; count: string }>;
		}>("/api/dossier?lat=51.5&lng=-0.12&radius_km=100");
		assert.ok(d.items.length > 0, "dossier items");
		assert.ok(
			d.counts.some((c) => c.layer === "cctv"),
			"cctv in dossier",
		);
	});

	it("sanctions search hits OFAC mirror", async () => {
		const s = await get<{ items: Array<{ name: string }> }>(
			"/api/osint/sanctions?query=putin&limit=5",
		);
		assert.ok(s.items.length > 0);
		assert.ok(s.items[0].name);
	});

	it("sanctions search requires a query", async () => {
		const res = await fetch(`${API}/api/osint/sanctions`);
		assert.equal(res.status, 400);
	});

	it("brief is deterministic: critical + watch + gaps", async () => {
		const b = await get<{
			generated_at: string;
			critical: Row[];
			watch: Row[];
			gaps: Array<{ source: string }>;
			counts: Array<{ layer: string; count: string }>;
		}>("/api/brief");
		assert.ok(b.generated_at, "timestamped");
		assert.ok(Array.isArray(b.critical) && Array.isArray(b.watch), "sections");
		assert.ok(
			b.critical.every((r) => r.severity === "critical"),
			"critical section pure",
		);
		assert.ok(
			b.watch.every((r) => r.severity === "watch"),
			"watch section pure",
		);
		assert.ok(b.counts.length >= LIVE_LAYERS.length - 3, "counts cover layers");
	});

	it("theaters serve fly-to config", async () => {
		const t = await get<{
			theaters: Record<
				string,
				{
					label: string;
					center: [number, number];
					zoom: number;
					cities: number;
				}
			>;
		}>("/api/theaters");
		assert.ok(
			t.theaters["iran-israel"] && t.theaters["russia-ukraine"],
			"both theaters",
		);
		assert.ok(t.theaters["iran-israel"].cities >= 20, "city counts");
	});

	it("aircraft watchlist hits and misses", async () => {
		const hit = await get<{ ok: boolean; hit: { operator: string } | null }>(
			"/api/osint/aircraft?reg=FAC1282",
		);
		assert.ok(hit.ok && hit.hit, "FAC1282 on watchlist");
		assert.ok(hit.hit.operator.includes("Colombian"), "operator matches");
		const miss = await get<{ ok: boolean; hit: null }>(
			"/api/osint/aircraft?reg=ZZZ999",
		);
		assert.equal(miss.hit, null);
	});

	it("airport registry resolves SIN", async () => {
		const a = await get<{ ok: boolean; hit: { name: string } | null }>(
			"/api/osint/airport?code=SIN",
		);
		assert.ok(a.ok && a.hit?.name.includes("Changi"), "Changi found");
	});

	it("vessel watch finds KORU", async () => {
		const v = await get<{ ok: boolean; hits: Array<{ name: string }> }>(
			"/api/osint/vessel?q=koru",
		);
		assert.ok(v.ok && v.hits.length > 0, "KORU found");
	});

	it("mitre lookup finds phishing techniques", async () => {
		const m = await get<{
			ok: boolean;
			total: number;
			items: Array<{ id: string }>;
		}>("/api/osint/mitre?query=phishing");
		assert.ok(m.ok && m.total >= 700, "709 techniques vendored");
		assert.ok(
			m.items.some((t) => t.id.startsWith("T1566")),
			"phishing cluster",
		);
	});

	it("health reports content-age contract fields", async () => {
		const h = await get<{ feeds: Feed[] }>("/api/health");
		for (const f of h.feeds) {
			assert.ok(
				"content_ts" in f && "frozen" in f && "warming" in f,
				`${f.source} contracted`,
			);
			assert.ok(
				!(f.frozen && !f.last_ok),
				`${f.source}: frozen implies succeeding`,
			);
			assert.ok(
				!(f.warming && f.error),
				`${f.source}: warming implies no error`,
			);
		}
	});
});

describe("stream", () => {
	it("SSE emits snapshot with versions", async () => {
		const res = await fetch(`${API}/api/stream`, {
			headers: { Accept: "text/event-stream" },
		});
		assert.equal(res.status, 200);
		assert.ok(res.body, "stream body");
		const reader = res.body.getReader();
		const dec = new TextDecoder();
		let buf = "";
		let done = false;
		const deadline = Date.now() + 15000;
		while (!done && Date.now() < deadline) {
			const { value, done: d } = await reader.read();
			done = d;
			if (value) buf += dec.decode(value);
			if (buf.includes("event: snapshot")) break;
		}
		await reader.cancel();
		assert.ok(buf.includes("event: snapshot"), "snapshot received");
		assert.ok(buf.includes("quakes"), "versions include layers");
	});
});

describe("new capability endpoints (search / watch / cert / asn)", () => {
	it("search requires q", async () => {
		const res = await fetch(`${API}/api/search`);
		assert.equal(res.status, 400);
	});
	it("search hits the live corpus", async () => {
		const s = await get<{ ok: boolean; items: unknown[] }>(
			"/api/search?q=fire&limit=5",
		);
		assert.equal(s.ok, true);
		assert.ok(Array.isArray(s.items));
	});
	it("watch CRUD round-trips", async () => {
		const put = await fetch(`${API}/api/watch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				kind: "keyword",
				value: "e2e-probe-xyz",
				note: "test",
			}),
		});
		assert.equal(put.status, 200);
		const list = await get<{ items: { id: string }[] }>("/api/watch");
		assert.ok(list.items.some((w) => w.id === "w:keyword:e2e-probe-xyz"));
		const m = await get<{ ok: boolean; items: unknown[] }>(
			"/api/watch/matches?limit=5",
		);
		assert.equal(m.ok, true);
		const del = await fetch(`${API}/api/watch/w:keyword:e2e-probe-xyz`, {
			method: "DELETE",
		});
		assert.equal(del.status, 200);
	});
	it("area watch: a circle matches live events inside, never catalogs", async () => {
		const put = await fetch(`${API}/api/watch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// The fixture "Fixture Trench" quakes sit at 38.4, 142.4.
			body: JSON.stringify({
				kind: "area",
				value: "e2e-probe-area",
				lat: 38.4,
				lon: 142.4,
				radius_km: 120,
			}),
		});
		assert.equal(put.status, 200);
		try {
			const list = await get<{
				items: { id: string; geom: { type: string } | null }[];
			}>("/api/watch");
			const w = list.items.find((x) => x.id === "w:area:e2e-probe-area");
			assert.equal(w?.geom?.type, "Polygon");
			const m = await get<{ items: { layer: string; source: string }[] }>(
				"/api/watch/matches?limit=200",
			);
			assert.ok(m.items.some((i) => i.layer === "quakes"));
			assert.ok(m.items.every((i) => i.source !== "static"));
		} finally {
			await fetch(`${API}/api/watch/w:area:e2e-probe-area`, {
				method: "DELETE",
			});
		}
		const bad = await fetch(`${API}/api/watch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "area", value: "no-geometry" }),
		});
		assert.equal(bad.status, 400);
	});
	it("alerts widen with ?hours (since-you-looked window)", async () => {
		const day = await get<{ total: number }>("/api/alerts?limit=500");
		const week = await get<{ total: number }>(
			"/api/alerts?limit=500&hours=168",
		);
		assert.ok(week.total >= day.total);
	});
	it("country page: advisories at the capital, events nearby", async () => {
		const c = await get<{
			country: { name: string };
			advisories: { title: string; source: string }[];
			counts: { layer: string; n: number }[];
			items: unknown[];
		}>("/api/country?q=Afghanistan");
		assert.equal(c.country.name, "Afghanistan");
		assert.ok(c.advisories.some((a) => /Afghanistan/.test(a.title)));
		// One row per issuer, however many the store holds.
		assert.equal(
			c.advisories.length,
			new Set(c.advisories.map((a) => a.source)).size,
		);
		const j = await get<{ counts: { layer: string }[] }>(
			"/api/country?q=Japan&radius_km=800",
		);
		assert.ok(j.counts.some((x) => x.layer === "quakes"));
		assert.equal((await fetch(`${API}/api/country?q=Atlantis`)).status, 404);
		assert.equal((await fetch(`${API}/api/country`)).status, 400);
		const list = await get<{ items: string[] }>("/api/country/list");
		assert.ok(list.items.includes("Japan") && list.items.length > 150);
	});
	it("watch rejects bad kind", async () => {
		const res = await fetch(`${API}/api/watch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "nope", value: "x" }),
		});
		assert.equal(res.status, 400);
	});
	it("cert enumerates subdomains via crt.sh (or degrades honestly)", async () => {
		const res = await fetch(`${API}/api/osint/cert?domain=example.com`);
		if (res.status === 200) {
			const c = (await res.json()) as {
				subdomains?: { name: string }[];
			};
			assert.ok(
				(c.subdomains ?? []).some((s) => s.name.endsWith("example.com")),
			);
		} else {
			// crt.sh 502/429s for hours at a time — honest error, never fake names
			assert.ok([429, 502, 503].includes(res.status), `cert -> ${res.status}`);
			const c = (await res.json()) as { error?: string };
			assert.match(String(c.error), /crt\.sh|502|429|503|unavailable/);
		}
	});
	it("cert requires a domain", async () => {
		const res = await fetch(`${API}/api/osint/cert?domain=nota_domain`);
		assert.equal(res.status, 400);
	});
	it("asn resolves AS15169 via RIPEstat", async () => {
		const a = await get<{ ok: boolean; holder: string; prefixes: string[] }>(
			"/api/osint/asn?q=AS15169",
		);
		assert.equal(a.ok, true);
		assert.ok(String(a.holder).toLowerCase().includes("google"));
		assert.ok(a.prefixes.length > 0);
	});
	it("asn requires q", async () => {
		const res = await fetch(`${API}/api/osint/asn?q=!!!`);
		assert.equal(res.status, 400);
	});
});

describe("capability endpoints round 2 (cve / sitrep / export)", () => {
	it("cve resolves CVE-2024-3094 via NVD", async () => {
		const c = await get<{
			ok: boolean;
			items: { id: string; score: number }[];
		}>("/api/osint/cve?id=CVE-2024-3094");
		assert.equal(c.ok, true);
		assert.equal(c.items[0]?.id, "CVE-2024-3094");
		assert.equal(c.items[0]?.score, 10);
	});
	it("cve requires id or q", async () => {
		const res = await fetch(`${API}/api/osint/cve?q=ab`);
		assert.equal(res.status, 400);
	});
	it("sitrep snapshots and archives by day", async () => {
		const s = (await fetch(`${API}/api/sitrep`, { method: "POST" }).then((r) =>
			r.json(),
		)) as {
			ok: boolean;
			day: string;
			md: string;
		};
		assert.equal(s.ok, true);
		assert.ok(s.md.includes("# THOTH SITREP"));
		const h = await get<{ ok: boolean; items: { day: string }[] }>(
			"/api/sitrep/history?days=7",
		);
		assert.ok(
			h.items.some((r) => r.day === s.day),
			"history clock ticks",
		);
	});
	it("export serves csv + geojson", async () => {
		const csv = await fetch(`${API}/api/layers/fires/export?format=csv`);
		assert.equal(csv.status, 200);
		assert.match(csv.headers.get("content-type") ?? "", /csv/);
		const head = (await csv.text()).split("\n")[0];
		assert.equal(head, "id,ts,source,layer,title,severity,lat,lon");
		const gj = await get<{ type: string; features: unknown[] }>(
			"/api/layers/fires/export?format=geojson",
		);
		assert.equal(gj.type, "FeatureCollection");
	});
	it("export rejects bad format", async () => {
		const res = await fetch(`${API}/api/layers/fires/export?format=xml`);
		assert.equal(res.status, 400);
	});
});

describe("analytics trend", () => {
	it("serves per-day series plus sitrep history", async () => {
		const t = await get<{
			ok: boolean;
			depth_days: string | null;
			series: { day: string; layer: string; n: string }[];
			sitreps: { day: string }[];
		}>("/api/analytics/trend?layer=quakes&days=7");
		assert.equal(t.ok, true);
		assert.ok(t.series.length > 0, "series has days");
		assert.ok(
			t.series.every((r) => r.day && r.layer === "quakes"),
			"rows shaped",
		);
	});
	it("rejects absurd windows", async () => {
		const t = await get<{ days: number }>("/api/analytics/trend?days=9999");
		assert.ok(t.days <= 90, "clamped");
	});
});

describe("terminal pillar (portfolios / notes / screens)", () => {
	it("portfolio CRUD + position round-trips", async () => {
		const put = await fetch(`${API}/api/portfolios`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "E2E Probe" }),
		});
		assert.equal(put.status, 200);
		const { id } = (await put.json()) as { id: string };
		const pos = await fetch(
			`${API}/api/portfolios/${encodeURIComponent(id)}/positions`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ symbol: "NVDA", qty: 10 }),
			},
		);
		assert.equal(pos.status, 200);
		const list = await get<{
			items: { id: string; positions: { symbol: string }[] }[];
		}>("/api/portfolios");
		const pf = list.items.find((p) => p.id === id);
		assert.ok(pf?.positions.some((o) => o.symbol === "NVDA"));
		await fetch(
			`${API}/api/portfolios/${encodeURIComponent(id)}/positions/NVDA`,
			{ method: "DELETE" },
		);
		await fetch(`${API}/api/portfolios/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
		const after = await get<{ items: { id: string }[] }>("/api/portfolios");
		assert.ok(!after.items.some((p) => p.id === id));
	});
	it("portfolio rejects bad input", async () => {
		const res = await fetch(`${API}/api/portfolios`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		assert.equal(res.status, 400);
	});
	it("notes CRUD round-trips", async () => {
		const put = await fetch(`${API}/api/notes`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "E2E note probe", tickers: "NVDA" }),
		});
		assert.equal(put.status, 200);
		const { id } = (await put.json()) as { id: string };
		const q = await get<{ items: { id: string }[] }>(
			"/api/notes?q=e2e+note+probe",
		);
		assert.ok(q.items.some((n) => n.id === id));
		await fetch(`${API}/api/notes/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	});
	it("notes rejects empty title", async () => {
		const res = await fetch(`${API}/api/notes`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "" }),
		});
		assert.equal(res.status, 400);
	});
	it("screens CRUD round-trips", async () => {
		const put = await fetch(`${API}/api/screens`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "E2E Screen", spec: { sort: "gainers" } }),
		});
		assert.equal(put.status, 200);
		const { id } = (await put.json()) as { id: string };
		const list = await get<{ items: { id: string }[] }>("/api/screens");
		assert.ok(list.items.some((s) => s.id === id));
		await fetch(`${API}/api/screens/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	});
});

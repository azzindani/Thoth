// Collector contract tests, satellites: CelesTrak + mirror fallback + attribution + AMSAT. Consolidated from collectors-batch4/8/10/32 (per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	maidenheadToLatLon,
	collect as sats,
} from "../src/workers/collectors/satellites.js";

const realFetch = globalThis.fetch;
// Fresh-epoch TLE, generated per-run: the collector skips elements >3d old,
// so a frozen fixture would rot. Epoch field is YYDDD.DDDDDDDD at cols 18-32.
function freshAo07TLE1(): string {
	const now = new Date();
	const yy = String(now.getUTCFullYear() % 100).padStart(2, "0");
	const start = Date.UTC(now.getUTCFullYear(), 0, 1);
	const day = (now.getTime() - start) / 864e5 + 1;
	const epoch = `${yy}${day.toFixed(8).padStart(12, "0")}`;
	return `1 07530U 74089B   ${epoch} -.00000046  00000-0  15815-5 0  9997`;
}
const AO07_TLE2 =
	"2 07530 101.9919 272.2514 0012038 321.1454  55.4981 12.53699637371783";

function freshTLE1(): string {
	const now = new Date();
	const yy = String(now.getUTCFullYear() % 100).padStart(2, "0");
	const start = Date.UTC(now.getUTCFullYear(), 0, 1);
	const day = (now.getTime() - start) / 864e5 + 1;
	const epoch = `${yy}${day.toFixed(8).padStart(12, "0")}`;
	return `1 25544U 98067A   ${epoch}  .00013495  00000+0  25209-3 0  9997`;
}
const TLE2 =
	"2 25544  51.6292 245.3706 0004854 110.6068 249.5441 15.49061543584742";
function resp(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}

function stub(
	routes: [RegExp, { status?: number; json?: unknown; text?: string }][],
) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [re, r] of routes) {
			if (re.test(u)) {
				if (r.json !== undefined)
					return new Response(JSON.stringify(r.json), {
						status: r.status ?? 200,
					});
				return new Response(r.text ?? "", { status: r.status ?? 200 });
			}
		}
		return new Response("no mock", { status: 500 });
	}) as typeof fetch;
}
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("satellites collect()", () => {
	it("TLE propagates to sane positions, stale elements skipped", async () => {
		const epoch = new Date(Date.now() - 864e5);
		const yy = String(epoch.getUTCFullYear()).slice(2);
		const day =
			Math.floor(
				(epoch.getTime() - Date.UTC(epoch.getUTCFullYear(), 0, 1)) / 864e5,
			) + 1;
		const l1 = `1 99999U 00000A   ${yy}${String(day).padStart(3, "0")}.50000000  .00001902  00000+0  42648-4 0  9994`;
		stub([
			[
				/celestrak\.org/,
				{
					text: `TESTSAT\n${l1}\n2 99999  51.6295 247.9233 0004929 112.8116 247.3394 15.49040812\n`,
				},
			],
		]);
		const r = await sats();
		assert.equal(r.ok, true);
		assert.equal(r.count, 1);
		const rows = await query<{ meta: { altKm: number } }[]>(
			"SELECT meta FROM events WHERE layer='satellites'",
		);
		assert.ok(
			rows[0]?.meta.altKm > 300 && rows[0]?.meta.altKm < 600,
			`alt ${rows[0]?.meta.altKm}`,
		);
	});
});

describe("satellites mirror fallback", () => {
	it("uses the mirror when CelesTrak 403s", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("celestrak.org"))
				return new Response("denied", { status: 403 });
			if (u.includes("tle.ivanstanojevic.me")) {
				const id = Number(u.split("/").pop());
				if (id === 25544)
					return new Response(
						JSON.stringify({
							name: "ISS (ZARYA)",
							line1: freshTLE1(),
							line2: TLE2,
						}),
						{ status: 200 },
					);
				return new Response("no", { status: 404 });
			}
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await sats();
		// only ISS resolves; the rest 404 → partial success, ISS row lands
		assert.equal(r.ok, true);
		assert.equal(r.count, 1);
		const rows = await query<{ id: string; source: string }[]>(
			"SELECT id, source FROM events WHERE layer='satellites' AND source='tle-mirror'",
		);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].id, "sat:25544");
		assert.equal(rows[0].source, "tle-mirror");
	});
	it("uses the mirror when CelesTrak hangs (fetch throws)", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("celestrak.org")) throw new TypeError("fetch failed");
			if (u.includes("tle.ivanstanojevic.me")) {
				const id = Number(u.split("/").pop());
				if (id === 25544)
					return new Response(
						JSON.stringify({
							name: "ISS (ZARYA)",
							line1: freshTLE1(),
							line2: TLE2,
						}),
						{ status: 200 },
					);
				return new Response("no", { status: 404 });
			}
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await sats();
		assert.equal(r.ok, true, "hang falls through to mirror, run stays ok");
		const rows = await query<{ id: string; source: string }[]>(
			"SELECT id, source FROM events WHERE layer='satellites' AND source='tle-mirror'",
		);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].source, "tle-mirror");
	});
});

describe("satellites source attribution", () => {
	it("celestrak path stamps source celestrak", async () => {
		globalThis.fetch = (async (url: unknown) => {
			if (String(url).includes("celestrak.org"))
				return new Response(`ISS (ZARYA)\n${freshTLE1()}\n${TLE2}\n`, {
					status: 200,
				});
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await sats();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; source: string }[]>(
			"SELECT id, source FROM events WHERE layer='satellites' AND source='celestrak'",
		);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].source, "celestrak");
	});
	it("mirror total failure fails honestly", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("celestrak.org"))
				return new Response("denied", { status: 403 });
			return new Response("no", { status: 404 });
		}) as typeof fetch;
		const r = await sats();
		assert.equal(r.ok, false);
		assert.match(String((r as { error?: string }).error), /mirror failed/);
	});
});

describe("satellites amsat-tle + amsat-status", () => {
	it("stores ham TLE positions and Heard reports, skips Not Heard", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("celestrak.org"))
				return new Response("denied", { status: 403 });
			if (u.includes("tle.ivanstanojevic.me"))
				return new Response("no", { status: 404 });
			if (u.includes("wheretheiss.at")) return resp({}, 500);
			if (u.includes("thespacedevs.com")) return resp({}, 500);
			if (u.includes("db.satnogs.org")) return resp({}, 500);
			if (u.includes("rocketlaunch.live")) return resp({}, 500);
			if (u.includes("amsat.org/tle/current"))
				// NOTE: the file-level freshTLE1()/TLE2 are ISS elements (norad 25544) for
				// the mirror suites above — the AMSAT leg needs its own AO-07 elements
				// (norad 07530), generated fresh per-run like the ISS ones (collector
				// skips elements >3d old). Same pattern as batch32's local helper.
				return resp(`AO-07\n${freshAo07TLE1()}\n${AO07_TLE2}\n`);
			if (u.includes("amsat.org/status/api/v1/reports.php"))
				return resp({
					data: [
						{
							id: 1356521,
							name: "RS-44_[V/u]",
							satellite_display_name: "RS-44 [V/u]",
							reported_time: "2026-09-16T08:30:00Z",
							callsign: "OE60200755",
							report: "Heard",
							grid_square: "JN77sn",
						},
						{
							id: 1356522,
							name: "AO-7_[U/v]",
							satellite_display_name: "AO-7 [U/v]",
							reported_time: "2026-09-16T06:30:00Z",
							callsign: "F4JFZ",
							report: "Not Heard",
							grid_square: "JN03nn",
						},
						{
							id: 1356523,
							name: "FO-29_[V/u]",
							satellite_display_name: "FO-29 [V/u]",
							reported_time: "2026-09-16T06:30:00Z",
							callsign: "XX",
							report: "Heard",
							grid_square: "ZZ99",
						},
					],
				});
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const r = await sats();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string; source: string }[]>(
			"SELECT id, source FROM events WHERE source IN ('amsat-tle','amsat-status') ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["amsat-status:1356521", "amsat-tle:07530"],
		);
		const heard = await query<{ lat: number; lon: number }[]>(
			"SELECT ST_Y(geom) AS lat, ST_X(geom) AS lon FROM events WHERE id='amsat-status:1356521'",
		);
		assert.ok(Math.abs(heard[0].lat - 47.5625) < 0.01);
		assert.ok(Math.abs(heard[0].lon - 15.5417) < 0.01);
	});
});

describe("maidenheadToLatLon", () => {
	it("centers known grids", () => {
		// JN77sn ≈ 47.56N 15.54E (Styria, Austria); FN21 ≈ 41.5N 75W (NE Pennsylvania).
		const jn = maidenheadToLatLon("JN77sn");
		assert.ok(jn);
		assert.ok(Math.abs(jn[0] - 47.5625) < 0.01, `lat ${jn[0]}`);
		assert.ok(Math.abs(jn[1] - 15.5417) < 0.01, `lon ${jn[1]}`);
		const fn = maidenheadToLatLon("FN21");
		assert.ok(fn);
		assert.ok(Math.abs(fn[0] - 41.5) < 0.01, `lat ${fn[0]}`);
		assert.ok(Math.abs(fn[1] + 75) < 0.01, `lon ${fn[1]}`);
	});
	it("rejects garbage", () => {
		assert.equal(maidenheadToLatLon(""), null);
		assert.equal(maidenheadToLatLon("ZZ99"), null);
		assert.equal(maidenheadToLatLon("JN77SNXX"), null);
	});
});

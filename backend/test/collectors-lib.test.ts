// Collector contract tests, lib: shared helpers (vuln-enrich, push, static builders, store).
// Consolidated from collectors-batch10/11/19 (per-collector refactor; owid/sunspots/registry/un-suites lost with batch21/24 files in earlier phase — unit.test.ts covers parseUnXml/hans).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import { pickPorts } from "../src/scripts/build-ports-wpi.js";
import { pickPlants } from "../src/scripts/build-powerplants.js";
import { aggregateGed } from "../src/scripts/build-ucdp.js";
import { pushTelegram, sendTelegram } from "../src/workers/lib/push.js";
import { storeNormalized } from "../src/workers/lib/store.js";
import {
	fetchCircl,
	fetchEpss,
	fetchOsv,
} from "../src/workers/lib/vuln-enrich.js";

const realFetch = globalThis.fetch;
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("vuln-enrich", () => {
	it("shapes EPSS/OSV/CIRCL records", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("api.first.org"))
				return new Response(
					JSON.stringify({
						data: [
							{
								cve: "CVE-2024-3094",
								epss: "0.85",
								percentile: "0.99",
								date: "2026-09-14",
							},
						],
					}),
					{ status: 200 },
				);
			if (u.includes("api.osv.dev"))
				return new Response(
					JSON.stringify({
						id: "CVE-2024-3094",
						summary: "xz backdoor",
						published: "2024-03-29T00:00:00Z",
						severity: [{ type: "CVSS_V3", score: "9.0" }],
						affected: [],
						references: [],
					}),
					{ status: 200 },
				);
			if (u.includes("cve.circl.lu"))
				return new Response(
					JSON.stringify({
						cveMetadata: {
							cveId: "CVE-2024-3094",
							state: "PUBLISHED",
							datePublished: "2024-03-29T00:00:00Z",
						},
						containers: {
							cna: { title: "xz", descriptions: [{ value: "backdoor" }] },
						},
					}),
					{ status: 200 },
				);
			return new Response("no mock", { status: 500 });
		}) as typeof fetch;
		const e = await fetchEpss("CVE-2024-3094");
		assert.equal(e.epss, "0.85");
		const o = await fetchOsv("CVE-2024-3094");
		assert.equal(o.severity, "CVSS_V3 9.0");
		const c = await fetchCircl("CVE-2024-3094");
		assert.equal(c.state, "PUBLISHED");
	});
});

describe("static builders (batch19)", () => {
	it("pickPlants keeps >=1000MW geo'd plants", () => {
		const head = [
			"country_long",
			"name",
			"capacity_mw",
			"latitude",
			"longitude",
			"primary_fuel",
			"owner",
		];
		const out = pickPlants(head, [
			["Algeria", "Hadjret Ennous", "1200", "36.5", "2.0", "Gas", "SKH"],
			["Algeria", "Tiny Solar", "10", "36.5", "2.0", "Solar", "X"],
			["Nowhere", "No Geo", "2000", "", "", "Gas", "Y"],
		]);
		assert.equal(out.length, 1);
		assert.equal(out[0].name, "Hadjret Ennous");
	});
	it("pickPorts keeps named geo'd ports", () => {
		const out = pickPorts({
			features: [
				{
					properties: { name: "Rotterdam" },
					geometry: { type: "Point", coordinates: [4.5, 51.9] },
				},
				{
					properties: { name: "" },
					geometry: { type: "Point", coordinates: [0, 0] },
				},
			],
		});
		assert.equal(out.length, 1);
		assert.equal(out[0].name, "Rotterdam");
	});
	it("aggregateGed sums per-conflict deaths (2015+)", async () => {
		const csv =
			"year,conflict_name,best,latitude,longitude,type_of_violence,country\n" +
			"2023,Testland: Rebels,100,10.0,20.0,1,Testland\n" +
			"2024,Testland: Rebels,50,11.0,21.0,1,Testland\n" +
			"2010,Old War,9000,0.0,0.0,1,Oldland\n";
		const enc = new TextEncoder().encode(csv);
		async function* gen(): AsyncGenerator<Uint8Array> {
			yield enc;
		}
		const out = await aggregateGed(gen());
		assert.equal(out.length, 1);
		assert.equal(out[0].name, "Testland: Rebels");
		assert.equal(out[0].deaths, 150);
		assert.equal(out[0].events, 2);
	});
});

describe("pushTelegram", () => {
	it("disabled without token/chat, honest error", async () => {
		const r = await pushTelegram("hello");
		assert.equal(r.ok, false);
		assert.match(String(r.error), /TELEGRAM_BOT_TOKEN/);
	});
	it("sendTelegram posts chat_id + truncated text", async () => {
		let seen: { url: string; body: string } | null = null;
		const fake = (async (url: unknown, init?: { body?: string }) => {
			seen = { url: String(url), body: String(init?.body ?? "") };
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as unknown as typeof fetch;
		const r = await sendTelegram("TOK", "CHAT", "x".repeat(5000), fake);
		assert.equal(r.ok, true);
		assert.match(seen?.url ?? "", /api\.telegram\.org\/botTOK\/sendMessage/);
		const body = JSON.parse(seen?.body ?? "{}") as {
			chat_id?: string;
			text?: string;
		};
		assert.equal(body.chat_id, "CHAT");
		assert.equal(body.text?.length, 4000);
	});
	it("upstream failure and throw both surface honestly", async () => {
		const bad = (async () => {
			return new Response("bad gateway", { status: 502 });
		}) as typeof fetch;
		assert.match(
			String((await sendTelegram("T", "C", "hi", bad)).error),
			/HTTP 502/,
		);
		const boom = (async () => {
			throw new TypeError("fetch failed");
		}) as typeof fetch;
		assert.match(
			String((await sendTelegram("T", "C", "hi", boom)).error),
			/fetch failed/,
		);
	});
});

describe("store ingested_at is last-seen", () => {
	it("re-storing an id refreshes ingested_at without touching ts", async () => {
		await storeNormalized({
			id: "t:ingest",
			ts: "2026-09-01T00:00:00.000Z",
			source: "test",
			layer: "test",
			title: "v1",
			entities: {},
		});
		await query(
			"UPDATE events SET ingested_at = now() - interval '2 hours' WHERE id='t:ingest'",
		);
		await storeNormalized({
			id: "t:ingest",
			ts: "2026-09-01T00:00:00.000Z",
			source: "test",
			layer: "test",
			title: "v2",
			entities: {},
		});
		const rows = await query<{
			ts: string;
			ingested_at: string;
			title: string;
		}>("SELECT ts, ingested_at, title FROM events WHERE id='t:ingest'");
		assert.equal(rows.length, 1);
		assert.equal(rows[0].title, "v2");
		assert.equal(
			new Date(rows[0].ts).toISOString(),
			"2026-09-01T00:00:00.000Z",
		);
		assert.ok(
			Date.now() - new Date(rows[0].ingested_at).getTime() < 60_000,
			`ingested_at refreshed: ${rows[0].ingested_at}`,
		);
		await query("DELETE FROM events WHERE id='t:ingest'");
	});
});

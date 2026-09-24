// Collector contract tests, social: radio + lobsters/devto + reddit.
// Not covered here: the mastodon/lemmy/flickr/inat/gbif legs and gh-events
// (suites lost in the per-collector refactor).
// Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { query } from "../src/db/client.js";
import {
	hazardPosts,
	collect as social,
} from "../src/workers/collectors/social.js";

const realFetch = globalThis.fetch;
function ok(body: unknown, status = 200) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
	}) as unknown as Response;
}
function stub(order: [string, (u: string) => unknown][]) {
	globalThis.fetch = (async (url: unknown) => {
		const u = String(url);
		for (const [key, fn] of order) if (u.includes(key)) return fn(u);
		return new Response("no mock", { status: 500 });
	}) as typeof fetch;
}
before(async () => {
	await query("TRUNCATE events, raw_events, feed_health");
});
after(() => {
	globalThis.fetch = realFetch;
});

describe("social radio", () => {
	it("radio stores geo stations, skips ungeocoded", async () => {
		globalThis.fetch = (async (url: unknown) => {
			const u = String(url);
			if (u.includes("mastodon.social")) return ok([], 500);
			if (u.includes("arctic-shift.photon-reddit")) return ok([], 500);
			if (u.includes("lemmy.world")) return ok([], 500);
			if (u.includes("flickr.com")) return ok({}, 500);
			if (u.includes("inaturalist.org")) return ok({ results: [] }, 500);
			if (u.includes("api.gbif.org")) return ok({ results: [] }, 500);
			if (u.includes("bsky.app")) return ok({ actors: [] }, 500);
			if (u.includes("api.github.com")) return ok([], 500);
			if (u.includes("radio-browser.info"))
				return ok([
					{
						stationuuid: "c5df1376-xxxx",
						name: "1st Greek Jazz FLAC Radio",
						country: "Greece",
						votes: 12,
						geo_lat: 38.022,
						geo_long: 23.84,
						tags: "jazz",
					},
					{
						stationuuid: "deadbeef-xxxx",
						name: "No Geo FM",
						country: "Nowhere",
						votes: 1,
						geo_lat: null,
						geo_long: null,
						tags: "",
					},
				]);
			return ok({}, 500);
		}) as typeof fetch;
		const r = await social();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source='radio'",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["radio:c5df1376-xxxx"],
		);
	});
});

describe("social lobsters/devto", () => {
	it("stores lobste.rs posts and DEV articles", async () => {
		stub([
			["mastodon.social", () => ok([], 500)],
			["arctic-shift", () => ok([], 500)],
			["lemmy.world", () => ok([], 500)],
			["flickr.com", () => ok({}, 500)],
			["inaturalist.org", () => ok({ results: [] }, 500)],
			["api.gbif.org", () => ok({ results: [] }, 500)],
			["bsky.app", () => ok({ actors: [] }, 500)],
			["api.github.com", () => ok([], 500)],
			["radio-browser.info", () => ok([], 500)],
			[
				"lobste.rs",
				() =>
					ok([
						{
							short_id: "4tb4nk",
							created_at: "2026-09-16T05:17:30.841-05:00",
							title: "Local-first issue tracking",
							score: 25,
							comment_count: 3,
							tags: ["git", "tools"],
						},
					]),
			],
			[
				"dev.to",
				() =>
					ok([
						{
							id: 4627685,
							title: "Flutter context symmetry",
							published_at: "2026-09-16T05:45:09Z",
							url: "https://dev.to/x/y",
							public_reactions_count: 7,
							comments_count: 2,
							user: { username: "mickyarun" },
						},
					]),
			],
		]);
		const r = await social();
		assert.equal(r.ok, true);
		const rows = await query<{ id: string }>(
			"SELECT id FROM events WHERE source IN ('lobsters','devto') ORDER BY id",
		);
		assert.deepEqual(
			rows.map((x) => x.id),
			["devto:4627685", "lobsters:4tb4nk"],
		);
	});
});

describe("social reddit (arctic-shift)", () => {
	it("matches natural-hazard titles only", () => {
		const keep = hazardPosts([
			{ title: "M6.1 earthquake strikes off Japan", permalink: "/r/a" },
			{ title: "Flooding closes schools in Valencia", permalink: "/r/b" },
			{ title: "Quakers meet in Philadelphia", permalink: "/r/c" },
			{ title: "Election results are in", permalink: "/r/d" },
			{ title: "Typhoon warning", permalink: "" },
		]);
		assert.deepEqual(
			keep.map((p) => p.permalink),
			["/r/a", "/r/b"],
		);
	});
	it("reads the newest listing (no full-text search) and stores hazard posts", async () => {
		const seen: string[] = [];
		stub([
			[
				"arctic-shift",
				(u) => {
					seen.push(u);
					return ok({
						data: [
							{
								title: "Tsunami warning lifted after quake",
								permalink: "/r/worldnews/comments/x1/",
								created_utc: 1790200000,
								score: 12,
							},
							{
								title: "Trade talks resume",
								permalink: "/r/worldnews/comments/x2/",
							},
						],
					});
				},
			],
		]);
		await social();
		assert.ok(
			seen.every((u) => !u.includes("query=") && u.includes("sort=desc")),
		);
		const rows = await query<{ title: string }>(
			"SELECT title FROM events WHERE source='reddit'",
		);
		assert.deepEqual(
			rows.map((r) => r.title),
			["Tsunami warning lifted after quake"],
		);
		const [h] = await query<{ error: string | null }>(
			"SELECT error FROM feed_health WHERE source='reddit'",
		);
		assert.equal(h.error, null);
	});
});

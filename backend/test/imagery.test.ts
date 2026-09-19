// queryImagery contract: freshest low-cloud Sentinel-2 scene picked,
// honest null when nothing usable, throw on upstream failure.
// Hermetic (stubbed fetch, no DB). Run: npx tsx --test test/imagery.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { queryImagery } from "../src/api/imagery.js";

function item(
	id: string,
	cloud: number | undefined,
	thumb: string | undefined,
	tci: string | undefined,
) {
	return {
		id,
		properties: {
			datetime: "2026-09-12T11:21:43.438000Z",
			...(cloud === undefined ? {} : { "eo:cloud_cover": cloud }),
		},
		assets: {
			...(thumb ? { thumbnail: { href: thumb } } : {}),
			...(tci ? { visual: { href: tci } } : {}),
		},
	};
}
function stubFetch(features: unknown[], status = 200) {
	return (async () =>
		new Response(JSON.stringify({ features }), { status })) as typeof fetch;
}

describe("queryImagery", () => {
	it("picks the low-cloud scene over a fresher cloudy one", async () => {
		const s = await queryImagery(
			-8.2,
			34.7,
			stubFetch([
				item("cloudy", 80, "http://x/c.jpg", "http://x/c.tif"),
				item("clear", 5, "http://x/k.jpg", "http://x/k.tif"),
			]),
		);
		assert.equal(s?.id, "clear");
		assert.equal(s?.cloud_cover, 5);
		assert.equal(s?.thumbnail, "http://x/k.jpg");
		assert.equal(s?.tci, "http://x/k.tif");
	});
	it("falls back to the freshest scene when all are cloudy", async () => {
		const s = await queryImagery(
			0,
			0,
			stubFetch([item("a", 95, "http://x/a.jpg", "http://x/a.tif")]),
		);
		assert.equal(s?.id, "a");
	});
	it("returns null when no scene has usable assets", async () => {
		assert.equal(
			await queryImagery(0, 0, stubFetch([item("a", 5, undefined, undefined)])),
			null,
		);
		assert.equal(await queryImagery(0, 0, stubFetch([])), null);
	});
	it("throws honestly on upstream failure", async () => {
		await assert.rejects(
			queryImagery(0, 0, stubFetch([], 503)),
			/earth-search HTTP 503/,
		);
	});
});

import { describe, expect, it } from "vitest";
import {
	decodeWorkspace,
	encodeWorkspace,
	isSavedPop,
	packPop,
	type SavedPop,
	type Workspace,
	workspaceFromHash,
} from "../src/lib/workspace";

const W: Workspace = {
	v: 1,
	name: "Baltic — ships & jamming ✓",
	hidden: ["news", "markets"],
	camera: { c: [21.5, 57.2], z: 5.5, b: 0, p: 0 },
	mission: "intel",
	sev: "critical",
	mode: "sat",
	globe: false,
	tab: "incidents",
	panels: { expl: true, insp: false, dock: false },
};

describe("workspaces", () => {
	it("round-trips through a URL-safe token (unicode names too)", () => {
		const t = encodeWorkspace(W);
		expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeWorkspace(t)).toEqual(W);
		expect(workspaceFromHash(`#ws=${t}`)).toEqual(W);
	});
	it("rejects anything that is not a workspace", () => {
		expect(decodeWorkspace("not-base64!")).toBeNull();
		expect(
			decodeWorkspace(btoa(JSON.stringify({ v: 1, name: "x" }))),
		).toBeNull();
		expect(workspaceFromHash("#c=1,2,3")).toBeNull();
	});

	it("carries pop-out windows, and still reads workspaces without them", () => {
		const pop: SavedPop = {
			key: "quakes:usgs:1",
			p: {
				id: "usgs:1",
				title: "M6.1",
				url: "https://usgs.gov/e/1",
				lon: 142.4,
				lat: 38.3,
			},
			anchor: [142.4, 38.3],
			x: 120,
			y: 90,
			min: false,
			z: 3,
		};
		const withPops = { ...W, pops: [pop] };
		expect(decodeWorkspace(encodeWorkspace(withPops))).toEqual(withPops);
		expect(decodeWorkspace(encodeWorkspace(W))?.pops).toBeUndefined();
	});
	it("refuses malformed windows and more than four", () => {
		const good: SavedPop = {
			key: "k",
			p: { id: "a" },
			anchor: null,
			x: 1,
			y: 2,
			min: true,
			z: 1,
		};
		expect(isSavedPop(good)).toBe(true);
		expect(isSavedPop({ ...good, p: { id: "a", evil: { nested: 1 } } })).toBe(
			false,
		);
		expect(isSavedPop({ ...good, x: "1" })).toBe(false);
		expect(isSavedPop({ ...good, anchor: [1] })).toBe(false);
		const five = { ...W, pops: [good, good, good, good, good] };
		expect(decodeWorkspace(encodeWorkspace(five))).toBeNull();
	});
	it("packs windows for a link: only http(s) links, long text trimmed", () => {
		const packed = packPop({
			key: "k",
			p: {
				id: "a",
				url: "javascript:alert(1)",
				img: "https://cam.example/still.jpg",
				desc: "x".repeat(5000),
			},
			anchor: null,
			x: 10.6,
			y: 20.2,
			min: false,
			z: 2,
		});
		expect(packed.p.url).toBeUndefined();
		expect(packed.p.img).toBe("https://cam.example/still.jpg");
		expect(String(packed.p.desc)).toHaveLength(400);
		expect([packed.x, packed.y]).toEqual([11, 20]);
	});
});

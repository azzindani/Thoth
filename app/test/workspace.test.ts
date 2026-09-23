import { describe, expect, it } from "vitest";
import {
	decodeWorkspace,
	encodeWorkspace,
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
});

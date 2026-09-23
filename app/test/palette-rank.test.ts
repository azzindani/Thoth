import { describe, expect, it } from "vitest";
import { type Action, rank, score } from "../src/components/Palette";

const a = (group: string, label: string): Action => ({
	id: `${group}-${label}`,
	group,
	label,
	run: () => {},
});
const ACTIONS = [
	a("View", "Hide inspector"),
	a("Layer", "Hide quakes"),
	a("Layer", "Hide news"),
	a("Open", "Incidents tab"),
	a("Open", "Monitor tab"),
];

describe("command palette ranking", () => {
	it("needs every letter, in order", () => {
		expect(score("qk", "Layer Hide quakes")).toBeGreaterThan(0);
		expect(score("kq", "Layer Hide quakes")).toBe(-1);
	});
	it("ranks the specific match first", () => {
		expect(rank("hide quakes", ACTIONS)[0].label).toBe("Hide quakes");
		expect(rank("inc", ACTIONS)[0].label).toBe("Incidents tab");
		expect(rank("mon", ACTIONS)[0].label).toBe("Monitor tab");
	});
	it("keeps catalog order for an empty query", () => {
		expect(rank("  ", ACTIONS).map((x) => x.label)).toEqual(
			ACTIONS.map((x) => x.label),
		);
	});
});

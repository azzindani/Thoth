import { describe, expect, it } from "vitest";
import {
	LAYER_NAMES,
	LAYERS,
	MISSIONS,
	STREAMS,
} from "../src/lib/layer-catalog";

describe("layer catalog integrity", () => {
	it("every layer has color + svg + interval", () => {
		expect(LAYER_NAMES.length).toBeGreaterThanOrEqual(26);
		for (const n of LAYER_NAMES) {
			expect(LAYERS[n].color, `${n} color`).toMatch(/^#[0-9a-f]{6}$/i);
			expect(LAYERS[n].svg, `${n} svg`).toMatch(/<(path|circle|rect|line)/);
			expect(LAYERS[n].intervalSec, `${n} interval`).toBeGreaterThan(0);
		}
	});
	it("missions reference real layers only", () => {
		for (const [m, ls] of Object.entries(MISSIONS)) {
			expect(ls.length, m).toBeGreaterThan(0);
			for (const l of ls) expect(LAYER_NAMES, `${m}→${l}`).toContain(l);
		}
	});
	it("streams have ids", () => {
		expect(STREAMS.length).toBeGreaterThanOrEqual(2);
		for (const [name, id, region] of STREAMS) {
			expect(name.length).toBeGreaterThan(0);
			expect(id).toMatch(/^[a-zA-Z0-9_-]{8,}$/);
			expect(region.length).toBeGreaterThan(0);
		}
	});
});

import { describe, expect, it } from "vitest";
import { buildSitrep, inBox, sitrepMarkdown } from "../src/components/Sitrep";
import type { LayerItem } from "../src/lib/api";

const pt = (
	id: string,
	severity: string,
	lon: number,
	lat: number,
	extra: Partial<LayerItem> = {},
): LayerItem => ({
	id,
	severity,
	ts: "2026-09-23T10:00:00Z",
	source: "src",
	layer: "quakes",
	title: `title ${id}`,
	geom: { type: "Point", coordinates: [lon, lat] },
	...extra,
});

describe("sitrep", () => {
	it("boxes handle the antimeridian and the world", () => {
		expect(inBox(10, 20, null)).toBe(true);
		expect(inBox(10, 20, [0, 0, 30, 30])).toBe(true);
		expect(inBox(10, 40, [0, 0, 30, 30])).toBe(false);
		// w > e: the box crosses 180°
		expect(inBox(0, 179, [170, -10, -170, 10])).toBe(true);
		expect(inBox(0, -175, [170, -10, -170, 10])).toBe(true);
		expect(inBox(0, 0, [170, -10, -170, 10])).toBe(false);
	});

	it("keeps what is in view, ranks incidents, pins notes", () => {
		const d = buildSitrep({
			at: "2026-09-23T12:00:00Z",
			bbox: [0, 0, 40, 40],
			image: null,
			alerts: [
				pt("a", "critical", 10, 10),
				pt("b", "watch", 20, 20),
				pt("far", "critical", -100, 10),
			],
			incidents: [
				pt("i1", "watch", 5, 5, { meta: { events: 9, layers: ["a", "b"] } }),
				pt("i2", "critical", 6, 6, { meta: { events: 2, layers: ["c"] } }),
				pt("i3", "critical", 7, 7, { meta: { events: 4, layers: ["d"] } }),
			],
			notes: [
				{ title: "here", body: "b|x", lat: 12, lon: 12 },
				{ title: "elsewhere", body: "", lat: 12, lon: 120 },
				{ title: "unplaced", body: "", lat: null, lon: null },
			],
			gaps: [{ source: "gdelt", error: null }],
		});
		expect(d.critical.map((r) => r.title)).toEqual(["title a"]);
		expect(d.watch.map((r) => r.title)).toEqual(["title b"]);
		// critical first, then by events
		expect(d.incidents.map((i) => i.title)).toEqual([
			"title i3",
			"title i2",
			"title i1",
		]);
		expect(d.notes.map((n) => n.title)).toEqual(["here"]);

		const md = sitrepMarkdown(d);
		expect(md).toContain("# THOTH SITREP");
		expect(md).toContain("scope: view 0.0, 0.0, 40.0, 40.0");
		expect(md).toContain("| here | 12.00, 12.00 | b\\|x |");
		expect(md).toContain("| gdelt | stale |");
		expect(md).not.toContain("title far");
	});

	it("the world scope keeps everything placed or not", () => {
		const d = buildSitrep({
			at: "2026-09-23T12:00:00Z",
			bbox: null,
			image: null,
			alerts: [
				pt("far", "critical", -100, 10),
				{ ...pt("x", "watch", 0, 0), geom: null },
			],
			incidents: [],
			notes: [],
			gaps: [],
		});
		expect(d.critical).toHaveLength(1);
		expect(d.watch).toHaveLength(1);
		expect(sitrepMarkdown(d)).toContain("## Incidents\n\n_none_");
	});
});

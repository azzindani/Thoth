import { describe, expect, it } from "vitest";
import { diffSince } from "../src/components/SinceDigest";
import type { LayerItem } from "../src/lib/api";

const now = Date.parse("2026-09-23T12:00:00Z");
const h = (n: number) => now - n * 3600e3;
const item = (id: string, severity: string, hoursAgo: number): LayerItem => ({
	id,
	severity,
	ts: new Date(h(hoursAgo)).toISOString(),
	source: "s",
	layer: "quakes",
	title: `title ${id}`,
});

describe("since you last looked", () => {
	it("classifies new, escalated and resolved", () => {
		const prev = {
			at: h(3),
			items: [
				["a", "watch", h(5), "title a", "quakes"],
				["b", "critical", h(4), "title b", "quakes"],
				["gone", "watch", h(10), "Cleared warning", "navwarn"],
				["aged", "watch", h(80), "Old", "news"],
			] as [string, string, number, string, string][],
		};
		const d = diffSince(
			prev,
			[
				item("a", "critical", 5),
				item("b", "critical", 4),
				item("c", "watch", 1),
			],
			now,
		);
		const by = Object.fromEntries(d.map((c) => [c.id, c.kind]));
		expect(by).toEqual({ a: "escalated", c: "new", gone: "resolved" });
		// Resolved rows keep what the snapshot knew; aged-out rows are not "resolved".
		expect(d.find((c) => c.id === "gone")?.title).toBe("Cleared warning");
	});
});

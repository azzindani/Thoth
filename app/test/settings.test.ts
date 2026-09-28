// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
	applySettings,
	DEFAULTS,
	fmtClock,
	fmtStamp,
	LAYOUT_K,
	loadSettings,
	sanitize,
	saveSettings,
	settings,
	TEXT_K,
} from "../src/lib/settings";

describe("settings", () => {
	beforeEach(() => {
		localStorage.clear();
		saveSettings(DEFAULTS);
	});

	it("sanitize keeps valid values and defaults the rest", () => {
		expect(sanitize(null)).toEqual(DEFAULTS);
		const s = sanitize({
			layout: "xl",
			text: "huge",
			time: "local",
			hover: "no",
			extra: 1,
		});
		expect(s.layout).toBe("xl");
		expect(s.text).toBe(DEFAULTS.text);
		expect(s.time).toBe("local");
		expect(s.hover).toBe(DEFAULTS.hover);
		expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULTS).sort());
	});

	it("level M is the original design (multipliers of 1)", () => {
		expect(LAYOUT_K.m).toBe(1);
		expect(TEXT_K.m).toBe(1);
		const ks = ["xs", "s", "m", "l", "xl"] as const;
		for (let i = 1; i < ks.length; i++) {
			expect(LAYOUT_K[ks[i]]).toBeGreaterThan(LAYOUT_K[ks[i - 1]]);
			expect(TEXT_K[ks[i]]).toBeGreaterThan(TEXT_K[ks[i - 1]]);
		}
	});

	it("save persists, applies multipliers and classes", () => {
		saveSettings({
			...DEFAULTS,
			layout: "l",
			text: "xs",
			solid: true,
			motion: "reduce",
		});
		const h = document.documentElement;
		expect(h.style.getPropertyValue("--lk")).toBe(String(LAYOUT_K.l));
		expect(h.style.getPropertyValue("--fk")).toBe(String(TEXT_K.xs));
		expect(h.classList.contains("solid-panels")).toBe(true);
		expect(h.classList.contains("reduce-motion")).toBe(true);
		expect(loadSettings().layout).toBe("l");
		applySettings(DEFAULTS);
		expect(h.classList.contains("solid-panels")).toBe(false);
	});

	it("corrupt storage falls back to defaults", () => {
		localStorage.setItem("thoth.settings", "{not json");
		expect(loadSettings()).toEqual(DEFAULTS);
	});

	it("times follow the UTC / local choice", () => {
		const ts = "2026-09-28T14:05:00Z";
		expect(fmtStamp(ts)).toBe("09-28 14:05Z");
		expect(fmtClock(new Date(ts))).toBe("14:05:00Z");
		saveSettings({ ...settings(), time: "local" });
		const d = new Date(ts);
		const hh = String(d.getHours()).padStart(2, "0");
		expect(fmtStamp(ts)).toBe(
			`${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${hh}:05`,
		);
		expect(fmtClock(d).endsWith("Z")).toBe(false);
		expect(fmtStamp("garbage")).toBe("");
	});
});

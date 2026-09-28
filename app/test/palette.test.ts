import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	basemapStyle,
	DARK,
	PALETTE,
	PAPER,
	SEV_INK,
	setPaletteTheme,
} from "../src/lib/palette";

// palette.ts mirrors the :root tokens for map/canvas code. If a token
// changes in CSS without the TS mirror (or vice versa), the map and the
// chrome silently disagree — fail loudly instead.
const css = readFileSync(
	new URL("../src/app/globals.css", import.meta.url),
	"utf8",
);
const root = css.slice(
	css.indexOf(":root {"),
	css.indexOf("}", css.indexOf(":root {")),
);
const paperBlock = css.slice(
	css.indexOf(':root[data-theme="paper"] {'),
	css.indexOf("}", css.indexOf(':root[data-theme="paper"] {')),
);
const TOKEN: Record<keyof typeof PALETTE, string> = {
	bg: "--bg",
	panel: "--panel",
	panel2: "--panel2",
	raise: "--raise",
	txt: "--txt",
	txt2: "--txt2",
	dim: "--dim",
	faint: "--faint",
	accent: "--accent",
	critical: "--red",
	watch: "--amber",
};

describe("palette mirrors CSS tokens", () => {
	for (const [key, token] of Object.entries(TOKEN)) {
		it(`${key} === ${token}`, () => {
			const m = new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i").exec(root);
			expect(m?.[1]?.toLowerCase(), `${token} in :root`).toBe(
				PALETTE[key as keyof typeof PALETTE].toLowerCase(),
			);
		});
	}
	it("no pure black or white in the palette", () => {
		for (const v of Object.values(PALETTE)) {
			expect(v.toLowerCase()).not.toBe("#000000");
			expect(v.toLowerCase()).not.toBe("#ffffff");
		}
	});
});

describe("paper theme", () => {
	for (const [key, token] of Object.entries(TOKEN)) {
		it(`paper ${key} === ${token}`, () => {
			const m = new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i").exec(paperBlock);
			expect(m?.[1]?.toLowerCase(), `${token} in paper`).toBe(
				PAPER[key as keyof typeof PAPER].toLowerCase(),
			);
		});
	}
	it("swaps the palette, the ink and the basemap, and back", () => {
		setPaletteTheme("paper");
		expect(PALETTE.bg).toBe(PAPER.bg);
		expect(SEV_INK.critical).toBe(PAPER.critical);
		expect(basemapStyle()).toContain("positron");
		setPaletteTheme("dark");
		expect(PALETTE).toEqual(DARK);
		expect(basemapStyle()).toContain("dark-matter");
	});
});

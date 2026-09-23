import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PALETTE } from "../src/lib/palette";

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

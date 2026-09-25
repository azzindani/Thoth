// The design palette for code that cannot read CSS custom properties
// (MapLibre paint, canvas, baked sprites, inline SVG). Mirrors the :root
// tokens in app/globals.css — test/palette.test.ts fails if they drift.
//
// Rules (docs/development/ui-design-system.md §0):
// - Warm black + bone. No pure #000 / #fff anywhere.
// - ONE accent (faience): selection, focus, the primary action. Never data.
// - Colour on data means severity: critical red, watch amber. Everything
//   healthy or informational stays neutral bone.
export const PALETTE = {
	bg: "#0b0b0a",
	panel: "#111110",
	panel2: "#181816",
	raise: "#1c1b19",
	txt: "#e9e5da",
	txt2: "#bdb8ac",
	dim: "#8a867c",
	faint: "#5f5c55",
	accent: "#4fbfae",
	critical: "#e5484d",
	watch: "#f0a020",
} as const;

/** Map symbol ink per severity (info/unknown = bone, slightly receded). */
export const SEV_INK: Record<string, string> = {
	critical: PALETTE.critical,
	watch: PALETTE.watch,
	info: "#cfc9bb",
};

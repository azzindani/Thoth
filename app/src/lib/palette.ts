// The design palette for code that cannot read CSS custom properties
// (MapLibre paint, canvas, baked sprites, inline SVG). Mirrors the :root
// tokens in app/globals.css — test/palette.test.ts fails if they drift.
//
// Rules (docs/development/ui-design-system.md §0):
// - Warm black + bone. No pure #000 / #fff anywhere.
// - ONE accent (faience): selection, focus, the primary action. Never data.
// - Colour on data means severity: critical red, watch amber. Everything
//   healthy or informational stays neutral bone.
export type Theme = "dark" | "paper";
type Palette = {
	bg: string;
	panel: string;
	panel2: string;
	raise: string;
	txt: string;
	txt2: string;
	dim: string;
	faint: string;
	accent: string;
	critical: string;
	watch: string;
};

export const DARK: Palette = {
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
};

/** Mirrors :root[data-theme="paper"] in globals.css. */
export const PAPER: Palette = {
	bg: "#f3efe6",
	panel: "#fbf8f1",
	panel2: "#f1ece2",
	raise: "#e8e2d5",
	txt: "#1d1b17",
	txt2: "#45413a",
	dim: "#6b665c",
	faint: "#99938a",
	accent: "#1f7f72",
	critical: "#c42f35",
	watch: "#b36a00",
};

/** The palette in force. Map and canvas code read it when they draw or
 * build a map, so a theme change remounts the map (page.tsx). */
export const PALETTE: Palette = { ...DARK };

/** Map symbol ink per severity (info/unknown = the receded text tone). */
export const SEV_INK: Record<string, string> = {
	critical: DARK.critical,
	watch: DARK.watch,
	info: "#cfc9bb",
};

let current: Theme = "dark";
export const theme = (): Theme => current;

export function setPaletteTheme(t: Theme): void {
	current = t;
	Object.assign(PALETTE, t === "paper" ? PAPER : DARK);
	SEV_INK.critical = PALETTE.critical;
	SEV_INK.watch = PALETTE.watch;
	SEV_INK.info = t === "paper" ? "#4a463e" : "#cfc9bb";
}

/** Takes the theme from <html data-theme>, which the early script in
 * layout.tsx sets before paint: maps are built in child effects, which run
 * before the page applies the settings. */
export function syncPaletteFromDom(): Theme {
	if (typeof document !== "undefined")
		setPaletteTheme(
			document.documentElement.dataset.theme === "paper" ? "paper" : "dark",
		);
	return current;
}

/** CARTO basemap matching the theme: Dark Matter or Positron. */
export function basemapStyle(t: Theme = current): string {
	return t === "paper"
		? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
		: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
}

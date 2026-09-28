// Per-browser display settings (Settings panel). Stored in localStorage,
// applied to <html> as CSS multipliers and classes so every surface picks
// them up without re-rendering: --lk scales layout (panel widths, bars,
// controls, spacing), --fk scales text. Level M is the original design.

export const LEVELS = ["xs", "s", "m", "l", "xl"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABEL: Record<Level, string> = {
	xs: "XS",
	s: "S",
	m: "M",
	l: "L",
	xl: "XL",
};
/** layout multiplier per level */
export const LAYOUT_K: Record<Level, number> = {
	xs: 0.85,
	s: 0.92,
	m: 1,
	l: 1.1,
	xl: 1.22,
};
/** text multiplier per level */
export const TEXT_K: Record<Level, number> = {
	xs: 0.86,
	s: 0.93,
	m: 1,
	l: 1.12,
	xl: 1.26,
};

export type Settings = {
	layout: Level;
	text: Level;
	/** timestamps in UTC (analyst default) or the browser's local zone */
	time: "utc" | "local";
	/** critical-alert popups */
	critPopups: boolean;
	/** watch-match popups */
	watchPopups: boolean;
	/** hover previews on the map (desk) */
	hover: boolean;
	/** overview minimap (desk/tablet) */
	minimap: boolean;
	/** opaque panels instead of blurred glass (slower GPUs) */
	solid: boolean;
	/** "system" follows the OS; "reduce" turns animation off here */
	motion: "system" | "reduce";
	/** open where you left off (without a link that says otherwise) */
	rememberView: boolean;
};

export const DEFAULTS: Settings = {
	layout: "m",
	text: "m",
	time: "utc",
	critPopups: true,
	watchPopups: true,
	hover: true,
	minimap: true,
	solid: false,
	motion: "system",
	rememberView: false,
};

const KEY = "thoth.settings";
export const SETTINGS_EVENT = "thoth:settings";

/** Keeps only known keys with valid values; anything else is a default. */
export function sanitize(raw: unknown): Settings {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<
		string,
		unknown
	>;
	const lvl = (v: unknown, d: Level): Level =>
		LEVELS.includes(v as Level) ? (v as Level) : d;
	const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
	return {
		layout: lvl(r.layout, DEFAULTS.layout),
		text: lvl(r.text, DEFAULTS.text),
		time: r.time === "local" ? "local" : "utc",
		critPopups: bool(r.critPopups, DEFAULTS.critPopups),
		watchPopups: bool(r.watchPopups, DEFAULTS.watchPopups),
		hover: bool(r.hover, DEFAULTS.hover),
		minimap: bool(r.minimap, DEFAULTS.minimap),
		solid: bool(r.solid, DEFAULTS.solid),
		motion: r.motion === "reduce" ? "reduce" : "system",
		rememberView: bool(r.rememberView, DEFAULTS.rememberView),
	};
}

let current: Settings = DEFAULTS;

export function loadSettings(): Settings {
	try {
		current = sanitize(JSON.parse(localStorage.getItem(KEY) ?? "null"));
	} catch {
		current = DEFAULTS;
	}
	return current;
}

/** The settings in force (module state, for code outside React). */
export function settings(): Settings {
	return current;
}

export function saveSettings(s: Settings): void {
	current = sanitize(s);
	try {
		localStorage.setItem(KEY, JSON.stringify(current));
	} catch {
		/* private mode: still applied for this visit */
	}
	applySettings(current);
	window.dispatchEvent(new Event(SETTINGS_EVENT));
}

export function applySettings(s: Settings): void {
	const html = document.documentElement;
	html.style.setProperty("--lk", String(LAYOUT_K[s.layout]));
	html.style.setProperty("--fk", String(TEXT_K[s.text]));
	html.dataset.layout = s.layout;
	html.dataset.text = s.text;
	html.classList.toggle("solid-panels", s.solid);
	html.classList.toggle("reduce-motion", s.motion === "reduce");
}

// ── time display ───────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");

/** "09-28 14:05Z" (UTC) or "09-28 21:05" in the local zone. */
export function fmtStamp(ts: unknown): string {
	const t = Date.parse(String(ts ?? ""));
	if (!Number.isFinite(t)) return "";
	const d = new Date(t);
	if (current.time === "local")
		return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	return `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}Z`;
}

/** "2026-09-28 14:05Z" or local "2026-09-28 21:05 (UTC+7)". */
export function fmtFull(ts: unknown): string {
	const t = Date.parse(String(ts ?? ""));
	if (!Number.isFinite(t)) return "—";
	const d = new Date(t);
	if (current.time === "local") {
		const off = -d.getTimezoneOffset() / 60;
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} (UTC${off >= 0 ? "+" : ""}${off})`;
	}
	return `${d.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/** The clock in the status bar: "14:05:09Z" or local "21:05:09". */
export function fmtClock(d: Date): string {
	if (current.time === "local")
		return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	return `${d.toISOString().slice(11, 19)}Z`;
}

// ── remembered camera ──────────────────────────────────────────────────
const VIEW_KEY = "thoth.lastView";
export function saveView(c: [number, number], z: number): void {
	if (!current.rememberView) return;
	try {
		localStorage.setItem(VIEW_KEY, JSON.stringify({ c, z }));
	} catch {
		/* keep */
	}
}
export function lastView(): { center: [number, number]; zoom: number } | null {
	if (!current.rememberView) return null;
	try {
		const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
		if (
			Array.isArray(v?.c) &&
			v.c.length === 2 &&
			v.c.every(Number.isFinite) &&
			Number.isFinite(v.z)
		)
			return { center: [v.c[0], v.c[1]], zoom: v.z };
	} catch {
		/* keep */
	}
	return null;
}

/** Browser-kept layout state other than these settings. */
export const LAYOUT_KEYS = [
	"thoth.hidden",
	"thoth.pop",
	"thoth.monWide",
	VIEW_KEY,
] as const;

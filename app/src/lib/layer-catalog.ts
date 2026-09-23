// Layer catalog: the single source of truth for every map layer (global-monitor pattern).
// Symbols: Lucide icon paths (ISC licence). Colors must stay in primitives tokens.
export interface LayerDef {
	color: string;
	svg: string;
	intervalSec: number;
	/** polygon layer: rendered as fill + outline, never clustered */
	polygon?: boolean;
}

export const LAYERS: Record<string, LayerDef> = {
	quakes: {
		color: "#ff5d5d",
		svg: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
		intervalSec: 60,
	},
	flights: {
		color: "#4dd2ff",
		svg: '<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8L4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1l3 2l2 3l1-1v-3l3-2l3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2"/>',
		intervalSec: 900,
	},
	fires: {
		color: "#ff8c1a",
		svg: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0a5 5 0 0 1 1-3a1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
		intervalSec: 600,
	},
	cctv: {
		color: "#b8ff5d",
		svg: '<path d="M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97"/><path d="M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z"/><path d="M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15"/><path d="M2 21v-4"/><path d="M7 9h.01"/>',
		intervalSec: 600,
	},
	weather: {
		color: "#7dd3fc",
		svg: '<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12l-3 5h4l-3 5"/>',
		intervalSec: 300,
	},
	disasters: {
		color: "#c77dff",
		svg: '<path d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"/>',
		intervalSec: 600,
	},
	telegram: {
		color: "#22e0c8",
		svg: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zm7.318-19.539l-10.94 10.939"/>',
		intervalSec: 60,
	},
	spacewx: {
		color: "#f0abfc",
		svg: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
		intervalSec: 300,
	},
	markets: {
		color: "#ffd257",
		svg: '<path d="M16 7h6v6"/><path d="m22 7l-8.5 8.5l-5-5L2 17"/>',
		intervalSec: 600,
	},
	news: {
		color: "#f5f0e1",
		svg: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
		intervalSec: 300,
	},
	gdacs: {
		color: "#ff3d81",
		svg: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
		intervalSec: 600,
	},
	cyber: {
		color: "#39ff88",
		svg: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
		intervalSec: 900,
	},
	oceans: {
		color: "#60a5fa",
		svg: '<path d="M12 2v2"/><path d="M12 9.189V13"/><path d="M19 12V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M19.38 19A11.6 11.6 0 0 0 21 13l-8.188-3.639a2 2 0 0 0-1.624 0L3 13.001a11.6 11.6 0 0 0 2.81 7.76"/><path d="M2 20c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
		intervalSec: 600,
	},
	bases: {
		color: "#d4d4d4",
		svg: '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
		intervalSec: 86400,
	},
	chokepoints: {
		color: "#fbbf24",
		svg: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
		intervalSec: 86400,
	},
	conflicts: {
		color: "#ff6b6b",
		svg: '<path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 0 1 3 5.172V3h2.172a2 2 0 0 1 1.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0 1 18.828 3H21v2.172a2 2 0 0 1-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/>',
		intervalSec: 600,
	},
	radiation: {
		color: "#eab308",
		svg: '<circle cx="12" cy="12" r="2"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14"/><path d="M7.76 16.24a6 6 0 0 1 0-8.49"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
		intervalSec: 900,
	},
	volcanoes: {
		color: "#ea580c",
		svg: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
		intervalSec: 86400,
	},
	drones: {
		color: "#67e8f6",
		svg: '<path d="M10 10 7 7"/><path d="m10 14-3 3"/><path d="m14 10 3-3"/><path d="m14 14 3 3"/><path d="M14.205 4.139a4 4 0 1 1 5.439 5.863"/><path d="M19.637 14a4 4 0 1 1-5.432 5.868"/><path d="M4.367 10a4 4 0 1 1 5.438-5.862"/><path d="M9.795 19.862a4 4 0 1 1-5.429-5.873"/><rect x="10" y="8" width="4" height="8" rx="1"/>',
		intervalSec: 120,
	},
	transit: {
		color: "#5eead4",
		svg: '<rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 9h16M8 21l1.5-4M16 21l-1.5-4"/><circle cx="8.5" cy="13.5" r=".5"/><circle cx="15.5" cy="13.5" r=".5"/>',
		intervalSec: 1800,
	},
	satellites: {
		color: "#c4b5fd",
		svg: '<path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4-4-4-4-4 4"/><path d="m8 12 4 4 4-4"/><path d="m16 8 3 3"/><path d="M9 21a6 6 0 0 0-6-6"/>',
		intervalSec: 600,
	},
	ports: {
		color: "#f59e0b",
		svg: '<circle cx="12" cy="5" r="3"/><line x1="12" x2="12" y1="22" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>',
		intervalSec: 86400,
	},
	airports: {
		color: "#93c5fd",
		svg: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4M9 7h.01M15 7h.01M9 11h.01M15 11h.01"/>',
		intervalSec: 86400,
	},
	datacenters: {
		color: "#818cf8",
		svg: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
		intervalSec: 86400,
	},
	energy: {
		color: "#fb923c",
		svg: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
		intervalSec: 86400,
	},
	theaters: {
		color: "#fb7185",
		svg: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
		intervalSec: 86400,
	},
	signals: {
		color: "#2dd4bf",
		svg: '<path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/>',
		intervalSec: 86400,
	},
	perims: {
		color: "#ff7a1a",
		svg: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5"/>',
		intervalSec: 1800,
		polygon: true,
	},
	airwx: {
		color: "#c084fc",
		svg: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
		intervalSec: 900,
		polygon: true,
	},
	airquality: {
		color: "#86efac",
		svg: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
		intervalSec: 1800,
	},
	metar: {
		color: "#7dd3fc",
		svg: '<path d="M2 22h20"/><path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z"/>',
		intervalSec: 900,
	},
	forecast: {
		color: "#a5b4fc",
		svg: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
		intervalSec: 10800,
	},
	research: {
		color: "#f0abfc",
		svg: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
		intervalSec: 21600,
	},
	health: {
		color: "#fda4af",
		svg: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3.4 1-4.5 2.5C10.9 4 9.3 3 7.5 3A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
		intervalSec: 604800,
	},
	policy: {
		color: "#fcd34d",
		svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
		intervalSec: 86400,
	},
	// NGA navigational warnings: firing/launch boxes, mines, GNSS notices.
	// Mixed geometry — areas, tracklines and single positions (see the
	// point fallback in MapView's polygon branch).
	navwarn: {
		color: "#38bdf8",
		svg: '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/>',
		intervalSec: 1800,
		polygon: true,
	},
	// GNSS interference cells derived from ADS-B navigation accuracy.
	gpsjam: {
		color: "#f472b6",
		svg: '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><path d="M7.11 7.11C5.83 8.39 5 10.1 5 12c0 3.87 3.13 7 7 7 1.9 0 3.61-.83 4.89-2.11"/><path d="M18.71 13.96c.19-.63.29-1.29.29-1.96 0-3.87-3.13-7-7-7-.67 0-1.33.1-1.96.29"/><line x1="2" x2="22" y1="2" y2="22"/>',
		intervalSec: 1800,
		polygon: true,
	},
	// US State Dept travel advisory level per country (capital anchor).
	advisories: {
		color: "#fca5a5",
		svg: '<path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2"/><path d="M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14"/><path d="M10 20h4"/><circle cx="16" cy="20" r="2"/><circle cx="8" cy="20" r="2"/>',
		intervalSec: 21600,
	},
};

export const LAYER_NAMES = Object.keys(LAYERS);

/** Explorer sections: 36 flat rows read as noise; six named groups give
 * the list a scannable shape. Every layer belongs to exactly one group
 * (test/catalog.test.ts); anything unlisted falls into "Other". */
export const LAYER_GROUPS: [string, string[]][] = [
	[
		"Hazards",
		[
			"quakes",
			"volcanoes",
			"fires",
			"perims",
			"disasters",
			"gdacs",
			"radiation",
		],
	],
	[
		"Weather & space",
		[
			"weather",
			"metar",
			"forecast",
			"airwx",
			"airquality",
			"oceans",
			"spacewx",
		],
	],
	[
		"Security",
		[
			"conflicts",
			"drones",
			"navwarn",
			"gpsjam",
			"advisories",
			"telegram",
			"cyber",
			"bases",
			"signals",
			"theaters",
		],
	],
	[
		"Movement",
		["flights", "satellites", "transit", "ports", "airports", "chokepoints"],
	],
	["Infrastructure", ["energy", "datacenters", "cctv"]],
	["Society & markets", ["news", "markets", "policy", "research", "health"]],
];

export function groupedLayers(names: string[]): [string, string[]][] {
	const seen = new Set<string>();
	const out: [string, string[]][] = [];
	for (const [g, ls] of LAYER_GROUPS) {
		const hit = ls.filter((l) => names.includes(l));
		for (const l of hit) seen.add(l);
		if (hit.length) out.push([g, hit]);
	}
	const rest = names.filter((l) => !seen.has(l));
	if (rest.length) out.push(["Other", rest]);
	return out;
}

export const MISSIONS: Record<string, string[]> = {
	crisis: [
		"quakes",
		"gdacs",
		"conflicts",
		"news",
		"drones",
		"fires",
		"telegram",
		"cctv",
		"advisories",
	],
	cyber: ["cyber", "markets", "datacenters", "signals"],
	markets: ["markets", "energy", "chokepoints", "ports", "news"],
	disaster: [
		"quakes",
		"fires",
		"perims",
		"airwx",
		"weather",
		"forecast",
		"metar",
		"gdacs",
		"oceans",
		"volcanoes",
		"disasters",
		"news",
	],
	intel: [
		"bases",
		"airports",
		"datacenters",
		"signals",
		"satellites",
		"cctv",
		"flights",
		"transit",
		"ports",
		"chokepoints",
		"conflicts",
		"research",
		"health",
		"policy",
		"navwarn",
		"gpsjam",
		"advisories",
	],
	wartime: [
		"drones",
		"conflicts",
		"flights",
		"bases",
		"theaters",
		"news",
		"cctv",
		"satellites",
		"airports",
		"navwarn",
		"gpsjam",
	],
};

// All IDs oembed-verified 2026-09-13 as persistent 24/7 live streams
// (event-titled one-offs rot — only evergreen live IDs go here).
export const STREAMS: [string, string, string][] = [
	["France 24 EN", "h3MuIUNCCzI", "Global"],
	["Al Jazeera EN", "gCNeDWCI0vo", "Global"],
	["DW News", "LuKwFajn37U", "Global"],
	["Sky News", "xDWQ3LkccY8", "Global"],
	["CNA 24/7", "XWq5kBlakcQ", "Asia"],
	["TRT World", "Ox9v0q-ohLM", "Global"],
	["Euronews", "pykpO5kQJ98", "Europe"],
	["ABC News Live", "iipR5yUp36o", "Americas"],
	["AlArabiya", "n7eQejkXbnM", "Mideast"],
	["NASA TV", "21X5lGlDOfg", "Space"],
];

/** Mute a layer color toward slate so 29 layers read as one calm system
 * instead of confetti. Hue survives (layer identity), loudness doesn't.
 * Kept for back-compat; the map now renders monochrome (see bakeIcon). */
export function mutedTone(hex: string): string {
	const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return hex;
	const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
	const slate = [167, 173, 192];
	const mix = c.map((v, i) => Math.round(v * 0.38 + slate[i] * 0.62));
	return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

/** Bake a Lucide glyph on a warm-black disc → ImageData map sprite.
 * `ink` is the severity colour (bone for info): layers are told apart by
 * shape, and colour on the map only ever means severity. */
export async function bakeIcon(name: string, ink: string): Promise<ImageData> {
	const L = LAYERS[name];
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48">` +
		`<circle cx="12" cy="12" r="11" fill="rgba(11,11,10,0.86)" stroke="${ink}" stroke-opacity="0.35" stroke-width="0.75"/>` +
		`<g transform="translate(4.2 4.2) scale(0.65)" fill="none" stroke="${ink}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${L.svg}</g></svg>`;
	const img = new Image();
	await new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error(`icon ${name}`));
		img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	});
	const canvas = document.createElement("canvas");
	canvas.width = 48;
	canvas.height = 48;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("no 2d context");
	ctx.drawImage(img, 0, 0, 48, 48);
	return ctx.getImageData(0, 0, 48, 48);
}

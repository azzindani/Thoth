// Content-Security-Policy for every page (set by src/proxy.ts with a fresh
// nonce per request). Scripts run only with the nonce ('strict-dynamic'
// lets those scripts load the app's own chunks), so injected markup cannot
// execute. The third-party origins are the audited allowlist:
//
//   basemaps.cartocdn.com, *.cartocdn.com  basemap style, tiles, glyphs, sprites
//   server.arcgisonline.com                Esri World Imagery (SAT, card imagery)
//   fonts.googleapis.com, fonts.gstatic.com IBM Plex
//   www.youtube.com                        live video tab embeds
//   img-src https:                         CCTV stills come from each feed's own host
//
// A direct API origin (NEXT_PUBLIC_THOTH_API, normally empty) is added to
// connect-src. Styles allow 'unsafe-inline': React style props and the map
// popups set inline styles, and a style cannot run code. APP_CSP=report
// sends the same policy as Report-Only; APP_CSP=off drops it (both for
// diagnosis only).

export type CspMode = "enforce" | "report" | "off";

export function cspMode(v = process.env.APP_CSP): CspMode {
	return v === "off" || v === "report" ? v : "enforce";
}

export function cspHeaderName(mode: CspMode): string {
	return mode === "report"
		? "Content-Security-Policy-Report-Only"
		: "Content-Security-Policy";
}

/** The origin of a direct API URL (NEXT_PUBLIC_THOTH_API), or "". */
function originOf(url: string | undefined): string {
	try {
		return url ? new URL(url).origin : "";
	} catch {
		return "";
	}
}

export function buildCsp(nonce: string, dev = false, apiUrl?: string): string {
	const carto = "https://basemaps.cartocdn.com https://*.cartocdn.com";
	const esri = "https://server.arcgisonline.com";
	const api = originOf(apiUrl);
	const directives: [string, string][] = [
		["default-src", "'self'"],
		[
			"script-src",
			`'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
		],
		["style-src", "'self' 'unsafe-inline' https://fonts.googleapis.com"],
		["font-src", "'self' data: https://fonts.gstatic.com"],
		["img-src", "'self' data: blob: https:"],
		[
			"connect-src",
			`'self' ${carto} ${esri}${api ? ` ${api}` : ""}${dev ? " ws: wss:" : ""}`,
		],
		["worker-src", "'self' blob:"],
		["child-src", "'self' blob:"],
		["frame-src", "https://www.youtube.com"],
		["media-src", "'self' blob:"],
		["manifest-src", "'self'"],
		["object-src", "'none'"],
		["base-uri", "'self'"],
		["form-action", "'self'"],
		["frame-ancestors", "'none'"],
	];
	return directives.map(([k, v]) => `${k} ${v}`).join("; ");
}

/** 128-bit random nonce, base64. */
export function makeNonce(): string {
	const b = new Uint8Array(16);
	crypto.getRandomValues(b);
	return btoa(String.fromCharCode(...b));
}

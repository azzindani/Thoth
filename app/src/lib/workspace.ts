// Saved workspaces (ROADMAP P5): what you were looking at — hidden layers,
// camera, mission, severity filter, map mode, open tab and panel layout —
// named and kept in this browser, and shareable as a link (#ws=…, the
// workspace itself in the URL: no server, nothing to leak).

export type Workspace = {
	v: 1;
	name: string;
	hidden: string[];
	camera: { c: [number, number]; z: number; b?: number; p?: number };
	mission: string;
	sev: string;
	mode: string;
	globe: boolean;
	tab: string;
	panels: { expl: boolean; insp: boolean; dock: boolean };
};

const KEY = "thoth.workspaces";
const MAX = 30;

function b64url(s: string): string {
	return btoa(unescape(encodeURIComponent(s)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}
function unb64url(s: string): string {
	const pad = s.replace(/-/g, "+").replace(/_/g, "/");
	return decodeURIComponent(
		escape(atob(pad + "=".repeat((4 - (pad.length % 4)) % 4))),
	);
}

/** Shape check for anything read back from a URL or storage. */
export function isWorkspace(x: unknown): x is Workspace {
	const w = x as Workspace;
	return (
		!!w &&
		w.v === 1 &&
		typeof w.name === "string" &&
		Array.isArray(w.hidden) &&
		w.hidden.every((h) => typeof h === "string") &&
		Array.isArray(w.camera?.c) &&
		w.camera.c.length === 2 &&
		w.camera.c.every(Number.isFinite) &&
		Number.isFinite(w.camera.z) &&
		typeof w.mission === "string" &&
		typeof w.sev === "string" &&
		typeof w.mode === "string" &&
		typeof w.globe === "boolean" &&
		typeof w.tab === "string" &&
		typeof w.panels?.expl === "boolean"
	);
}

export function encodeWorkspace(w: Workspace): string {
	return b64url(JSON.stringify(w));
}
export function decodeWorkspace(s: string): Workspace | null {
	try {
		const w = JSON.parse(unb64url(s));
		return isWorkspace(w) ? w : null;
	} catch {
		return null;
	}
}

/** Link that opens this app on the workspace. */
export function workspaceLink(w: Workspace): string {
	const u = new URL(window.location.href);
	u.hash = `ws=${encodeWorkspace(w)}`;
	return u.toString();
}
/** The workspace in the current URL, if any. */
export function workspaceFromHash(
	hash = window.location.hash,
): Workspace | null {
	const m = hash.match(/[#&]ws=([A-Za-z0-9_-]+)/);
	return m ? decodeWorkspace(m[1]) : null;
}

export function listWorkspaces(): Workspace[] {
	try {
		const xs = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		return Array.isArray(xs) ? xs.filter(isWorkspace) : [];
	} catch {
		return [];
	}
}
/** Save (replacing one with the same name), newest first. */
export function saveWorkspace(w: Workspace): Workspace[] {
	const xs = [w, ...listWorkspaces().filter((x) => x.name !== w.name)].slice(
		0,
		MAX,
	);
	try {
		localStorage.setItem(KEY, JSON.stringify(xs));
	} catch {
		/* not persisted; the link still works */
	}
	return xs;
}
export function deleteWorkspace(name: string): Workspace[] {
	const xs = listWorkspaces().filter((x) => x.name !== name);
	try {
		localStorage.setItem(KEY, JSON.stringify(xs));
	} catch {
		/* keep */
	}
	return xs;
}

// Saved workspaces (ROADMAP P5): what you were looking at — hidden layers,
// camera, mission, severity filter, map mode, open tab and panel layout —
// named and kept in this browser, and shareable as a link (#ws=…, the
// workspace itself in the URL: no server, nothing to leak).

/** A popped-out object window (PopWindows.tsx), as saved. */
export type SavedPop = {
	key: string;
	p: Record<string, string | number>;
	anchor: [number, number] | null;
	x: number;
	y: number;
	min: boolean;
	z: number;
};
export const MAX_POPS = 4;

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
	/** open pop-out windows (absent in workspaces saved before 0.2) */
	pops?: SavedPop[];
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

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Shape check for one saved pop-out window. */
export function isSavedPop(x: unknown): x is SavedPop {
	const w = x as SavedPop;
	return (
		!!w &&
		typeof w.key === "string" &&
		w.key.length <= 200 &&
		!!w.p &&
		typeof w.p === "object" &&
		!Array.isArray(w.p) &&
		typeof w.p.id === "string" &&
		Object.values(w.p).every((v) => typeof v === "string" || num(v)) &&
		(w.anchor === null ||
			(Array.isArray(w.anchor) &&
				w.anchor.length === 2 &&
				w.anchor.every(num))) &&
		num(w.x) &&
		num(w.y) &&
		typeof w.min === "boolean" &&
		num(w.z)
	);
}

/** A window as it goes into a workspace: long text trimmed (links stay
 * short), and only http(s) links and stills, whatever the source said. */
export function packPop(w: SavedPop): SavedPop {
	const p: Record<string, string | number> = {};
	for (const [k, v] of Object.entries(w.p)) {
		if (typeof v === "string") {
			if ((k === "url" || k === "img") && v && !/^https?:\/\//.test(v))
				continue;
			p[k] = v.slice(0, k === "facts" ? 2000 : 400);
		} else if (num(v)) p[k] = v;
	}
	return {
		key: w.key,
		p,
		anchor: w.anchor,
		x: Math.round(w.x),
		y: Math.round(w.y),
		min: w.min,
		z: w.z,
	};
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
		typeof w.panels?.expl === "boolean" &&
		(w.pops === undefined ||
			(Array.isArray(w.pops) &&
				w.pops.length <= MAX_POPS &&
				w.pops.every(isSavedPop)))
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

import { timingSafeEqual } from "node:crypto";

// Pure auth helpers for src/proxy.ts (kept apart so vitest can cover them).

/** Constant-time string compare; length mismatch still returns false. */
export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Checks an `Authorization: Basic …` header against "user:pass".
 * Empty expected credentials mean the gate is off (returns true).
 */
export function basicAuthOk(
	header: string | null,
	expected: string | undefined,
): boolean {
	if (!expected) return true;
	if (!header?.toLowerCase().startsWith("basic ")) return false;
	let decoded: string;
	try {
		decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
	} catch {
		return false;
	}
	return safeEqual(decoded, expected);
}

/** Paths that must stay reachable without credentials (probes, static chunks). */
export function isPublicPath(pathname: string): boolean {
	return (
		pathname === "/healthz" ||
		pathname.startsWith("/_next/static/") ||
		// Vendored maplibre worker (public library code; the map breaks
		// without it, and worker fetches must not depend on auth caching).
		pathname.startsWith("/maplibre/") ||
		pathname === "/favicon.ico"
	);
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const isMutating = (method: string) =>
	MUTATING.has(method.toUpperCase());

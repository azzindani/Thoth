import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { signJwt, verifyJwt } from "./jwt";

// Pure auth helpers for src/proxy.ts (kept apart so vitest can cover them).
//
// Access model ported from Folio's editor gate (src/editor/editor-auth.ts):
// one operator key, no username/password. Present it once as ?token=… and
// the app swaps it for a durable HttpOnly session cookie (a stateless HS256
// JWT), then redirects to the same URL without the token so the secret
// leaves the address bar and history. The cookie slides on every page load.
//
// Accepted credentials (Authorization: Bearer, ?token=, or the cookie):
//   APP_ACCESS_KEY   the operator key; also the signing secret by default
//   APP_TOKENS       "name:token,name2:token2" — extra long-lived keys
//   APP_TOKENS_FILE  JSON {"name": "token"} — same, re-read on every check so
//                    a key can be added or revoked without a restart
//   a session JWT signed with APP_JWT_SECRET (falls back to APP_ACCESS_KEY)
// None of them set = the gate is off (local dev, CI).

type Env = Record<string, string | undefined>;

export const SESSION_COOKIE = "thoth_session";
const DEFAULT_SESSION_TTL_S = 30 * 24 * 60 * 60;

/** Constant-time string compare; length mismatch still returns false. */
export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Every long-lived key from APP_TOKENS_FILE, APP_TOKENS and APP_ACCESS_KEY. */
export function staticTokens(env: Env = process.env): string[] {
	const out: string[] = [];
	if (env.APP_TOKENS_FILE) {
		try {
			const parsed = JSON.parse(readFileSync(env.APP_TOKENS_FILE, "utf8"));
			for (const v of Object.values(parsed ?? {}))
				if (typeof v === "string" && v) out.push(v);
		} catch {
			// Missing or invalid file contributes no keys; the others still work.
		}
	}
	for (const pair of (env.APP_TOKENS ?? "").split(",")) {
		const value = pair.split(":").slice(1).join(":").trim();
		if (value) out.push(value);
	}
	if (env.APP_ACCESS_KEY) out.push(env.APP_ACCESS_KEY);
	return out;
}

/** HS256 secret for session cookies, or null when no auth is configured. */
export function jwtSecret(env: Env = process.env): string | null {
	return env.APP_JWT_SECRET || env.APP_ACCESS_KEY || null;
}

/** False → the gate is off and the app serves openly. */
export function authConfigured(env: Env = process.env): boolean {
	return !!jwtSecret(env) || staticTokens(env).length > 0;
}

/** A static key, the raw signing secret, or an unexpired session JWT. */
export function isValidToken(
	token: string,
	env: Env = process.env,
	nowSeconds?: number,
): boolean {
	if (!token) return false;
	if (staticTokens(env).some((t) => safeEqual(token, t))) return true;
	const secret = jwtSecret(env);
	if (!secret) return false;
	return safeEqual(token, secret) || verifyJwt(token, secret, nowSeconds).ok;
}

export function sessionTtlSeconds(env: Env = process.env): number {
	const ms = Number.parseInt(env.APP_SESSION_TTL_MS ?? "", 10);
	return Number.isFinite(ms) && ms > 0
		? Math.floor(ms / 1000)
		: DEFAULT_SESSION_TTL_S;
}

/** A fresh session JWT for the cookie; empty when no secret (open mode). */
export function mintSessionToken(
	env: Env = process.env,
	nowSeconds?: number,
): string {
	const secret = jwtSecret(env);
	return secret
		? signJwt(
				{ sub: "operator", kind: "session" },
				secret,
				sessionTtlSeconds(env),
				nowSeconds,
			)
		: "";
}

/** Set-Cookie value carrying `token` for one session window. */
export function sessionCookie(
	token: string,
	secure: boolean,
	env: Env = process.env,
): string {
	return [
		`${SESSION_COOKIE}=${encodeURIComponent(token)}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${sessionTtlSeconds(env)}`,
		...(secure ? ["Secure"] : []),
	].join("; ");
}

/** Bearer header, ?token= and cookie, in that order, empties dropped. */
export function presentedTokens(
	authorization: string | null,
	query: string | null,
	cookie: string | undefined,
): string[] {
	const bearer = authorization?.toLowerCase().startsWith("bearer ")
		? authorization.slice(7).trim()
		: "";
	return [bearer, query ?? "", cookie ?? ""].filter(Boolean);
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

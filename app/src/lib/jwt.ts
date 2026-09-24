import { createHmac, timingSafeEqual } from "node:crypto";

// Dependency-free HS256 JWT, ported from Folio (src/mcp/jwt.ts). Session
// tokens are signed with one shared secret and validated STATELESSLY —
// signature + `exp`, no token store to consult or grow. Pure: every function
// takes the secret as an argument, no IO, no module-level side effects.

export interface JwtPayload {
	sub?: string;
	/** Issued-at, epoch seconds. */
	iat?: number;
	/** Expiry, epoch seconds; verification fails once now >= exp. */
	exp?: number;
	[claim: string]: unknown;
}

export type JwtResult =
	| { ok: true; payload: JwtPayload }
	| {
			ok: false;
			reason: "malformed" | "bad_alg" | "bad_signature" | "expired";
	  };

const b64url = (buf: Buffer) =>
	buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

function b64urlDecode(s: string): Buffer {
	const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
	return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** Decoded JSON object, or null for anything else ("null", numbers, junk). */
function decodeObject(part: string): Record<string, unknown> | null {
	try {
		const v: unknown = JSON.parse(b64urlDecode(part).toString("utf8"));
		return v && typeof v === "object" && !Array.isArray(v)
			? (v as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

const hmac = (input: string, secret: string) =>
	createHmac("sha256", secret).update(input).digest();

/** Sign `claims`; `exp = now + ttlSeconds` unless given (ttl <= 0 → no exp). */
export function signJwt(
	claims: JwtPayload,
	secret: string,
	ttlSeconds: number,
	nowSeconds = Math.floor(Date.now() / 1000),
): string {
	const payload: JwtPayload = { iat: nowSeconds, ...claims };
	if (ttlSeconds > 0 && payload.exp === undefined)
		payload.exp = nowSeconds + ttlSeconds;
	const header = b64url(
		Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })),
	);
	const body = b64url(Buffer.from(JSON.stringify(payload)));
	return `${header}.${body}.${b64url(hmac(`${header}.${body}`, secret))}`;
}

/** Structure, algorithm, constant-time signature, then `exp`. */
export function verifyJwt(
	token: string,
	secret: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): JwtResult {
	const parts = token.split(".");
	if (parts.length !== 3) return { ok: false, reason: "malformed" };
	const [header, body, sig] = parts as [string, string, string];

	const head = decodeObject(header);
	if (!head) return { ok: false, reason: "malformed" };
	if (head.alg !== "HS256") return { ok: false, reason: "bad_alg" };

	const a = Buffer.from(sig);
	const b = Buffer.from(b64url(hmac(`${header}.${body}`, secret)));
	if (a.length !== b.length || !timingSafeEqual(a, b))
		return { ok: false, reason: "bad_signature" };

	const payload = decodeObject(body) as JwtPayload | null;
	if (!payload) return { ok: false, reason: "malformed" };
	if (typeof payload.exp === "number" && nowSeconds >= payload.exp)
		return { ok: false, reason: "expired" };
	return { ok: true, payload };
}

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	authConfigured,
	isMutating,
	isPublicPath,
	isValidToken,
	jwtSecret,
	mintSessionToken,
	presentedTokens,
	safeEqual,
	sessionCookie,
	sessionTtlSeconds,
	staticTokens,
} from "../src/lib/auth";
import { signJwt, verifyJwt } from "../src/lib/jwt";

const KEY = { APP_ACCESS_KEY: "operator-key" };

describe("jwt", () => {
	it("round-trips claims and sets exp from the ttl", () => {
		const t = signJwt({ sub: "a" }, "s", 60, 1000);
		const r = verifyJwt(t, "s", 1030);
		expect(r).toEqual({
			ok: true,
			payload: { sub: "a", iat: 1000, exp: 1060 },
		});
	});
	it("rejects expiry, a wrong secret, tampering and junk", () => {
		const t = signJwt({ sub: "a" }, "s", 60, 1000);
		expect(verifyJwt(t, "s", 1060)).toEqual({ ok: false, reason: "expired" });
		expect(verifyJwt(t, "other", 1000)).toMatchObject({
			reason: "bad_signature",
		});
		const [h, , sig] = t.split(".");
		const forged = `${h}.${Buffer.from('{"sub":"b"}').toString("base64url")}.${sig}`;
		expect(verifyJwt(forged, "s", 1000)).toMatchObject({
			reason: "bad_signature",
		});
		expect(verifyJwt("a.b", "s")).toMatchObject({ reason: "malformed" });
	});
	it("treats a non-object header or payload as malformed, not a crash", () => {
		const nul = Buffer.from("null").toString("base64url");
		expect(verifyJwt(`${nul}.${nul}.x`, "s")).toMatchObject({
			reason: "malformed",
		});
	});
	it("refuses algorithms other than HS256", () => {
		const none = Buffer.from('{"alg":"none"}').toString("base64url");
		expect(verifyJwt(`${none}.e30.`, "s")).toMatchObject({
			reason: "bad_alg",
		});
	});
});

describe("token model", () => {
	it("is open when nothing is configured", () => {
		expect(authConfigured({})).toBe(false);
		expect(isValidToken("anything", {})).toBe(false);
		expect(mintSessionToken({})).toBe("");
	});
	it("collects keys from the file, the inline list and the single key", () => {
		const dir = mkdtempSync(join(tmpdir(), "thoth-auth-"));
		const file = join(dir, "tokens.json");
		writeFileSync(file, JSON.stringify({ phone: "k-file", bad: 7 }));
		expect(
			staticTokens({
				APP_TOKENS_FILE: file,
				APP_TOKENS: "laptop:k-inline,ci:a:b, broken",
				APP_ACCESS_KEY: "k-single",
			}),
		).toEqual(["k-file", "k-inline", "a:b", "k-single"]);
		expect(staticTokens({ APP_TOKENS_FILE: join(dir, "missing") })).toEqual([]);
		expect(authConfigured({ APP_TOKENS: "x:y" })).toBe(true);
	});
	it("prefers a dedicated signing secret", () => {
		expect(jwtSecret(KEY)).toBe("operator-key");
		expect(jwtSecret({ ...KEY, APP_JWT_SECRET: "sig" })).toBe("sig");
	});
	it("accepts static keys and live session tokens only", () => {
		expect(isValidToken("operator-key", KEY)).toBe(true);
		expect(isValidToken("operator-ke", KEY)).toBe(false);
		expect(isValidToken("", KEY)).toBe(false);
		const now = 1_000_000;
		const session = mintSessionToken(KEY, now);
		expect(isValidToken(session, KEY, now + 60)).toBe(true);
		expect(isValidToken(session, KEY, now + sessionTtlSeconds(KEY))).toBe(
			false,
		);
		expect(isValidToken(session, { APP_ACCESS_KEY: "rotated" }, now)).toBe(
			false,
		);
	});
	it("honours APP_SESSION_TTL_MS and ignores junk", () => {
		expect(sessionTtlSeconds({})).toBe(30 * 24 * 60 * 60);
		expect(sessionTtlSeconds({ APP_SESSION_TTL_MS: "3600000" })).toBe(3600);
		expect(sessionTtlSeconds({ APP_SESSION_TTL_MS: "soon" })).toBe(
			30 * 24 * 60 * 60,
		);
	});
	it("builds an HttpOnly cookie, Secure only over https", () => {
		const c = sessionCookie("a b", false, {});
		expect(c).toBe(
			"thoth_session=a%20b; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
		);
		expect(sessionCookie("t", true, {})).toMatch(/; Secure$/);
	});
	it("reads Bearer, then ?token=, then the cookie", () => {
		expect(presentedTokens("Bearer  b ", "q", "c")).toEqual(["b", "q", "c"]);
		expect(presentedTokens("bearer b", null, undefined)).toEqual(["b"]);
		expect(presentedTokens("Basic xyz", "", "c")).toEqual(["c"]);
		expect(presentedTokens(null, null, undefined)).toEqual([]);
	});
});

describe("helpers", () => {
	it("safeEqual compares exactly", () => {
		expect(safeEqual("abc", "abc")).toBe(true);
		expect(safeEqual("abc", "abd")).toBe(false);
		expect(safeEqual("abc", "abcd")).toBe(false);
	});
	it("keeps probes and build assets public, nothing else", () => {
		expect(isPublicPath("/healthz")).toBe(true);
		expect(isPublicPath("/_next/static/chunks/a.js")).toBe(true);
		expect(isPublicPath("/maplibre/maplibre-gl-worker.mjs")).toBe(true);
		expect(isPublicPath("/")).toBe(false);
		expect(isPublicPath("/api/notes")).toBe(false);
		expect(isPublicPath("/healthz/../api")).toBe(false);
	});
	it("classifies mutating methods", () => {
		for (const m of ["POST", "put", "PATCH", "DELETE"])
			expect(isMutating(m)).toBe(true);
		for (const m of ["GET", "HEAD", "OPTIONS"])
			expect(isMutating(m)).toBe(false);
	});
});

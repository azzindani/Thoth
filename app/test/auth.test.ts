import { describe, expect, it } from "vitest";
import {
	basicAuthOk,
	isMutating,
	isPublicPath,
	safeEqual,
} from "../src/lib/auth";

const basic = (s: string) => `Basic ${Buffer.from(s).toString("base64")}`;

describe("basicAuthOk", () => {
	it("is open when no credentials are configured", () => {
		expect(basicAuthOk(null, undefined)).toBe(true);
		expect(basicAuthOk(null, "")).toBe(true);
	});
	it("accepts exactly the configured user:pass", () => {
		expect(basicAuthOk(basic("ops:hunter2"), "ops:hunter2")).toBe(true);
		expect(basicAuthOk(basic("ops:hunter2").toLowerCase(), "ops:hunter2")).toBe(
			false,
		);
	});
	it("rejects missing, wrong, prefix and non-basic credentials", () => {
		expect(basicAuthOk(null, "ops:hunter2")).toBe(false);
		expect(basicAuthOk(basic("ops:hunter"), "ops:hunter2")).toBe(false);
		expect(basicAuthOk(basic("ops:hunter22"), "ops:hunter2")).toBe(false);
		expect(basicAuthOk("Bearer ops:hunter2", "ops:hunter2")).toBe(false);
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

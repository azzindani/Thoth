import { describe, expect, it } from "vitest";
import { buildCsp, cspHeaderName, cspMode, makeNonce } from "../src/lib/csp";

const directive = (csp: string, name: string) =>
	csp
		.split("; ")
		.find((d) => d.startsWith(`${name} `))
		?.slice(name.length + 1);

describe("content security policy", () => {
	it("runs scripts only with the request's nonce", () => {
		const csp = buildCsp("abc");
		expect(directive(csp, "script-src")).toBe(
			"'self' 'nonce-abc' 'strict-dynamic'",
		);
		expect(csp).not.toContain("unsafe-eval");
	});

	it("allows eval only in development (React dev tooling)", () => {
		expect(directive(buildCsp("n", true), "script-src")).toContain(
			"'unsafe-eval'",
		);
	});

	it("keeps the lockdown directives", () => {
		const csp = buildCsp("n");
		expect(directive(csp, "object-src")).toBe("'none'");
		expect(directive(csp, "frame-ancestors")).toBe("'none'");
		expect(directive(csp, "base-uri")).toBe("'self'");
		expect(directive(csp, "form-action")).toBe("'self'");
	});

	it("allows the audited third-party origins", () => {
		const csp = buildCsp("n");
		expect(directive(csp, "connect-src")).toContain(
			"https://basemaps.cartocdn.com",
		);
		expect(directive(csp, "connect-src")).toContain(
			"https://server.arcgisonline.com",
		);
		expect(directive(csp, "font-src")).toContain("https://fonts.gstatic.com");
		expect(directive(csp, "frame-src")).toBe("https://www.youtube.com");
	});

	it("adds a direct API origin to connect-src", () => {
		expect(
			directive(
				buildCsp("n", false, "https://api.example.org/x"),
				"connect-src",
			),
		).toContain("https://api.example.org");
		expect(buildCsp("n", false, "not a url")).toBe(buildCsp("n"));
		expect(buildCsp("n", false, "")).toBe(buildCsp("n"));
	});

	it("reads APP_CSP, defaulting to enforce", () => {
		expect(cspMode(undefined)).toBe("enforce");
		expect(cspMode("bogus")).toBe("enforce");
		expect(cspMode("report")).toBe("report");
		expect(cspMode("off")).toBe("off");
		expect(cspHeaderName("report")).toBe("Content-Security-Policy-Report-Only");
		expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
	});

	it("mints a fresh 128-bit nonce each time", () => {
		const a = makeNonce();
		expect(atob(a)).toHaveLength(16);
		expect(makeNonce()).not.toBe(a);
	});
});

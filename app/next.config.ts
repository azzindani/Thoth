import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// The release version, shown in the changelog dialog and Settings. The
// app and backend share one version (CONTRIBUTING.md › Releasing).
const VERSION: string =
	JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
		.version ?? "0.0.0";

// Baseline browser hardening for every page. The Content-Security-Policy
// needs a per-request nonce, so src/proxy.ts sets it (lib/csp.ts).
const SECURITY_HEADERS = [
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "X-Frame-Options", value: "DENY" },
	{
		key: "Permissions-Policy",
		value: "camera=(), microphone=(), geolocation=(), payment=()",
	},
];

const nextConfig: NextConfig = {
	reactStrictMode: true,
	poweredByHeader: false,
	// Self-contained server bundle for the Docker image (no full node_modules).
	output: "standalone",
	env: {
		// Empty = same-origin: the browser calls /api/* on this host and the
		// rewrite below proxies to the backend. Keeps one tunnel working and
		// avoids https→http mixed-content blocks. Set explicitly only when the
		// browser can reach the backend directly (e.g. local dev without proxy).
		NEXT_PUBLIC_THOTH_API: process.env.NEXT_PUBLIC_THOTH_API ?? "",
		NEXT_PUBLIC_THOTH_VERSION: VERSION,
	},
	async headers() {
		return [{ source: "/:path*", headers: SECURITY_HEADERS }];
	},
	async rewrites() {
		return [
			{
				source: "/api/:path*",
				destination: `${process.env.THOTH_API_INTERNAL ?? "http://localhost:4000"}/api/:path*`,
			},
		];
	},
};
export default nextConfig;

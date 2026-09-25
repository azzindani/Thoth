import type { NextConfig } from "next";

// Baseline browser hardening for every page. No CSP yet: the terminal pulls
// map tiles, fonts and 24/7 video embeds from several third-party origins —
// an enforced policy needs that allowlist audited first (SECURITY.md, known limitations).
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

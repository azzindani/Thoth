import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	env: {
		// Empty = same-origin: the browser calls /api/* on this host and the
		// rewrite below proxies to the backend. Keeps one tunnel working and
		// avoids https→http mixed-content blocks. Set explicitly only when the
		// browser can reach the backend directly (e.g. local dev without proxy).
		NEXT_PUBLIC_THOTH_API: process.env.NEXT_PUBLIC_THOTH_API ?? "",
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

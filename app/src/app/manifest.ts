import type { MetadataRoute } from "next";

// Installable app (Chrome/Edge/Android "Install", iOS "Add to Home
// Screen"). Served at /manifest.webmanifest, outside the access gate:
// browsers fetch manifests without cookies.
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "THOTH — live intelligence terminal",
		short_name: "Thoth",
		description:
			"Live OSINT layers, alerts, watches and on-demand lookups on a globe.",
		id: "/",
		start_url: "/",
		scope: "/",
		display: "standalone",
		orientation: "any",
		background_color: "#0b0b0a",
		theme_color: "#0b0b0a",
		categories: ["news", "utilities"],
		icons: [
			{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
			{
				src: "/icons/maskable-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		],
	};
}

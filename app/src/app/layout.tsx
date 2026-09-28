import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { LAYOUT_K, TEXT_K } from "../lib/settings";

// Applies the saved theme and size levels before first paint (no flash
// of the default look); lib/settings.ts applies the full set once the app mounts.
const EARLY = `try{var s=JSON.parse(localStorage.getItem("thoth.settings")||"null")||{};var L=${JSON.stringify(LAYOUT_K)},T=${JSON.stringify(TEXT_K)},h=document.documentElement;var th=s.theme==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"paper":"dark"):s.theme==="paper"?"paper":"dark";h.dataset.theme=th;if(L[s.layout])h.style.setProperty("--lk",L[s.layout]);if(T[s.text])h.style.setProperty("--fk",T[s.text]);if(s.solid)h.classList.add("solid-panels");if(s.motion==="reduce")h.classList.add("reduce-motion")}catch(e){}`;

export const metadata: Metadata = {
	title: "THOTH — live intelligence terminal",
	description:
		"Global intelligence terminal: live OSINT layers, dossier, sanctions, OSINT lookups.",
	icons: { apple: "/icons/apple-touch-icon.png" },
	appleWebApp: { capable: true, title: "Thoth", statusBarStyle: "black" },
};

export const viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
	themeColor: "#0b0b0a",
};

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	// Per-request CSP nonce from src/proxy.ts (reading it renders pages on
	// demand, which a nonce requires).
	const nonce = (await headers()).get("x-nonce") ?? undefined;
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script nonce={nonce} dangerouslySetInnerHTML={{ __html: EARLY }} />
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link
					rel="preconnect"
					href="https://fonts.gstatic.com"
					crossOrigin="anonymous"
				/>
				<link
					href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
					rel="stylesheet"
				/>
			</head>
			<body>{children}</body>
		</html>
	);
}

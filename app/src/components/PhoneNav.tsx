"use client";
// Phone navigation: one bar along the bottom edge, always reachable above
// the sheets. Every tool lives one tap away (the audit found phones could
// reach only the layers sheet, the status pill and a command line).
// Active state follows the sheets themselves (class "open"), so a sheet
// opened by a command or a swipe-close still lights the right item.
import { useEffect, useState } from "react";

export type NavKey = "layers" | "intel" | "search" | "alerts" | "more";

const ICON: Record<NavKey, string> = {
	layers:
		'<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
	intel:
		'<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
	search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
	alerts:
		'<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
	more: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
};
const LABEL: Record<NavKey, string> = {
	layers: "Layers",
	intel: "Intel",
	search: "Search",
	alerts: "Alerts",
	more: "More",
};

function useOpen(id: string): boolean {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		const el = document.getElementById(id);
		if (!el) return;
		const read = () => setOpen(el.classList.contains("open"));
		read();
		const mo = new MutationObserver(read);
		mo.observe(el, { attributes: true, attributeFilter: ["class"] });
		return () => mo.disconnect();
	}, [id]);
	return open;
}

export default function PhoneNav({
	onPick,
	tab,
	searchOpen,
	moreOpen,
	alertBadge,
}: {
	onPick: (k: NavKey) => void;
	/** inspector's current tab: "alerts" lights Alerts instead of Intel */
	tab: string;
	searchOpen: boolean;
	moreOpen: boolean;
	alertBadge: number;
}) {
	const layers = useOpen("explorer");
	const insp = useOpen("inspector");
	const active: Record<NavKey, boolean> = {
		layers,
		intel: insp && tab !== "alerts",
		alerts: insp && tab === "alerts",
		search: searchOpen,
		more: moreOpen,
	};
	return (
		<nav className="phone-nav" id="phone-nav" aria-label="main">
			{(Object.keys(ICON) as NavKey[]).map((k) => (
				<button
					key={k}
					type="button"
					id={`nav-${k}`}
					className={`nav-btn${active[k] ? " on" : ""}`}
					aria-pressed={active[k]}
					aria-label={
						k === "alerts" && alertBadge > 0
							? `${LABEL[k]}, ${alertBadge} new`
							: LABEL[k]
					}
					onClick={() => onPick(k)}
				>
					<svg
						viewBox="0 0 24 24"
						aria-hidden="true"
						dangerouslySetInnerHTML={{ __html: ICON[k] }}
					/>
					<span>{LABEL[k]}</span>
					{k === "alerts" && alertBadge > 0 && (
						<b className="nav-badge" aria-hidden="true">
							{alertBadge > 99 ? "99+" : alertBadge}
						</b>
					)}
				</button>
			))}
		</nav>
	);
}

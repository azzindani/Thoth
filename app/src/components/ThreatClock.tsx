"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

// ThreatClock — threat readout driven by the live brief: DEFCON level plus
// a five-cell meter; the title carries the top critical. (Replaced the
// ironsight dial 2026-09-23: a spinning sweep is decoration, not data.)
export default function ThreatClock() {
	const [defcon, setDefcon] = useState(5);
	const [top, setTop] = useState("no criticals");
	useEffect(() => {
		let stop = false;
		async function refresh() {
			try {
				const b = (await api.brief()) as {
					critical?: { title?: string; id: string }[];
				};
				if (stop) return;
				const crit = b.critical ?? [];
				setDefcon(
					crit.length >= 30
						? 1
						: crit.length >= 15
							? 2
							: crit.length >= 5
								? 3
								: crit.length >= 1
									? 4
									: 5,
				);
				setTop(crit[0]?.title ?? crit[0]?.id ?? "no criticals");
			} catch {
				/* keep */
			}
		}
		refresh();
		const t = setInterval(refresh, 120000);
		return () => {
			stop = true;
			clearInterval(t);
		};
	}, []);
	// Only an elevated state earns colour (critical ≤2, watch 3); 4–5 stay
	// neutral — "healthy is quiet" (docs/development/ui-design-system.md §0).
	const col =
		defcon <= 2 ? "var(--red)" : defcon === 3 ? "var(--amber)" : "var(--txt2)";
	// Five cells, DEFCON 5 → 1 left to right; cells up to the level light up.
	const lit = 6 - defcon;
	return (
		<div className="threatclock" title={`DEFCON ${defcon} · ${top}`}>
			<span className="tc-label">Threat</span>
			<span className="tc-num" style={{ color: col }}>
				DEFCON {defcon}
			</span>
			<span className="tc-meter" role="img" aria-label={`DEFCON ${defcon}`}>
				{[1, 2, 3, 4, 5].map((i) => (
					<i key={i} style={i <= lit ? { background: col } : undefined} />
				))}
			</span>
		</div>
	);
}

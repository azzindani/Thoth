"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

// ThreatClock — ironsight dial driven by the live brief.
// DEFCON ring color + rotating sweep; title shows the top critical.
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
	const col =
		defcon <= 2 ? "var(--red)" : defcon === 3 ? "var(--amber)" : "var(--grn)";
	const ticks = Array.from({ length: 12 }, (_, i) => ({
		a: (i * Math.PI) / 6,
		i,
	}));
	return (
		<div className="threatclock" title={`DEFCON ${defcon} · ${top}`}>
			<svg width="52" height="52" viewBox="0 0 52 52" role="img">
				<title>{`DEFCON ${defcon}`}</title>
				<circle
					cx="26"
					cy="26"
					r="23"
					fill="none"
					stroke={col}
					strokeWidth="2.5"
				/>
				{ticks.map(({ a, i }) => (
					<line
						key={`tick-${i}`}
						x1={26 + 19 * Math.cos(a)}
						y1={26 + 19 * Math.sin(a)}
						x2={26 + 23 * Math.cos(a)}
						y2={26 + 23 * Math.sin(a)}
						stroke={col}
						strokeWidth={i % 3 === 0 ? 2 : 1}
						opacity="0.7"
					/>
				))}
				<line
					x1="26"
					y1="26"
					x2="26"
					y2="8"
					stroke={col}
					strokeWidth="1.5"
					opacity="0.9"
					className="tc-sweep"
				/>
				<circle cx="26" cy="26" r="2.5" fill={col} />
				<text
					x="26"
					y="34"
					textAnchor="middle"
					fill={col}
					fontSize="13"
					fontWeight="700"
				>
					{defcon}
				</text>
			</svg>
		</div>
	);
}

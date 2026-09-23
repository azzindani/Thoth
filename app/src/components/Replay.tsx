"use client";
// Time replay (ROADMAP P5): scrub or play the last 72 hours on the map.
// The clock filters every event layer to a trailing window (setReplay in
// MapView) — nothing is refetched while scrubbing. Leaving the replay
// restores the live picture.
import type * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { setReplay } from "./MapView";

const SPAN_MS = 72 * 3600e3;
const STEP_MS = 15 * 60e3;
const WINDOWS: [string, number][] = [
	["1h", 3600e3],
	["6h", 6 * 3600e3],
	["24h", 24 * 3600e3],
];
const SPEEDS: [string, number][] = [
	["1h/s", 3600e3],
	["3h/s", 3 * 3600e3],
	["6h/s", 6 * 3600e3],
];

function stamp(t: number): string {
	const d = new Date(t);
	return `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}Z`;
}

/** The dock's REPLAY button toggles this bar; leaving it (unmount)
 * restores the live picture. */
export default function Replay({
	getMap,
}: {
	getMap: () => maplibregl.Map | null;
}) {
	const [end] = useState(() => Math.ceil(Date.now() / STEP_MS) * STEP_MS);
	const start = end - SPAN_MS;
	const [t, setT] = useState(start + 6 * 3600e3);
	const [win, setWin] = useState(WINDOWS[1][1]);
	const [speed, setSpeed] = useState(SPEEDS[0][1]);
	const [playing, setPlaying] = useState(false);
	const [shown, setShown] = useState<number | null>(null);
	const last = useRef(0);

	// Apply the clock (throttled to animation frames by the play loop).
	useEffect(() => {
		const m = getMap();
		if (m) setShown(setReplay(m, { t, windowMs: win }));
	}, [t, win, getMap]);
	// Leaving the replay restores the live picture.
	useEffect(
		() => () => {
			const m = getMap();
			if (m) setReplay(m, null);
		},
		[getMap],
	);

	useEffect(() => {
		if (!playing) return;
		let raf = 0;
		last.current = performance.now();
		const tick = (now: number) => {
			const dt = now - last.current;
			last.current = now;
			setT((cur) => {
				const next = cur + (dt / 1000) * speed;
				if (next >= end) {
					setPlaying(false);
					return end;
				}
				return next;
			});
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [playing, speed, end]);

	return (
		<div className="replay" id="replay" role="group" aria-label="time replay">
			<button
				type="button"
				className="ghost-btn replay-play"
				aria-label={playing ? "pause replay" : "play replay"}
				onClick={() => {
					if (!playing && t >= end) setT(start);
					setPlaying((p) => !p);
				}}
			>
				{playing ? "PAUSE" : "PLAY"}
			</button>
			<input
				type="range"
				className="replay-range"
				aria-label="replay time"
				min={start}
				max={end}
				step={STEP_MS}
				value={t}
				onChange={(e) => {
					setPlaying(false);
					setT(Number(e.target.value));
				}}
			/>
			<span className="replay-clock mono" id="replay-clock">
				{stamp(t)}
			</span>
			<span className="replay-count dim">
				{shown == null ? "" : `${shown} on map`}
			</span>
			<select
				aria-label="replay window"
				value={win}
				onChange={(e) => setWin(Number(e.target.value))}
			>
				{WINDOWS.map(([l, v]) => (
					<option key={l} value={v}>
						last {l}
					</option>
				))}
			</select>
			<select
				aria-label="replay speed"
				value={speed}
				onChange={(e) => setSpeed(Number(e.target.value))}
			>
				{SPEEDS.map(([l, v]) => (
					<option key={l} value={v}>
						{l}
					</option>
				))}
			</select>
		</div>
	);
}

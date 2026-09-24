"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { LAYER_NAMES } from "../lib/layer-catalog";
import { PALETTE } from "../lib/palette";

export default function Timeline({
	since,
	setSince,
}: {
	since: string | null;
	setSince: (s: string | null) => void;
}) {
	const [layer, setLayer] = useState("quakes");
	const [info, setInfo] = useState("");
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		let stop = false;
		async function draw() {
			try {
				const j = await api.layerHistory(layer);
				if (stop) return;
				const bs = j.buckets || [];
				setInfo(
					`${layer} · ${bs.length} days · click = filter · dblclick = clear`,
				);
				const cv = canvasRef.current;
				if (!cv) return;
				const ctx = cv.getContext("2d");
				if (!ctx) return;
				cv.width = cv.clientWidth || 1600;
				cv.height = 44;
				const W = cv.width;
				const H = cv.height;
				ctx.clearRect(0, 0, W, H);
				// The API serves {bucket, count} (count as a string); the old code
				// read b.n, so every bar was NaN tall and the strip drew nothing.
				const n = (b: { n?: number; count?: string | number }) =>
					Number(b.count ?? b.n ?? 0) || 0;
				const max = Math.max(1, ...bs.map(n));
				const w = W / Math.max(1, bs.length);
				ctx.fillStyle = PALETTE.txt2;
				ctx.globalAlpha = 0.55;
				// Bars cap at 12px: three buckets read as bars, not slabs; a year of
				// daily buckets still fills the strip edge to edge.
				const bw = Math.max(1, Math.min(w - 2, 12));
				bs.forEach((b, i) => {
					const h = Math.max(2, (n(b) / max) * 38);
					ctx.fillRect(i * w + (w - bw) / 2, 44 - h, bw, h);
				});
				ctx.globalAlpha = 1;
				// baseline hairline: bars stand on something
				ctx.fillStyle = PALETTE.faint;
				ctx.fillRect(0, 43, W, 1);
				(cv as HTMLCanvasElement & { __buckets?: typeof bs }).__buckets = bs;
			} catch {
				/* keep */
			}
		}
		draw();
		return () => {
			stop = true;
		};
	}, [layer]);

	function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
		const cv = canvasRef.current;
		const bs =
			(cv as unknown as { __buckets?: { bucket: string }[] })?.__buckets ?? [];
		if (!bs.length || !cv) return;
		const r = cv.getBoundingClientRect();
		const i = Math.min(
			bs.length - 1,
			Math.floor(((e.clientX - r.left) / r.width) * bs.length),
		);
		setSince(bs[i].bucket);
	}
	return (
		<div>
			<div className="tl-head">
				<span>
					Timeline ·{" "}
					<select
						className="tl-layer"
						value={layer}
						onChange={(e) => setLayer(e.target.value)}
					>
						{LAYER_NAMES.map((l) => (
							<option key={l} value={l}>
								{l}
							</option>
						))}
					</select>
				</span>
				<span id="tl-info">
					{info}
					{since ? ` · since ${since}` : ""}
				</span>
			</div>
			<canvas
				ref={canvasRef}
				className="tl-canvas"
				id="tl-canvas"
				width={1600}
				height={44}
				onClick={onClick}
				onDoubleClick={() => setSince(null)}
			/>
		</div>
	);
}

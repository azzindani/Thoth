"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { LAYER_NAMES, LAYERS } from "../lib/layer-catalog";

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
				const max = Math.max(1, ...bs.map((b) => b.n));
				const w = W / Math.max(1, bs.length);
				ctx.fillStyle = LAYERS[layer]?.color ?? "#ffa028";
				bs.forEach((b, i) => {
					const h = Math.max(2, (b.n / max) * 40);
					ctx.fillRect(i * w + 1, 44 - h, w - 2, h);
				});
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

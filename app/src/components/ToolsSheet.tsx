"use client";
// The phone's "More" sheet: everything the desk reaches through the ticker,
// the dock and the command palette — map style, globe, cinema, missions,
// replay, graph, reports and saved views — as large tap targets. Actions
// are the palette's own (one source of truth); map style and view toggles
// get a quick row on top.
import { SheetHead } from "../lib/sheet";
import type { Action } from "./Palette";

// Groups worth a tap on a phone, in order. Keyboard-only help and the
// desk panel toggles stay in the palette.
const GROUPS = ["View", "Mission", "Report", "Workspace", "Help"];
const SKIP = new Set([
	"view-clear",
	"view-insp",
	"view-expl",
	"view-focus",
	"cmd-line",
	"keys",
]);

export default function ToolsSheet({
	open,
	onClose,
	mode,
	setMode,
	globe,
	setGlobe,
	actions,
	onPalette,
	cinema,
}: {
	open: boolean;
	onClose: () => void;
	mode: string;
	setMode: (m: string) => void;
	globe: boolean;
	setGlobe: (g: boolean) => void;
	actions: Action[];
	onPalette: () => void;
	cinema: boolean;
}) {
	const run = (a: Action) => {
		onClose();
		a.run();
	};
	return (
		<div
			className={`tools-sheet${open ? " open" : ""}`}
			id="tools-sheet"
			role="dialog"
			aria-label="tools"
			aria-hidden={!open}
		>
			<SheetHead title="Tools" onClose={onClose} closeButton />
			<div className="tools-body">
				<h3 className="tools-h">Map</h3>
				<fieldset className="tools-seg" aria-label="map style">
					{(
						[
							["default", "Dark"],
							["sat", "Satellite"],
							["nvg", "Night vision"],
						] as const
					).map(([m, l]) => (
						<button
							key={m}
							type="button"
							className={mode === m ? "on" : ""}
							aria-pressed={mode === m}
							onClick={() => setMode(m)}
						>
							{l}
						</button>
					))}
				</fieldset>
				<fieldset className="tools-seg" aria-label="view">
					<button
						type="button"
						className={globe ? "on" : ""}
						aria-pressed={globe}
						onClick={() => setGlobe(!globe)}
					>
						{globe ? "Globe" : "Flat map"}
					</button>
					<button
						type="button"
						className={cinema ? "on" : ""}
						aria-pressed={cinema}
						onClick={() => setMode("cinema")}
					>
						Cinema
					</button>
				</fieldset>
				{GROUPS.map((g) => {
					const items = actions.filter((a) => a.group === g && !SKIP.has(a.id));
					if (!items.length) return null;
					return (
						<div key={g}>
							<h3 className="tools-h">{g}</h3>
							<div className="tools-list">
								{items.map((a) => (
									<button key={a.id} type="button" onClick={() => run(a)}>
										{a.label}
									</button>
								))}
							</div>
						</div>
					);
				})}
				<button
					type="button"
					className="tools-all"
					onClick={() => {
						onClose();
						onPalette();
					}}
				>
					All commands…
				</button>
			</div>
		</div>
	);
}

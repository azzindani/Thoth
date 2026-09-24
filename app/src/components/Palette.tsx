"use client";
// Command palette (Ctrl/⌘+K) and shortcut sheet (?) — ROADMAP P5.
// The palette is a filterable list of actions the page already has (open a
// tab, toggle a layer, switch mode or mission, fly to a theater, show/hide
// panels). Matching is a forgiving subsequence match on "group label".
// Keyboard: ↑/↓ move, Enter runs, Esc closes. The command line (/) stays
// the place for typed commands with arguments.
import { useEffect, useMemo, useRef, useState } from "react";

export type Action = {
	id: string;
	group: string;
	label: string;
	hint?: string;
	run: () => void;
};

/** Subsequence match score (higher is better); -1 = no match. Word starts
 * and consecutive letters score, so "tl quakes" finds "Toggle layer ·
 * quakes" first. */
export function score(needle: string, hay: string): number {
	const n = needle.toLowerCase().replace(/\s+/g, "");
	const h = hay.toLowerCase();
	if (!n) return 0;
	let s = 0;
	let j = 0;
	let run = 0;
	for (let i = 0; i < h.length && j < n.length; i++) {
		if (h[i] === n[j]) {
			const start = i === 0 || /[\s·/_-]/.test(h[i - 1]);
			run++;
			s += 1 + (start ? 3 : 0) + (run > 1 ? 2 : 0);
			j++;
		} else run = 0;
	}
	return j === n.length ? s : -1;
}

/** Actions best-first for a query (all, in order, when empty). */
export function rank(q: string, actions: Action[]): Action[] {
	if (!q.trim()) return actions.slice(0, 60);
	return actions
		.map((a) => ({ a, s: score(q, `${a.group} ${a.label}`) }))
		.filter((x) => x.s >= 0)
		.sort((x, y) => y.s - x.s)
		.slice(0, 60)
		.map((x) => x.a);
}

export function CommandPalette({
	open,
	onClose,
	actions,
}: {
	open: boolean;
	onClose: () => void;
	actions: Action[];
}) {
	const [q, setQ] = useState("");
	const [at, setAt] = useState(0);
	const [wasOpen, setWasOpen] = useState(open);
	const list = useRef<HTMLDivElement>(null);
	// Reset while rendering the opening frame — an effect would run after
	// paint and could wipe keys typed in between.
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setQ("");
			setAt(0);
		}
	}

	const shown = useMemo(() => rank(q, actions), [q, actions]);

	useEffect(() => {
		list.current
			?.querySelector(`[data-i="${at}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [at]);

	if (!open) return null;
	const go = (a?: Action) => {
		if (!a) return;
		onClose();
		a.run();
	};
	return (
		<div className="pal-back" onClick={onClose}>
			<div
				className="pal"
				role="dialog"
				aria-modal="true"
				aria-label="Command palette"
				id="palette"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<input
					// Focus as the input mounts, not a frame later: the next
					// keystroke must land here, never on the page shortcuts.
					ref={(el) => el?.focus()}
					className="pal-q"
					placeholder="Type a command — tab, layer, mode, mission, theater…"
					value={q}
					role="combobox"
					aria-expanded="true"
					aria-controls="pal-list"
					aria-activedescendant={shown[at] ? `pal-${shown[at].id}` : undefined}
					onChange={(e) => {
						setQ(e.target.value);
						setAt(0);
					}}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setAt((i) => Math.min(i + 1, shown.length - 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setAt((i) => Math.max(i - 1, 0));
						} else if (e.key === "Enter") {
							e.preventDefault();
							// Rank what is in the box *now*: fast typing can reach
							// Enter before the last keystrokes have re-rendered.
							const live = e.currentTarget.value;
							go(live === q ? shown[at] : rank(live, actions)[0]);
						} else if (e.key === "Escape") {
							e.preventDefault();
							onClose();
						}
					}}
				/>
				<div className="pal-list" id="pal-list" role="listbox" ref={list}>
					{shown.length === 0 && (
						<div className="pal-empty dim">
							No match. Typed commands with arguments live on the command line (
							<kbd>/</kbd>).
						</div>
					)}
					{shown.map((a, i) => (
						<div
							key={a.id}
							id={`pal-${a.id}`}
							data-i={i}
							role="option"
							aria-selected={i === at}
							tabIndex={-1}
							className={`pal-item${i === at ? " on" : ""}`}
							onMouseEnter={() => setAt(i)}
							onClick={() => go(a)}
							onKeyDown={() => {}}
						>
							<span className="pal-group">{a.group}</span>
							<span className="pal-label">{a.label}</span>
							{a.hint && <kbd className="pal-hint">{a.hint}</kbd>}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

const SHORTCUTS: [string, string][] = [
	["Ctrl/⌘ K", "Command palette"],
	["/", "Command line"],
	["?", "This sheet"],
	["\\", "Clear view — hide / show every panel"],
	["i", "Show / hide the inspector"],
	["g", "Globe ↔ flat map"],
	["s", "Cycle map mode (dark · sat · nvg)"],
	["m", "Cycle mission preset"],
	["f", "Focus mode"],
	["e", "Entity graph"],
	["Esc", "Close cards, sheets and dialogs"],
];

export function ShortcutSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const close = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (open) requestAnimationFrame(() => close.current?.focus());
	}, [open]);
	if (!open) return null;
	return (
		<div className="pal-back" onClick={onClose}>
			<div
				className="pal keys"
				role="dialog"
				aria-modal="true"
				aria-label="Keyboard shortcuts"
				id="shortcuts"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key === "Escape") onClose();
				}}
			>
				<div className="keys-head">
					<h3>Keyboard shortcuts</h3>
					<button
						ref={close}
						type="button"
						className="ghost-btn"
						onClick={onClose}
						aria-label="close shortcuts"
					>
						CLOSE
					</button>
				</div>
				<dl className="keys-list">
					{SHORTCUTS.map(([k, v]) => (
						<div key={k} className="keys-row">
							<dt>
								<kbd>{k}</kbd>
							</dt>
							<dd>{v}</dd>
						</div>
					))}
				</dl>
			</div>
		</div>
	);
}

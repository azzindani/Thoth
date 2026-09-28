"use client";
// Settings: display size (five layout levels, five text levels) and the
// preferences worth keeping per browser. Everything applies live and is
// stored in localStorage (lib/settings.ts). A modal dialog on every
// screen; on phones it fills the width and scrolls.
import { useRef } from "react";
import { useDialog } from "../lib/dialog";
import {
	DEFAULTS,
	LAYOUT_KEYS,
	LEVEL_LABEL,
	LEVELS,
	type Level,
	type Settings,
} from "../lib/settings";
import { useSettings } from "../lib/useSettings";

function Steps({
	label,
	value,
	onPick,
	hint,
}: {
	label: string;
	value: Level;
	onPick: (l: Level) => void;
	hint: string;
}) {
	return (
		<fieldset className="set-row">
			<legend>{label}</legend>
			<div className="set-steps">
				{LEVELS.map((l) => (
					<button
						key={l}
						type="button"
						className={l === value ? "on" : ""}
						aria-pressed={l === value}
						onClick={() => onPick(l)}
					>
						{LEVEL_LABEL[l]}
					</button>
				))}
			</div>
			<p className="set-hint">{hint}</p>
		</fieldset>
	);
}

function Toggle({
	label,
	hint,
	on,
	onChange,
}: {
	label: string;
	hint?: string;
	on: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<button
			type="button"
			className="set-toggle"
			role="switch"
			aria-checked={on}
			onClick={() => onChange(!on)}
		>
			<span className="set-t">
				<b>{label}</b>
				{hint && <span className="set-hint">{hint}</span>}
			</span>
			<span className={`sw${on ? " on" : ""}`} aria-hidden="true">
				<span className="sw-knob" />
			</span>
		</button>
	);
}

function Choice<T extends string>({
	label,
	value,
	options,
	onPick,
}: {
	label: string;
	value: T;
	options: [T, string][];
	onPick: (v: T) => void;
}) {
	return (
		<fieldset className="set-row">
			<legend>{label}</legend>
			<div className="set-steps">
				{options.map(([v, l]) => (
					<button
						key={v}
						type="button"
						className={v === value ? "on" : ""}
						aria-pressed={v === value}
						onClick={() => onPick(v)}
					>
						{l}
					</button>
				))}
			</div>
		</fieldset>
	);
}

export default function SettingsPanel({
	onClose,
	onNotice,
}: {
	onClose: () => void;
	onNotice: (text: string) => void;
}) {
	const box = useRef<HTMLDivElement>(null);
	useDialog(box, true, onClose);
	const [s, set] = useSettings();
	const same = (Object.keys(DEFAULTS) as (keyof Settings)[]).every(
		(k) => s[k] === DEFAULTS[k],
	);
	return (
		<div className="modal-veil" onClick={onClose}>
			<div
				className="modal settings"
				role="dialog"
				aria-modal="true"
				aria-labelledby="settings-h"
				ref={box}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="set-head">
					<h3 id="settings-h">Settings</h3>
					<button
						type="button"
						className="set-close"
						aria-label="close settings"
						onClick={onClose}
					>
						✕
					</button>
				</div>
				<div className="set-body">
					<h4>Display</h4>
					<Steps
						label="Layout size"
						value={s.layout}
						onPick={(layout) => set({ layout })}
						hint="Panels, bars, buttons and spacing. M is the standard size."
					/>
					<Steps
						label="Text size"
						value={s.text}
						onPick={(text) => set({ text })}
						hint="All interface text, independent of the layout size."
					/>
					<p className="set-sample">
						Sample · <b>M4.5 – 78 km N of Daocheng</b> · 20m ago
					</p>
					<Toggle
						label="Solid panels"
						hint="No see-through blur: easier to read, lighter on older devices."
						on={s.solid}
						onChange={(solid) => set({ solid })}
					/>
					<Choice
						label="Motion"
						value={s.motion}
						options={[
							["system", "Follow system"],
							["reduce", "Reduce"],
						]}
						onPick={(motion) => set({ motion })}
					/>

					<h4>Time</h4>
					<Choice
						label="Show times in"
						value={s.time}
						options={[
							["utc", "UTC"],
							["local", "Local time"],
						]}
						onPick={(time) => set({ time })}
					/>

					<h4>Map</h4>
					<Toggle
						label="Hover previews"
						hint="Cards on mouse-over (desk). Clicking still pins a card."
						on={s.hover}
						onChange={(hover) => set({ hover })}
					/>
					<Toggle
						label="Overview minimap"
						hint="The small locator map (desk and tablet)."
						on={s.minimap}
						onChange={(minimap) => set({ minimap })}
					/>
					<Toggle
						label="Open where I left off"
						hint="Start at the last map view instead of the world (a shared link still wins)."
						on={s.rememberView}
						onChange={(rememberView) => set({ rememberView })}
					/>

					<h4>Alerts</h4>
					<Toggle
						label="Critical alert pop-ups"
						hint="The Alerts tab and badge keep counting when off."
						on={s.critPopups}
						onChange={(critPopups) => set({ critPopups })}
					/>
					<Toggle
						label="Watch match pop-ups"
						on={s.watchPopups}
						onChange={(watchPopups) => set({ watchPopups })}
					/>

					<h4>Reset</h4>
					<div className="set-actions">
						<button
							type="button"
							disabled={same}
							onClick={() => {
								set(DEFAULTS);
								onNotice("Settings back to defaults");
							}}
						>
							Restore default settings
						</button>
						<button
							type="button"
							onClick={() => {
								try {
									for (const k of LAYOUT_KEYS) localStorage.removeItem(k);
								} catch {
									/* keep */
								}
								onNotice("Saved panel layout cleared (applies on reload)");
							}}
						>
							Clear saved panel layout
						</button>
					</div>
					<p className="set-hint">
						Settings are kept in this browser only. Saved workspaces are managed
						from the command palette.
					</p>
				</div>
			</div>
		</div>
	);
}

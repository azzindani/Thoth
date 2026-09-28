// UI primitives — React port of docs/development/ui-design-system.md §2.
// Tokens-only colors, Lucide glyphs only, escaped by construction (React).
import type { ReactNode } from "react";
import { LAYERS } from "./layer-catalog";
import { hostOf, sourceHome } from "./sources";

/** Layer symbol. Monochrome by design: it inherits the surrounding text
 * colour (layers are told apart by shape; colour is reserved for severity). */
export function Glyph({ layer, size = 15 }: { layer: string; size?: number }) {
	const L = LAYERS[layer];
	if (!L) return null;
	return (
		<span
			className="glyph"
			style={{
				display: "inline-flex",
				width: size,
				height: size,
				flex: "none",
			}}
			dangerouslySetInnerHTML={{
				__html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${L.svg}</svg>`,
			}}
		/>
	);
}

export function Btn({
	children,
	onClick,
	on = false,
	skin = "tbtn",
	...rest
}: {
	children: ReactNode;
	onClick?: () => void;
	on?: boolean;
	skin?: string;
} & Record<string, unknown>) {
	return (
		<button
			type="button"
			className={`${skin}${on ? (skin === "tbtn" ? " mode-on" : " on") : ""}`}
			onClick={onClick}
			{...(rest as object)}
		>
			{children}
		</button>
	);
}

export function Chip({
	children,
	active,
	onClick,
}: {
	children: ReactNode;
	active?: boolean;
	onClick?: () => void;
}) {
	return (
		<button className={active ? "on" : ""} onClick={onClick}>
			{children}
		</button>
	);
}

const BADGE_COLOR: Record<string, string> = {
	critical: "var(--red)",
	watch: "var(--amber)",
	info: "var(--dim)",
	stale: "var(--amber)",
	live: "var(--txt2)", // healthy stays quiet
};

export function Badge({ text, kind }: { text: ReactNode; kind: string }) {
	return <b style={{ color: BADGE_COLOR[kind] ?? "var(--dim)" }}>{text}</b>;
}

/** Relative age ("12m ago") for event timestamps. */
export function ageStr(ts: unknown): string {
	const t = new Date(String(ts ?? "")).getTime();
	if (!Number.isFinite(t)) return "—";
	const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

/** Collector cadence ("10m", "24h") for layer refresh hints. */
export function fmtCadence(sec: number): string {
	if (sec >= 86400) return `${Math.round(sec / 86400)}d`;
	if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
	if (sec >= 60) return `${Math.round(sec / 60)}m`;
	return `${sec}s`;
}

export function LayerRow({
	name,
	count,
	visible,
	onToggle,
	title,
	error,
}: {
	name: string;
	count: string | number;
	visible: boolean;
	onToggle: () => void;
	title?: string;
	/** last load failed: shown instead of the count */
	error?: string;
}) {
	return (
		<div
			className={`lrow${visible ? "" : " off"}`}
			role="switch"
			aria-checked={visible}
			aria-label={name}
			tabIndex={0}
			onClick={onToggle}
			onKeyDown={(e) => {
				if (e.key === " " || e.key === "Enter") {
					e.preventDefault();
					onToggle();
				}
			}}
			title={error ? `${name} failed to load (${error}), retrying` : title}
		>
			<Glyph layer={name} />
			<span className="nm">{name}</span>
			{error ? <b className="lrow-err">!</b> : <b>{count}</b>}
			<Switch on={visible} />
		</div>
	);
}

/** On/off track. Presentational only: the row or header around it owns the
 * click and the switch role, so the hit target stays the full row. */
export function Switch({
	on,
	mixed = false,
}: {
	on: boolean;
	mixed?: boolean;
}) {
	return (
		<span
			className={`sw${on ? " on" : ""}${mixed ? " mixed" : ""}`}
			aria-hidden="true"
		>
			<span className="sw-knob" />
		</span>
	);
}

export function KV({ pairs }: { pairs: [string, ReactNode][] }) {
	return (
		<div className="kv">
			{pairs.flatMap(([k, v], i) => [
				<b key={`k${i}`}>{k}</b>,
				<span key={`v${i}`}>{v}</span>,
			])}
		</div>
	);
}

export function ItemRow({
	children,
	onClick,
}: {
	children: ReactNode;
	onClick?: () => void;
}) {
	return (
		<div className="item" onClick={onClick}>
			{children}
		</div>
	);
}

export function Field(props: React.InputHTMLAttributes<HTMLInputElement>) {
	return <input autoComplete="off" spellCheck={false} {...props} />;
}

/** "usgs.gov ↗": the item's own link, else its publisher's site, else
 * nothing (never a guess). Stops the click so row handlers don't fire. */
export function SourceLink({
	url,
	source,
}: {
	url?: string | null;
	source?: string;
}) {
	const own = url && /^https?:\/\//.test(url) ? url : null;
	const href = own ?? (source ? sourceHome(source) : null);
	if (!href) return null;
	return (
		<a
			className="src-link"
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			title={own ? "Open the original report" : "Open the publisher"}
			onClick={(e) => e.stopPropagation()}
		>
			{hostOf(href) ?? "source"} ↗
		</a>
	);
}

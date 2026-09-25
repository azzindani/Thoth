// UI primitives — React port of docs/development/ui-design-system.md §2.
// Tokens-only colors, Lucide glyphs only, escaped by construction (React).
import type { ReactNode } from "react";
import { LAYERS } from "./layer-catalog";

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
}: {
	name: string;
	count: string | number;
	visible: boolean;
	onToggle: () => void;
	title?: string;
}) {
	return (
		<div
			className={`lrow${visible ? "" : " off"}`}
			onClick={onToggle}
			title={title}
		>
			<Glyph layer={name} />
			<span className="nm">{name}</span>
			<b>{count}</b>
		</div>
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

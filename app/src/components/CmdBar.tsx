"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { LAYER_NAMES } from "../lib/layer-catalog";
import { Field } from "../lib/ui";

const HELP = [
	"LAYERS   quakes off · fires on · <layer> (toggle)",
	"MAP      sat · dark · nvg · globe · cinema · focus",
	"PLACES   dossier lat,lng · country <name>",
	"SEARCH   search <words> · sdn <name> · alerts",
	"LOOKUPS  cert <domain> · asn <AS…> · ip · cve · aircraft · vessel · airport · geo · wiki · company … (+ value)",
	"WATCH    watch add keyword <word> · watch list · watch matches",
	"TOOLS    trend <layer> <days> · export <layer> csv|geojson · report · notify <text>",
	"TABS     pulse · portfolio · screen · monitor · notes · changelog",
	"KEYS     / command · Ctrl+K palette · ? shortcuts · g s m f e i · esc",
].join("\n");

export default function CmdBar({
	onLayer,
	onMode,
	onDossier,
	onSdn,
	onAlerts,
	onOsint,
	onChangelog,
	onFocus,
	onTab,
	onCountry,
	onSitrep,
}: {
	onLayer: (l: string, st?: boolean) => void;
	onMode: (m: string) => void;
	onDossier: (lat: string, lng: string) => void;
	onSdn: (q: string) => void;
	onAlerts: () => void;
	onOsint: (kind: string, arg: string) => void;
	onChangelog: () => void;
	onFocus: () => void;
	onTab: (t: string) => void;
	onCountry?: (name: string) => void;
	onSitrep?: () => void;
}) {
	const [val, setVal] = useState("");
	// Every command answers here (a live region): on phones as a bubble
	// over the command pill, on wider screens beside the input. `help` is
	// long, so it always opens as the bubble.
	const [out, setOut] = useState<{ text: string; long?: boolean } | null>(null);
	const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const onOut = (text: string, long = false) => {
		clearTimeout(hide.current);
		setOut({ text, long });
		if (!long) hide.current = setTimeout(() => setOut(null), 8000);
	};
	useEffect(() => () => clearTimeout(hide.current), []);
	async function run() {
		const [c, ...rest] = val.trim().split(/\s+/);
		const arg = rest.join(" ");
		if (!c) return;
		const lc = c.toLowerCase();
		const onOff = !arg || /^(on|off)$/i.test(arg);
		const layerCmd = (L: string) => {
			onLayer(L, !arg ? undefined : !/^off$/i.test(arg));
			onOut(`${L} ${!arg ? "toggled" : arg.toLowerCase()}`);
		};
		// An exact layer name wins, then commands, and only then a layer
		// prefix ("sat" is the satellite map, not the satellites layer).
		const prefixL = LAYER_NAMES.find((l) => l.startsWith(lc));
		if (LAYER_NAMES.includes(lc) && onOff) {
			layerCmd(lc);
		} else if (/^(sat|dark|nvg|globe|cinema)$/i.test(c || "")) {
			onMode(c.toLowerCase());
			onOut(
				/^globe$/i.test(c)
					? "globe ↔ flat map"
					: /^cinema$/i.test(c)
						? "cinema toggled (grab the map to stop)"
						: `map mode: ${c.toLowerCase()}`,
			);
		} else if (/^focus$/i.test(c || "")) {
			onFocus();
			onOut("focus toggled");
		} else if (/^dossier$/i.test(c || "") && arg) {
			const [la, ln] = arg.split(",");
			onDossier((la ?? "").trim(), (ln ?? "").trim());
			onOut(`dossier ${arg}`);
		} else if (/^sdn$/i.test(c || "")) {
			onSdn(arg);
			onOut(`sdn ${arg}`);
		} else if (/^alerts$/i.test(c || "")) {
			onAlerts();
			onOut("alerts loaded");
		} else if (
			/^(pulse|portfolio|screen|screener|monitor|health|feeds|notes|journal)$/i.test(
				c || "",
			)
		) {
			// Terminal pillar tabs (fincept digest): deep-linkable from the
			// bar so the fincept workflow is one command away.
			const t = /pulse/i.test(c || "")
				? "pulse"
				: /portfolio/i.test(c || "")
					? "portfolio"
					: /screen|screener/i.test(c || "")
						? "screen"
						: /monitor|health|feeds/i.test(c || "")
							? "monitor"
							: "notes";
			onTab(t);
			onOut(`${t} opened`);
		} else if (
			/^(aircraft|airport|vessel|mitre|ip|ipwhois|geo|geocode|nominatim|omgeo|btc|token|cert|asn|cve|epss|osv|circl|mitre-cve|ghsa|company|fdic|ror|macro|macro-imf|ports|doh|doh-google|doh-cf|robtex|wikidata|wiki|books|stack|fda-drug|gene|ontology|protein|package|daylight|zip|transit|name|funder|museum|maltiverse|urlscan|maltsearch|crfunder|food|music|rxnorm|chembl|sbdb|deps|nasa-img|planespotter|dailymed|holidays|npm-dl|sirene|stealers|gravatar)$/i.test(
				c || "",
			)
		) {
			if (!arg) {
				onOut(
					`${c.toLowerCase()} needs an argument, e.g. ${c.toLowerCase()} <value>`,
				);
				return;
			}
			onOsint(c.toLowerCase(), arg);
			onOut(`${c.toLowerCase()} ${arg}: looking up…`);
		} else if (/^search$/i.test(c || "") && arg) {
			onOsint("search", arg);
			onOut(`searching events for "${arg}"`);
		} else if (/^watch$/i.test(c || "")) {
			onOsint("watch", arg || "list");
			onOut(`watch ${arg || "list"}`);
		} else if (/^sitrep$/i.test(c || "")) {
			onOsint("sitrep", arg || "show");
			onOut(`sitrep ${arg || "show"}`);
		} else if (/^trend$/i.test(c || "") && arg) {
			onOsint("trend", arg);
			onOut(`trend ${arg}`);
		} else if (/^notify$/i.test(c || "") && arg) {
			api
				.notify(arg)
				.then((j) => onOut(j.ok ? "notified" : String(j.error || "not sent")))
				.catch(() => onOut("notify failed"));
			onOut("sending…");
		} else if (/^export$/i.test(c || "")) {
			const [layer, fmt] = arg.split(/\s+/);
			const L2 = LAYER_NAMES.find((l) =>
				l.startsWith((layer || "").toLowerCase()),
			);
			if (L2) {
				window.open(
					api.exportUrl(L2, fmt === "geojson" ? "geojson" : "csv"),
					"_blank",
				);
				onOut(`exporting ${L2}`);
			} else onOut("export <layer> [csv|geojson]");
		} else if (/^country$/i.test(c || "") && arg) {
			onCountry?.(arg);
			onOut(`country ${arg}`);
		} else if (/^report$/i.test(c || "") && onSitrep) {
			onSitrep();
			onOut("sitrep report opened");
		} else if (/^changelog$/i.test(c || "")) {
			onChangelog();
			onOut("changelog opened");
		} else if (/^help$/i.test(c || "")) {
			onOut(HELP, true);
		} else if (prefixL && onOff) {
			layerCmd(prefixL);
		} else onOut(`unknown command "${c}": try help`);
		setVal("");
	}
	return (
		<div className="cmdbar">
			<span className="prompt">&gt;</span>
			<Field
				id="cmd"
				placeholder="help · quakes off · sat · dossier 51.5,-0.12 · sdn putin · alerts · cert example.com · asn AS15169 · search reactor · watch add keyword tsunami"
				value={val}
				onChange={(e) => setVal(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") run();
				}}
			/>
			<output
				className={`cmd-out${out?.long ? " long" : ""}`}
				id="cmd-out"
				aria-live="polite"
			>
				{out?.long ? (
					<span className="help-grid">
						{out.text.split("\n").map((line) => {
							const [k, ...v] = line.split(/\s{2,}/);
							return (
								<span key={k} className="help-row">
									<b>{k}</b>
									<span>{v.join(" ")}</span>
								</span>
							);
						})}
					</span>
				) : (
					out?.text
				)}
				{out && (
					<button
						type="button"
						className="cmd-out-x"
						aria-label="dismiss"
						onClick={() => setOut(null)}
					>
						✕
					</button>
				)}
			</output>
		</div>
	);
}

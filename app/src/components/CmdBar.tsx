"use client";
import { useState } from "react";
import { api } from "../lib/api";
import { LAYER_NAMES } from "../lib/layer-catalog";
import { Field } from "../lib/ui";

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
	const [out, setOut] = useState("");
	const onOut = setOut;
	async function run() {
		const [c, ...rest] = val.trim().split(/\s+/);
		const arg = rest.join(" ");
		const L = LAYER_NAMES.find((l) => l.startsWith((c || "").toLowerCase()));
		if (L && (!arg || /^(on|off)$/i.test(arg))) {
			onLayer(L, !arg ? undefined : !/^off$/i.test(arg));
		} else if (/^(sat|dark|nvg|globe|cinema)$/i.test(c || "")) {
			onMode(c.toLowerCase());
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
			onOsint(c.toLowerCase(), arg);
		} else if (/^search$/i.test(c || "") && arg) {
			onOsint("search", arg);
		} else if (/^watch$/i.test(c || "")) {
			onOsint("watch", arg || "list");
		} else if (/^sitrep$/i.test(c || "")) {
			onOsint("sitrep", arg || "show");
		} else if (/^trend$/i.test(c || "") && arg) {
			onOsint("trend", arg);
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
			onOut(
				"layers: name on|off · sat|dark|nvg|globe|cinema · dossier lat,lng · sdn q · alerts · pulse|portfolio|screen|monitor|notes · aircraft|airport|vessel|mitre|ip|ipwhois|geo|geocode|nominatim|omgeo|btc|token|cert|asn|cve|epss|osv|circl|mitre-cve|ghsa|company|fdic|ror|macro|macro-imf|ports|doh|doh-google|doh-cf|robtex|wikidata|wiki|books|stack|fda-drug|gene|ontology|protein|package|daylight|zip|transit|name|funder|museum|rxnorm|chembl|sbdb|deps|nasa-img|planespotter|dailymed|holidays|npm-dl|sirene|stealers|gravatar + arg · search q · watch add|list|matches|del + args · country name · report (sitrep of this view) · notify text · changelog · keys: / g s m f e i esc",
			);
		} else onOut("? try help");
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
			<span className="cmd-out" id="cmd-out">
				{out}
			</span>
		</div>
	);
}

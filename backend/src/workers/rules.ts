import { query } from "../db/client.js";
import { locateCountry } from "./lib/countries.js";
import {
	dbClock,
	flushVersions,
	pruneStale,
	storeNormalized,
} from "./lib/store.js";

// Cross-layer rules (intelligence pass, no LLM): explicit, named patterns
// that join two layers into a finding an analyst should look at. Findings
// are stored as incidents (source thoth-rules), so they appear in the
// Incidents tab, on the map and in alerts, with every piece of evidence
// in the timeline linking back to its source. Each rule is small, reads
// only the database and says why it fired.

export const RULES_SOURCE = "thoth-rules";

type Evidence = {
	id: string;
	ts: string;
	layer: string;
	source: string;
	severity: string;
	title: string | null;
	url: string | null;
};

export type Finding = {
	rule: string;
	key: string;
	title: string;
	body: string;
	severity: "critical" | "watch";
	confidence: number;
	lat: number;
	lon: number;
	radiusKm: number;
	evidence: Evidence[];
};

// ── rule 1: internet outage in a country with submarine cable landings ──
// IODA reports outages per country (or region / network, with a country
// code); TeleGeography names each landing "City, Country". An outage where
// cables land is the first question in a cable-cut hunt.

/** "internet outage — Egypt (country · EG)" → the country's locator key. */
export function outageCountry(title: string): string | null {
	const m = /^internet outage — (.+?) \((\w+)(?: · (.+))?\)$/.exec(title);
	if (!m) return null;
	const [, name, kind, cc] = m;
	const loc =
		kind === "country" ? locateCountry(name ?? "") : locateCountry(cc ?? "");
	return loc?.key ?? null;
}

/** "Cable landing · Alexandria, Egypt" → the country's locator key. */
export function landingCountry(title: string): string | null {
	const place = title.replace(/^Cable landing · /, "");
	const parts = place.split(",");
	return locateCountry(parts[parts.length - 1]?.trim() ?? "")?.key ?? null;
}

export async function outageAtLandings(): Promise<Finding[]> {
	const outages = await query<Evidence>(
		`SELECT id, ts::text AS ts, layer, source, severity, title, url FROM events
		  WHERE source = 'ioda' AND severity IN ('critical','watch')
		    AND ts > now() - interval '12 hours'`,
	);
	if (!outages.length) return [];
	const landings = await query<Evidence & { lat: number; lon: number }>(
		`SELECT id, ts::text AS ts, layer, source, severity, title, url,
		        ST_Y(geom) AS lat, ST_X(geom) AS lon
		   FROM events WHERE layer = 'cables' AND meta->>'kind' = 'landing'
		  ORDER BY title`,
	);
	const byCountry = new Map<string, typeof landings>();
	for (const l of landings) {
		const k = landingCountry(l.title ?? "");
		if (!k) continue;
		byCountry.set(k, [...(byCountry.get(k) ?? []), l]);
	}
	const out: Finding[] = [];
	for (const o of outages) {
		const k = outageCountry(o.title ?? "");
		const at = k ? byCountry.get(k) : undefined;
		if (!k || !at?.length) continue;
		const loc = locateCountry(k);
		if (!loc) continue;
		const names = at
			.slice(0, 3)
			.map(
				(l) => (l.title ?? "").replace(/^Cable landing · /, "").split(",")[0],
			)
			.join(", ");
		out.push({
			rule: "outage-at-cable-landings",
			key: o.id,
			title: `Internet outage where submarine cables land — ${o.title?.replace(/^internet outage — /, "")} · ${at.length} landing${at.length === 1 ? "" : "s"} (${names}${at.length > 3 ? "…" : ""})`,
			body: "An internet outage in a country with cable landings: check for a cable fault before a local cause.",
			severity: o.severity === "critical" ? "critical" : "watch",
			confidence: 0.5,
			lat: loc.lat,
			lon: loc.lon,
			radiusKm: 0,
			evidence: [o, ...at.slice(0, 10)],
		});
	}
	return out;
}

// ── rule 2: air traffic drops near conflict reports ───────────────────────
// A flights "drop" anomaly (a map cell emptying against its baseline)
// within 300 km of a conflict report from the last day: airspace may be
// closing.

const AIRSPACE_KM = 300;

export async function airspaceNearConflict(): Promise<Finding[]> {
	const rows = await query<
		Evidence & { lat: number; lon: number; conflicts: Evidence[] }
	>(
		`SELECT a.id, a.ts::text AS ts, a.layer, a.source, a.severity, a.title, a.url,
		        ST_Y(ST_Centroid(a.geom)) AS lat, ST_X(ST_Centroid(a.geom)) AS lon,
		        (SELECT json_agg(c ORDER BY c.ts DESC) FROM (
		           SELECT id, ts::text AS ts, layer, source, severity, title, url
		             FROM events c
		            WHERE c.layer = 'conflicts' AND c.ts > now() - interval '24 hours'
		              AND c.geom IS NOT NULL
		              AND ST_DWithin(c.geom::geography, ST_Centroid(a.geom)::geography, $1)
		            ORDER BY c.ts DESC LIMIT 10) c) AS conflicts
		   FROM events a
		  WHERE a.layer = 'anomalies' AND a.meta->>'layer' = 'flights'
		    AND a.meta->>'dir' = 'drop' AND a.geom IS NOT NULL
		    AND a.ingested_at > now() - interval '2 hours'`,
		[AIRSPACE_KM * 1000],
	);
	const out: Finding[] = [];
	for (const r of rows) {
		if (!r.conflicts?.length) continue;
		const { conflicts, lat, lon, ...anomaly } = r;
		out.push({
			rule: "airspace-near-conflict",
			key: anomaly.id,
			title: `Air traffic drop near conflict reports — ${anomaly.title} · ${conflicts.length} conflict report${conflicts.length === 1 ? "" : "s"} within ${AIRSPACE_KM} km`,
			body: "A cell's air traffic fell against its baseline next to recent conflict reports: airspace may be closing.",
			severity: anomaly.severity === "critical" ? "critical" : "watch",
			confidence: 0.55,
			lat,
			lon,
			radiusKm: AIRSPACE_KM,
			evidence: [anomaly, ...conflicts],
		});
	}
	return out;
}

export const RULES: [string, () => Promise<Finding[]>][] = [
	["outage-at-cable-landings", outageAtLandings],
	["airspace-near-conflict", airspaceNearConflict],
];

/** Runs every rule and stores its findings as incidents. */
export async function rulesPass(): Promise<Record<string, number>> {
	const runStart = await dbClock();
	const counts: Record<string, number> = {};
	for (const [name, rule] of RULES) {
		const found = await rule();
		counts[name] = found.length;
		for (const f of found) {
			const byTs = [...f.evidence].sort((a, b) => a.ts.localeCompare(b.ts));
			const layers = [...new Set(f.evidence.map((e) => e.layer))];
			const sources = [...new Set(f.evidence.map((e) => e.source))];
			await storeNormalized({
				id: `rule:${f.rule}:${f.key}`.slice(0, 200),
				ts: byTs[byTs.length - 1]?.ts ?? new Date().toISOString(),
				source: RULES_SOURCE,
				layer: "incidents",
				title: f.title.slice(0, 280),
				body: f.body,
				severity: f.severity,
				confidence: f.confidence,
				lat: f.lat,
				lon: f.lon,
				entities: { layers, sources },
				meta: {
					rule: f.rule,
					started: byTs[0]?.ts,
					updated: byTs[byTs.length - 1]?.ts,
					events: f.evidence.length,
					reports: f.evidence.length,
					layers,
					sources,
					radius_km: f.radiusKm,
					lead: f.key,
					timeline: byTs.map((e) => ({ ...e, dups: 0 })),
				},
			});
		}
	}
	await pruneStale(RULES_SOURCE, runStart);
	await flushVersions();
	return counts;
}

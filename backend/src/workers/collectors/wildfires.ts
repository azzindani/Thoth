// Official wildfire incident feeds (keyless): named incidents with size,
// containment and the agency's own alert level, next to the FIRMS satellite
// hotspots on `fires`. Each source publishes its CURRENT picture, so an
// incident that closes leaves the map (pruneStale after a successful poll).
//   calfire  CAL FIRE active incidents — acres + % contained (California)
//   nsw-rfs  NSW Rural Fire Service major incidents — AU warning levels
//   vic-emv  Emergency Management Victoria — fire incidents + fire warnings
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { pointOf } from "../lib/geo.js";
import {
	dbClock,
	errMsg,
	markHealth,
	pruneStale,
	storeNormalized,
	storeRaw,
} from "../lib/store.js";

const LAYER = "fires";
const CALFIRE_URL =
	"https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=false";
const NSW_RFS_URL = "https://www.rfs.nsw.gov.au/feeds/majorIncidents.json";
const NSW_RFS_PAGE =
	"https://www.rfs.nsw.gov.au/fire-information/fires-near-me";
const VIC_EMV_URL = "https://emergency.vic.gov.au/public/events-geojson.json";
const VIC_EMV_PAGE = "https://emergency.vic.gov.au/respond/";

/** CAL FIRE: a large, mostly-uncontained fire is the headline. */
const LARGE_ACRES = 10_000;
const MID_ACRES = 1_000;
const LOW_CONTAINMENT_PCT = 50;
/** Victorian incident statuses that mean the fire is still running. */
const VIC_ACTIVE_STATUS = new Set(["going", "not yet under control"]);

type Sev = "critical" | "watch" | "info";
type Row = Parameters<typeof storeNormalized>[0];

export function calfireSeverity(acres: number, containedPct: number): Sev {
	if (acres >= LARGE_ACRES && containedPct < LOW_CONTAINMENT_PCT)
		return "critical";
	if (acres >= MID_ACRES && containedPct < 100) return "watch";
	return "info";
}

/** Australian Warning System levels (NSW + VIC share them). */
export function auWarningSeverity(level: string): Sev {
	const l = level.toLowerCase();
	if (l.includes("emergency warning") || l.includes("evacuate"))
		return "critical";
	if (l.includes("watch and act")) return "watch";
	return "info";
}

type CalfireIncident = {
	Name?: string;
	UniqueId?: string;
	Updated?: string;
	Started?: string;
	County?: string;
	Location?: string;
	AcresBurned?: number | null;
	PercentContained?: number | null;
	Latitude?: number;
	Longitude?: number;
	Type?: string;
	Url?: string;
	IsActive?: boolean;
};

export function calfireRows(list: CalfireIncident[]): Row[] {
	const rows: Row[] = [];
	for (const i of list) {
		const lat = Number(i.Latitude);
		const lon = Number(i.Longitude);
		if (!i.UniqueId || i.IsActive === false) continue;
		if (!Number.isFinite(lat) || !Number.isFinite(lon) || (!lat && !lon))
			continue;
		const acres = Number(i.AcresBurned) || 0;
		const pct = Number(i.PercentContained) || 0;
		const name = (i.Name ?? "Incident").trim();
		rows.push({
			id: `calfire:${i.UniqueId}`,
			ts: new Date(Date.parse(i.Updated ?? "") || Date.now()).toISOString(),
			source: "calfire",
			layer: LAYER,
			title: `CAL FIRE · ${name} — ${Math.round(acres).toLocaleString("en-US")} ac, ${pct}% contained`,
			body: [i.Location, i.County && `${i.County} County`]
				.filter(Boolean)
				.join(" · "),
			url: i.Url || "https://www.fire.ca.gov/incidents",
			severity: calfireSeverity(acres, pct),
			confidence: 0.95,
			lat,
			lon,
			entities: { agency: "CAL FIRE", county: i.County ?? null },
			meta: {
				incident: true,
				acres,
				contained_pct: pct,
				started: i.Started ?? null,
				type: i.Type ?? null,
			},
		});
	}
	return rows;
}

/** "ALERT LEVEL: Advice <br />LOCATION: …" → {"alert level": "Advice", …} */
export function rfsFields(description: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of description.split(/<br\s*\/?>/i)) {
		const m = part.match(/^\s*([A-Z][A-Z ]+):\s*(.*?)\s*$/);
		if (m?.[1] && m[2] !== undefined) out[m[1].toLowerCase()] = m[2];
	}
	return out;
}

type Feature = { geometry?: unknown; properties?: Record<string, unknown> };

export function nswRfsRows(features: Feature[]): Row[] {
	const rows: Row[] = [];
	for (const f of features) {
		const p = f.properties ?? {};
		const guid = String(p.guid ?? "");
		const idNum = guid.match(/(\d+)\/?$/)?.[1];
		const at = pointOf(f.geometry);
		if (!idNum || !at) continue;
		const fields = rfsFields(String(p.description ?? ""));
		const level = String(p.category ?? "");
		// pubDate is "dd/mm/yyyy h:mm:ss AM" in UTC (matches UPDATED in AEST).
		const d = String(p.pubDate ?? "").match(
			/^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/,
		);
		const ts = d
			? Date.UTC(
					+d[3],
					+d[2] - 1,
					+d[1],
					(+d[4] % 12) + (d[7] === "PM" ? 12 : 0),
					+d[5],
					+d[6],
				)
			: Date.now();
		rows.push({
			id: `nsw-rfs:${idNum}`,
			ts: new Date(ts).toISOString(),
			source: "nsw-rfs",
			layer: LAYER,
			title: `NSW RFS · ${String(p.title ?? "Incident")} — ${level || "incident"}`,
			body: [fields.status, fields.type, fields.size, fields["council area"]]
				.filter(Boolean)
				.join(" · "),
			url: NSW_RFS_PAGE,
			severity: auWarningSeverity(level),
			confidence: 0.95,
			lat: at.lat,
			lon: at.lon,
			entities: { agency: "NSW RFS" },
			meta: {
				incident: true,
				alert_level: level || null,
				status: fields.status ?? null,
				fire_type: fields.type ?? null,
				size: fields.size ?? null,
				planned: level === "Planned Burn",
			},
		});
	}
	return rows;
}

const isVicFire = (p: Record<string, unknown>) =>
	p.category1 === "Fire" ||
	p.category1 === "Planned Burn" ||
	p.category2 === "Fire";

export function vicEmvRows(features: Feature[]): Row[] {
	const rows: Row[] = [];
	for (const f of features) {
		const p = f.properties ?? {};
		if (!isVicFire(p)) continue;
		const status = String(p.status ?? "");
		// "Safe" = the agency has closed it; the feed keeps it a while longer.
		if (p.feedType === "incident" && status.toLowerCase() === "safe") continue;
		const at = pointOf(f.geometry);
		if (!p.id || !at) continue;
		const warning = p.feedType === "warning";
		const level = String(p.name ?? p.category1 ?? "");
		rows.push({
			id: `vic-emv:${p.feedType}:${p.id}`,
			ts: new Date(
				Date.parse(String(p.updated ?? p.created ?? "")) || Date.now(),
			).toISOString(),
			source: "vic-emv",
			layer: LAYER,
			title: `VIC EMV · ${String(p.location ?? "Victoria")} — ${warning ? level : `${String(p.category1)} (${status})`}`,
			body: [p.webHeadline, p.sizeFmt].filter(Boolean).join(" · ") || undefined,
			url: VIC_EMV_PAGE,
			severity: warning
				? auWarningSeverity(level)
				: VIC_ACTIVE_STATUS.has(status.toLowerCase())
					? "watch"
					: "info",
			confidence: 0.9,
			lat: at.lat,
			lon: at.lon,
			entities: { agency: String(p.sourceOrg ?? "EMV") },
			meta: {
				incident: true,
				feed_type: p.feedType ?? null,
				status: status || null,
				planned: p.category1 === "Planned Burn",
			},
		});
	}
	return rows;
}

/** A changed payload shape must fail loudly, not prune the layer to empty. */
function features(j: unknown): Feature[] {
	const f = (j as { features?: unknown } | null)?.features;
	if (!Array.isArray(f)) throw new Error("unexpected payload: no features[]");
	return f as Feature[];
}

const SOURCES = [
	{
		source: "calfire",
		url: CALFIRE_URL,
		rows: (j: unknown) => {
			if (!Array.isArray(j)) throw new Error("unexpected payload: not a list");
			return calfireRows(j as CalfireIncident[]);
		},
	},
	{
		source: "nsw-rfs",
		url: NSW_RFS_URL,
		rows: (j: unknown) => nswRfsRows(features(j)),
	},
	{
		source: "vic-emv",
		url: VIC_EMV_URL,
		rows: (j: unknown) => vicEmvRows(features(j)),
	},
] as const;

export async function collect() {
	let n = 0;
	const errors: string[] = [];
	for (const s of SOURCES) {
		try {
			assertSafeUrl(s.url);
			const runStart = await dbClock();
			const res = await stealthFetch(s.url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json: unknown = await res.json();
			const rows = s.rows(json);
			await storeRaw(s.source, LAYER, res.status, { n: rows.length });
			for (const r of rows) await storeNormalized(r);
			// Zero incidents is a quiet fire season, not an outage (these
			// sources are NEVER_FROZEN in api/freeze.ts for that reason).
			await pruneStale(s.source, runStart);
			n += rows.length;
			await markHealth(s.source, true);
		} catch (e: unknown) {
			errors.push(`${s.source}: ${errMsg(e)}`);
			await markHealth(s.source, false, errMsg(e));
		}
	}
	const ok = errors.length < SOURCES.length;
	return ok ? { ok, count: n } : { ok, error: errors.join("; ") };
}

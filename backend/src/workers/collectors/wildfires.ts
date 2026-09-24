// Official wildfire incident feeds (keyless): named incidents with size,
// containment and the agency's own alert level, next to the FIRMS satellite
// hotspots on `fires`. Each source publishes its CURRENT picture, so an
// incident that closes leaves the map (pruneStale after a successful poll).
//   calfire  CAL FIRE active incidents — acres + % contained (California)
//   nsw-rfs  NSW Rural Fire Service major incidents — AU warning levels
//   vic-emv  Emergency Management Victoria — fire incidents + fire warnings
//   qld-fire Queensland Fire Department — bushfire warnings + incidents
//   wa-dfes  WA Dept of Fire & Emergency Services — bushfire incidents,
//            bushfire warnings and smoke alerts (other incident types skipped)
//   act-esa  ACT Emergency Services Agency GeoRSS — fire-agency items only
//            (the same feed carries every ambulance job)
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
const QLD_FIRE_URL =
	"https://publiccontent-gis-psba-qld-gov-au.s3.amazonaws.com/content/Feeds/BushfireCurrentIncidents/bushfireAlert.json";
const QLD_FIRE_PAGE = "https://www.fire.qld.gov.au/current-incidents";
const WA_INCIDENTS_URL = "https://api.emergency.wa.gov.au/v1/incidents";
const WA_WARNINGS_URL = "https://api.emergency.wa.gov.au/v1/warnings";
const WA_PAGE = "https://www.emergency.wa.gov.au/";
const ACT_ESA_URL = "https://www.esa.act.gov.au/feeds/currentincidents.xml";
const ACT_ESA_PAGE = "https://esa.act.gov.au/current-incidents";
/** ACT times are local; the feed's pubDate names the zone (AEST/AEDT). */
const ACT_ZONE_HOURS: Record<string, number> = { AEST: 10, AEDT: 11 };

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

type QldProps = {
	UniqueID?: string;
	WarningTitle?: string;
	WarningLevel?: string;
	WarningArea?: string | null;
	Header?: string;
	CurrentStatus?: string | null;
	GroupedType?: string;
	Locality?: string | null;
	Location?: string | null;
	Jurisdiction?: string | null;
	Latitude?: number;
	Longitude?: number;
	ItemDateTimeLocal_ISO?: string;
};

export function qldFireRows(features: Feature[]): Row[] {
	const rows: Row[] = [];
	for (const f of features) {
		const p = (f.properties ?? {}) as QldProps;
		if (!p.UniqueID) continue;
		const lat = Number(p.Latitude);
		const lon = Number(p.Longitude);
		const at =
			Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)
				? { lat, lon }
				: pointOf(f.geometry);
		if (!at) continue;
		const level = p.WarningLevel ?? "";
		// Warnings carry an area and a real title; incidents say "Information - ".
		const warning = !!p.WarningArea || p.UniqueID.startsWith("WARN");
		const place =
			[p.Locality, p.Location].find((x) => x && x !== "Unknown") ??
			p.Jurisdiction ??
			"Queensland";
		const kind = (p.GroupedType ?? "fire").toLowerCase();
		rows.push({
			id: `qld-fire:${p.UniqueID}`,
			ts: new Date(
				Date.parse(p.ItemDateTimeLocal_ISO ?? "") || Date.now(),
			).toISOString(),
			source: "qld-fire",
			layer: LAYER,
			title: warning
				? `QLD Fire · ${(p.WarningTitle ?? level).trim()}`
				: `QLD Fire · ${kind} — ${place}${p.CurrentStatus ? ` (${p.CurrentStatus})` : ""}`,
			body: warning ? p.Header?.slice(0, 2000) : undefined,
			url: QLD_FIRE_PAGE,
			severity: auWarningSeverity(level),
			confidence: 0.95,
			lat: at.lat,
			lon: at.lon,
			entities: { agency: "QLD Fire" },
			meta: {
				incident: !warning,
				alert_level: level || null,
				status: p.CurrentStatus ?? null,
				area: p.WarningArea ?? null,
			},
		});
	}
	return rows;
}

type WaItem = {
	id?: string;
	entitySubType?: string;
	"incident-type"?: string;
	"incident-status"?: string;
	suburbs?: string[];
	headline?: string;
	"alert-line"?: string;
	location?: { latitude?: number; longitude?: number };
	"geo-source"?: { features?: Feature[] };
	updatedAt?: string;
	"updated-date-time"?: string;
	"published-date-time"?: string;
};

const stripHtml = (s: string) =>
	s
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/** A WA item's marker: its own location, else the first Point it maps. */
function waPoint(i: WaItem) {
	const lat = Number(i.location?.latitude);
	const lon = Number(i.location?.longitude);
	if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
	const fs = i["geo-source"]?.features ?? [];
	const pt = fs.find(
		(f) => (f.geometry as { type?: string })?.type === "Point",
	);
	return pointOf((pt ?? fs[0])?.geometry);
}

/** "warnings_bushfire--watch-and-act" → "watch and act". */
export function waWarningLevel(subtype: string): string {
	if (subtype.includes("smoke")) return "smoke alert";
	return (subtype.split("--")[1] ?? "advice").replace(/-/g, " ");
}

export function waDfesRows(incidents: WaItem[], warnings: WaItem[]): Row[] {
	const rows: Row[] = [];
	const suburbs = (i: WaItem) => (i.suburbs ?? []).join(", ") || "WA";
	const ts = (i: WaItem) =>
		new Date(
			Date.parse(
				i.updatedAt ?? i["updated-date-time"] ?? i["published-date-time"] ?? "",
			) || Date.now(),
		).toISOString();
	for (const i of incidents) {
		if (i["incident-type"] !== "Bushfire" || !i.id) continue;
		const at = waPoint(i);
		if (!at) continue;
		const status = i["incident-status"] ?? "";
		rows.push({
			id: `wa-dfes:incident:${i.id}`,
			ts: ts(i),
			source: "wa-dfes",
			layer: LAYER,
			title: `WA DFES · Bushfire — ${suburbs(i)}${status ? ` (${status})` : ""}`,
			url: WA_PAGE,
			// Severity rides on the warnings DFES issues for serious fires.
			severity: "info",
			confidence: 0.9,
			lat: at.lat,
			lon: at.lon,
			entities: { agency: "DFES" },
			meta: { incident: true, status: status || null },
		});
	}
	for (const w of warnings) {
		const sub = w.entitySubType ?? "";
		if (!w.id || !/^warnings_(bushfire|smoke)/.test(sub)) continue;
		const at = waPoint(w);
		if (!at) continue;
		const level = waWarningLevel(sub);
		rows.push({
			id: `wa-dfes:warning:${w.id}`,
			ts: ts(w),
			source: "wa-dfes",
			layer: LAYER,
			title: `WA DFES · ${w.headline ?? `Bushfire ${level}`} — ${suburbs(w)}`,
			body: stripHtml(w["alert-line"] ?? "").slice(0, 2000) || undefined,
			url: WA_PAGE,
			severity: auWarningSeverity(level),
			confidence: 0.95,
			lat: at.lat,
			lon: at.lon,
			entities: { agency: "DFES" },
			meta: { incident: false, alert_level: level },
		});
	}
	return rows;
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "23 Sep 2026 19:49:20.82" local + zone hours → ISO UTC, or null. */
export function actLocalToIso(s: string, zoneHours: number): string | null {
	const m = s.match(
		/(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2})/,
	);
	const mon = m ? MONTHS.indexOf(m[2] ?? "") : -1;
	if (!m || mon < 0) return null;
	const utc =
		Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +m[6]) - zoneHours * 3600_000;
	return new Date(utc).toISOString();
}

export function actEsaRows(xml: string): Row[] {
	const zone = xml.match(/<pubDate>[^<]*\b(AEST|AEDT)\b/)?.[1] ?? "AEST";
	const hours = ACT_ZONE_HOURS[zone] ?? 10;
	const rows: Row[] = [];
	for (const [, b = ""] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
		const tag = (t: string) =>
			b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1]?.trim() ?? "";
		const agency = tag("agency");
		const type = tag("type");
		if (!/fire|rural/i.test(agency) && !/FIRE|BURN/.test(type)) continue;
		const [lat, lon] = tag("georss:point").split(/\s+/).map(Number);
		const guid = tag("guid");
		if (!guid || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		const desc = tag("description").replace(/&#xD;/g, "");
		const field = (k: string) =>
			desc.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
		const control = tag("controlStatus");
		const planned = /HAZARD REDUCTION|PLANNED/.test(type);
		rows.push({
			id: `act-esa:${guid}`,
			ts: actLocalToIso(field("Updated"), hours) ?? new Date().toISOString(),
			source: "act-esa",
			layer: LAYER,
			title: `ACT ESA · ${tag("title") || type}`,
			body: [field("Location"), field("Status")].filter(Boolean).join(" · "),
			url: ACT_ESA_PAGE,
			severity:
				!planned && /going|out of control|not yet/i.test(control)
					? "watch"
					: "info",
			confidence: 0.9,
			lat: lat as number,
			lon: lon as number,
			entities: { agency: `ACT ${agency}` },
			meta: { incident: true, status: control || null, planned, type },
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

async function getJson(
	url: string,
): Promise<{ status: number; json: unknown }> {
	assertSafeUrl(url);
	const res = await stealthFetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return { status: res.status, json: await res.json() };
}

function listAt<T>(j: unknown, key: string): T[] {
	const v = (j as Record<string, unknown> | null)?.[key];
	if (!Array.isArray(v)) throw new Error(`unexpected payload: no ${key}[]`);
	return v as T[];
}

type Load = () => Promise<{ status: number; rows: Row[] }>;

const SOURCES: Array<{ source: string; load: Load }> = [
	{
		source: "calfire",
		load: async () => {
			const { status, json } = await getJson(CALFIRE_URL);
			if (!Array.isArray(json))
				throw new Error("unexpected payload: not a list");
			return { status, rows: calfireRows(json as CalfireIncident[]) };
		},
	},
	{
		source: "nsw-rfs",
		load: async () => {
			const { status, json } = await getJson(NSW_RFS_URL);
			return { status, rows: nswRfsRows(features(json)) };
		},
	},
	{
		source: "vic-emv",
		load: async () => {
			const { status, json } = await getJson(VIC_EMV_URL);
			return { status, rows: vicEmvRows(features(json)) };
		},
	},
	{
		source: "qld-fire",
		load: async () => {
			const { status, json } = await getJson(QLD_FIRE_URL);
			return { status, rows: qldFireRows(features(json)) };
		},
	},
	{
		source: "wa-dfes",
		load: async () => {
			const inc = await getJson(WA_INCIDENTS_URL);
			const warn = await getJson(WA_WARNINGS_URL);
			return {
				status: inc.status,
				rows: waDfesRows(
					listAt<WaItem>(inc.json, "incidents"),
					listAt<WaItem>(warn.json, "warnings"),
				),
			};
		},
	},
	{
		source: "act-esa",
		load: async () => {
			assertSafeUrl(ACT_ESA_URL);
			const res = await stealthFetch(ACT_ESA_URL);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const xml = await res.text();
			if (!xml.includes("<rss")) throw new Error("unexpected payload: not RSS");
			return { status: res.status, rows: actEsaRows(xml) };
		},
	},
];

export async function collect() {
	let n = 0;
	const errors: string[] = [];
	for (const s of SOURCES) {
		try {
			const runStart = await dbClock();
			const { status, rows } = await s.load();
			await storeRaw(s.source, LAYER, status, { n: rows.length });
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

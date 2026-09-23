// FAA NAS status (keyless XML): ground stops, ground delay programs,
// arrival/departure delays and closures at US airports — the current
// picture, so airports that recover leave the map (pruneStale). Anchored
// on the airport catalog (static airports layer, by IATA/FAA code).
import { query } from "../../db/client.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import {
	dbClock,
	errMsg,
	markHealth,
	pruneStale,
	storeNormalized,
	storeRaw,
} from "../lib/store.js";

const URL_FAA = "https://nasstatus.faa.gov/api/airport-status-information";
const SOURCE = "faa-nas";

export type FaaKind = "ground-stop" | "ground-delay" | "delay" | "closure";
export type FaaStatus = {
	kind: FaaKind;
	arpt: string;
	reason: string;
	detail: string;
};

function unxml(s: string): string {
	return s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;|&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

const tag = (b: string, t: string) =>
	unxml(b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "");

/** Every status entry in the NAS XML, one per airport and kind. */
export function parseFaaStatus(xml: string): FaaStatus[] {
	const out: FaaStatus[] = [];
	const blocks: [FaaKind, RegExp][] = [
		["ground-stop", /<Ground_Stop_List>([\s\S]*?)<\/Ground_Stop_List>/g],
		["ground-delay", /<Ground_Delay_List>([\s\S]*?)<\/Ground_Delay_List>/g],
		[
			"delay",
			/<Arrival_Departure_Delay_List>([\s\S]*?)<\/Arrival_Departure_Delay_List>/g,
		],
		["closure", /<Airport_Closure_List>([\s\S]*?)<\/Airport_Closure_List>/g],
	];
	for (const [kind, re] of blocks)
		for (const list of xml.matchAll(re))
			for (const m of list[1].matchAll(
				/<(Program|Ground_Delay|Delay|Airport)>([\s\S]*?)<\/\1>/g,
			)) {
				const b = m[2];
				const arpt = tag(b, "ARPT").toUpperCase();
				if (!/^[A-Z0-9]{3,4}$/.test(arpt)) continue;
				let detail = "";
				if (kind === "ground-stop")
					detail = tag(b, "End_Time") && `until ${tag(b, "End_Time")}`;
				else if (kind === "ground-delay")
					detail = [
						tag(b, "Avg") && `avg ${tag(b, "Avg")}`,
						tag(b, "Max") && `max ${tag(b, "Max")}`,
					]
						.filter(Boolean)
						.join(" · ");
				else if (kind === "delay") {
					const ad = b.match(
						/<Arrival_Departure[^>]*Type="([^"]+)"[^>]*>([\s\S]*?)<\/Arrival_Departure>/,
					);
					detail = ad
						? `${ad[1].toLowerCase()} ${tag(ad[2], "Min")}–${tag(ad[2], "Max")}${tag(ad[2], "Trend") ? `, ${tag(ad[2], "Trend").toLowerCase()}` : ""}`
						: "";
				} else
					detail = [
						tag(b, "Start") && `from ${tag(b, "Start")}`,
						tag(b, "Reopen") && `reopens ${tag(b, "Reopen")}`,
					]
						.filter(Boolean)
						.join(" · ");
				out.push({ kind, arpt, reason: tag(b, "Reason"), detail });
			}
	return out;
}

const LABEL: Record<FaaKind, string> = {
	"ground-stop": "Ground stop",
	"ground-delay": "Ground delay program",
	delay: "Delays",
	closure: "Closed",
};

export function faaSeverity(k: FaaKind): "critical" | "watch" | "info" {
	return k === "ground-stop" ? "critical" : k === "delay" ? "info" : "watch";
}

export async function collect() {
	const layer = "airwx";
	try {
		const runStart = await dbClock();
		assertSafeUrl(URL_FAA);
		const res = await stealthFetch(
			URL_FAA,
			{ headers: { Accept: "application/xml" } },
			30000,
		);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const xml = await res.text();
		if (!/AIRPORT_STATUS_INFORMATION/i.test(xml))
			throw new Error("not an airport status document");
		const items = parseFaaStatus(xml);
		await storeRaw(SOURCE, layer, res.status, { n: items.length });
		const codes = [...new Set(items.map((i) => i.arpt))];
		const at = new Map(
			(
				await query<{ code: string; lat: number; lon: number; name: string }>(
					`SELECT DISTINCT ON (meta->>'iata') meta->>'iata' AS code,
					        (meta->>'lat')::float AS lat, (meta->>'lon')::float AS lon,
					        meta->>'name' AS name
					   FROM events WHERE layer='airports' AND meta->>'iata' = ANY($1)
					  ORDER BY meta->>'iata', (meta->>'country' = 'US') DESC`,
					[codes],
				)
			).map((r) => [r.code, r]),
		);
		const now = new Date().toISOString();
		for (const s of items) {
			const a = at.get(s.arpt);
			await storeNormalized({
				id: `faa:${s.kind}:${s.arpt}`,
				ts: now,
				source: SOURCE,
				layer,
				title:
					`${LABEL[s.kind]} · ${s.arpt}${a?.name ? ` ${a.name}` : ""}${s.reason ? ` — ${s.reason}` : ""}`.slice(
						0,
						280,
					),
				body: s.detail || undefined,
				url: "https://nasstatus.faa.gov/",
				severity: faaSeverity(s.kind),
				confidence: 0.95,
				lat: a?.lat,
				lon: a?.lon,
				entities: { airport: s.arpt },
				meta: { kind: s.kind, reason: s.reason, detail: s.detail },
			});
		}
		// A calm day is a valid picture: zero items still clears old ones.
		await pruneStale(SOURCE, runStart);
		await markHealth(SOURCE, true);
		return { ok: true, count: items.length };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

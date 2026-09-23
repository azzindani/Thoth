// NOAA tsunami warning centers (keyless Atom): NTWC (US/Canada coasts,
// PAAQ) and PTWC (Pacific/Caribbean/Hawaii, PHEB). Each entry is one
// bulletin for a source earthquake, located by geo:lat/geo:long. The
// bulletin category (Warning / Advisory / Watch / Threat / Information)
// sets severity. An empty feed is the normal state and stores a heartbeat.
import { createHash } from "node:crypto";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const CENTERS = [
	["ntwc", "https://www.tsunami.gov/events/xml/PAAQAtom.xml"],
	["ptwc", "https://www.tsunami.gov/events/xml/PHEBAtom.xml"],
] as const;

export type TsunamiEntry = {
	title: string;
	updated: string;
	link: string;
	lat: number | null;
	lon: number | null;
	summary: string;
};

function unxml(s: string): string {
	return s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

export function parseTsunamiAtom(xml: string): TsunamiEntry[] {
	const out: TsunamiEntry[] = [];
	for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/g)) {
		const b = m[0];
		const tag = (t: string) =>
			b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "";
		const point = tag("georss:point").trim().split(/\s+/).map(Number);
		const lat = Number(tag("geo:lat")) || (point.length === 2 ? point[0] : NaN);
		const lon =
			Number(tag("geo:long")) || (point.length === 2 ? point[1] : NaN);
		const link =
			b.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] ??
			b.match(/<link[^>]*href="([^"]+)"/)?.[1] ??
			"";
		const title = unxml(tag("title"));
		if (!title) continue;
		out.push({
			title,
			updated: unxml(tag("updated")),
			link,
			lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
			lon: Number.isFinite(lon) && lon !== 0 ? lon : null,
			summary: unxml(tag("summary") || tag("content")),
		});
	}
	return out;
}

export function tsunamiSeverity(text: string): "critical" | "watch" | "info" {
	const t = text.toLowerCase();
	if (
		/\b(warning|threat)\b/.test(t) &&
		!/no (tsunami )?(warning|threat)/.test(t)
	)
		return "critical";
	if (/\b(advisory|watch)\b/.test(t)) return "watch";
	return "info";
}

export async function collect() {
	const layer = "quakes";
	let n = 0;
	const errors: string[] = [];
	for (const [center, url] of CENTERS) {
		try {
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const entries = parseTsunamiAtom(await res.text());
			await storeRaw(center, layer, res.status, { n: entries.length });
			const C = center.toUpperCase();
			if (!entries.length) {
				await storeNormalized({
					id: `tsunami:${center}:quiet:${new Date().toISOString().slice(0, 10)}`,
					ts: new Date().toISOString(),
					source: center,
					layer,
					title: `${C}: no current tsunami bulletins`,
					severity: "info",
					confidence: 0.9,
					meta: { center, quiet: true },
				});
			}
			for (const e of entries) {
				const ts = Date.parse(e.updated);
				const cat =
					e.summary.match(
						/Category:?\s*(Warning|Advisory|Watch|Threat|Information)/i,
					)?.[1] ?? "";
				await storeNormalized({
					id: `tsunami:${center}:${createHash("md5")
						.update(e.link || `${e.title}|${e.updated}`)
						.digest("hex")}`,
					ts: Number.isNaN(ts)
						? new Date().toISOString()
						: new Date(ts).toISOString(),
					source: center,
					layer,
					title: `${C} · ${e.title}`.slice(0, 280),
					body: e.summary.slice(0, 2000) || undefined,
					url: e.link || "https://www.tsunami.gov/",
					severity: tsunamiSeverity(cat || e.title),
					confidence: 0.95,
					lat: e.lat ?? undefined,
					lon: e.lon ?? undefined,
					entities: { center: C },
					meta: { center, category: cat || null, tsunami: true },
				});
				n++;
			}
			await markHealth(center, true);
		} catch (e: unknown) {
			errors.push(`${center}: ${errMsg(e)}`);
			await markHealth(center, false, errMsg(e));
		}
	}
	const ok = errors.length < CENTERS.length;
	return ok ? { ok, count: n } : { ok, error: errors.join("; ") };
}

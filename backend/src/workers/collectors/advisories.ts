// US State Department travel advisories (keyless JSON): one record per
// country, "Title": "<Country> - Level N: <Advice>". Level 4 (Do Not
// Travel) is critical, 3 (Reconsider Travel) watch, 1–2 info. Anchored on
// the country's capital (lib/countries.ts); unmatched names are still
// stored (list/search), just without a map point.
import { z } from "zod";
import { locateCountry } from "../lib/countries.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const URL_US = "https://cadataapi.state.gov/api/TravelAdvisories";
const SOURCE = "state-travel";

const Adv = z
	.object({
		Title: z.string(),
		Link: z.string().nullish(),
		Category: z.array(z.string()).nullish(),
		Summary: z.string().nullish(),
		Published: z.string().nullish(),
		Updated: z.string().nullish(),
	})
	.passthrough();

/** "Burma (Myanmar) - Level 4: Do Not Travel" → parts; null if no level. */
export function parseAdvisoryTitle(
	title: string,
): { country: string; level: number; advice: string } | null {
	const m = title.match(/^(.*?)\s*[-–—]\s*Level\s*([1-4])\s*:?\s*(.*)$/i);
	if (!m) return null;
	return {
		country: m[1].replace(/\s*Travel Advisory\s*$/i, "").trim(),
		level: Number(m[2]),
		advice: m[3].trim(),
	};
}

export function advisorySeverity(level: number): "critical" | "watch" | "info" {
	return level >= 4 ? "critical" : level === 3 ? "watch" : "info";
}

function plain(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&#39;|&rsquo;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

export async function collect() {
	const layer = "advisories";
	try {
		assertSafeUrl(URL_US);
		const res = await stealthFetch(URL_US, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z.array(Adv).parse(await res.json());
		await storeRaw(SOURCE, layer, res.status, { n: rows.length });
		let n = 0;
		let located = 0;
		for (const r of rows) {
			const p = parseAdvisoryTitle(r.Title);
			if (!p) continue;
			const where = locateCountry(p.country);
			if (where) located++;
			const code = r.Category?.[0] ?? "";
			const slug = (where?.key ?? p.country)
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-");
			const ts = Date.parse(r.Updated ?? r.Published ?? "");
			await storeNormalized({
				id: `travel:us:${slug}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: SOURCE,
				layer,
				title:
					`US travel advisory L${p.level} · ${p.country}: ${p.advice}`.slice(
						0,
						280,
					),
				body: r.Summary ? plain(r.Summary).slice(0, 2000) : undefined,
				url: r.Link ?? "https://travel.state.gov/",
				severity: advisorySeverity(p.level),
				confidence: 0.95,
				lat: where?.lat,
				lon: where?.lon,
				entities: { country: p.country, code },
				meta: { level: p.level, advice: p.advice, issuer: "US" },
			});
			n++;
		}
		await markHealth(SOURCE, n > 0, n > 0 ? undefined : "no advisories parsed");
		return { ok: n > 0, count: n, located };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

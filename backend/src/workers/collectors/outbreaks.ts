// WHO Disease Outbreak News (keyless OData JSON on who.int): the newest
// DON reports, one row per report on the health layer, placed at the first
// named country's capital (multi-country reports list every country;
// "Multi-locations" stays unplaced). High-consequence pathogens → critical,
// every other DON → watch. Reports are kept after they scroll off.
import { z } from "zod";
import { locateCountry } from "../lib/countries.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const SOURCE = "who-don";
const API =
	"https://www.who.int/api/news/diseaseoutbreaknews?sf_culture=en&$top=30&$orderby=PublicationDateAndTime%20desc&$select=Title,UrlName,PublicationDateAndTime,DonId,Summary";
const ITEM_URL = "https://www.who.int/emergencies/disease-outbreak-news/item/";

const Don = z
	.object({
		Title: z.string(),
		UrlName: z.string().nullish(),
		DonId: z.string().nullish(),
		PublicationDateAndTime: z.string().nullish(),
		Summary: z.string().nullish(),
	})
	.passthrough();
const Page = z.object({ value: z.array(z.unknown()) }).passthrough();

const HIGH_CONSEQUENCE =
	/ebola|bundibugyo|sudan virus|marburg|nipah|plague|middle east respiratory|mers-cov|avian influenza|h5n1|h7n9|lassa|crimean-congo|smallpox/i;

export function donSeverity(title: string): "critical" | "watch" {
	return HIGH_CONSEQUENCE.test(title) ? "critical" : "watch";
}

/** WHO's formal names ("Kingdom of Saudi Arabia") fall back to the short one. */
function locate(place: string) {
	return (
		locateCountry(place) ??
		locateCountry(
			place.replace(
				/^(?:the\s+)?(?:Kingdom|Republic|State|Sultanate|Islamic Republic|Federal Republic) of\s+/i,
				"",
			),
		)
	);
}

/** "Nipah virus disease - India", "Marburg virus disease- Ethiopia",
 * "Ebola … – Democratic Republic of the Congo", "Ebola …, Democratic
 * Republic of the Congo & Uganda" → disease + place names. The last dash
 * (hyphen, en or em, followed by a space) wins over the last comma. */
export function splitDonTitle(title: string): {
	disease: string;
	places: string[];
} {
	const m =
		title.match(/^(.*\S)\s*[-–—]\s+(\S.*)$/) ??
		title.match(/^(.*\S),\s+(\S[^,]*)$/);
	if (!m) return { disease: title.trim(), places: [] };
	const tail = m[2].trim();
	// A single country whose name contains "and" stays whole.
	const places = locate(tail)
		? [tail]
		: tail
				.split(/\s*(?:&|,|\band\b)\s*/)
				.map((s) => s.trim())
				.filter(Boolean);
	return { disease: m[1].trim(), places };
}

const plain = (s: string) =>
	s
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();

export async function collect() {
	const layer = "health";
	try {
		assertSafeUrl(API);
		const res = await stealthFetch(API, {}, 30_000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const page = Page.parse(await res.json());
		const reports = page.value
			.map((x) => Don.safeParse(x))
			.flatMap((r) => (r.success ? [r.data] : []));
		await storeRaw(SOURCE, layer, res.status, { n: reports.length });
		// WHO always lists past reports; an empty page means the API moved.
		if (!reports.length) throw new Error("no reports parsed");
		for (const d of reports) {
			const ref = d.DonId ?? d.UrlName;
			if (!ref) continue;
			const { disease, places } = splitDonTitle(d.Title);
			const located = places
				.map((p) => ({ place: p, at: locate(p) }))
				.filter((x) => x.at);
			const ts = Date.parse(d.PublicationDateAndTime ?? "");
			await storeNormalized({
				id: `who-don:${ref}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: SOURCE,
				layer,
				title: d.Title.slice(0, 300),
				body: d.Summary ? plain(d.Summary).slice(0, 2000) : undefined,
				url: `${ITEM_URL}${encodeURIComponent(d.UrlName ?? ref)}`,
				severity: donSeverity(d.Title),
				confidence: 0.95,
				lon: located[0]?.at?.lon,
				lat: located[0]?.at?.lat,
				entities: { disease, countries: places },
				meta: { don: ref, placedAt: located[0]?.place ?? null },
			});
		}
		await markHealth(SOURCE, true);
		return { ok: true, count: reports.length };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

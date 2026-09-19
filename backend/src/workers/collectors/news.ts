import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// Free world-news bundle: keyless RSS/Atom, no signup, no key.
// GDELT stays as a second news source; this bundle is what makes news live when GDELT 429s.
const FEEDS: { source: string; url: string }[] = [
	{ source: "bbc", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
	{ source: "dw", url: "https://rss.dw.com/rdf/rss-en-all" },
	{ source: "france24", url: "https://www.france24.com/en/rss" },
	{
		source: "aljazeera",
		url: "https://www.aljazeera.com/xml/rss/all.xml",
	},
	{ source: "guardian", url: "https://www.theguardian.com/world/rss" },
	{
		source: "nyt-world",
		url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
	},
	{ source: "breakingdef", url: "https://breakingdefense.com/feed/" },
	{ source: "defenseone", url: "https://www.defenseone.com/rss/all/" },
	// WHO corporate news went quiet (last item Feb 2026) — ECDC epidemiological
	// updates carry the live outbreak load instead (Ebola/MERS, Sep 2026).
	// Mastodon/Flickr/social legs live in the social collector (news-adjacent).
	{
		source: "ecdc",
		url: "https://www.ecdc.europa.eu/en/taxonomy/term/1310/feed",
	},
	{
		source: "gnews",
		url: "https://news.google.com/rss/search?q=conflict%20OR%20airstrike%20OR%20earthquake%20OR%20flood&hl=en-US&gl=US&ceid=US%3Aen",
	},
	// WHO corporate news (140KB live): outbreak/statement releases.
	{
		source: "who-news",
		url: "https://www.who.int/rss-feeds/news-english.xml",
	},
];

export interface NewsItem {
	title: string;
	link: string;
	pubDate: string;
}

function clean(s: string): string {
	return s
		.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

export function parseRSS(xml: string, cap = 15): NewsItem[] {
	const items: NewsItem[] = [];
	// RSS 2.0 <item> blocks
	for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
		const b = m[0];
		const t = b.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "";
		const l =
			b.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1] ??
			b.match(/<link[^>]*href="([^"]+)"/)?.[1] ??
			"";
		const d = b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
		const title = clean(t);
		const link = clean(l);
		if (title && link) items.push({ title, link, pubDate: clean(d) });
		if (items.length >= cap) return items;
	}
	// Atom <entry> blocks
	for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/g)) {
		const b = m[0];
		const t = b.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "";
		const l = b.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
		const d =
			b.match(/<published[^>]*>([\s\S]*?)<\/published>/)?.[1] ??
			b.match(/<updated[^>]*>([\s\S]*?)<\/updated>/)?.[1] ??
			"";
		const title = clean(t);
		if (title && l) items.push({ title, link: l.trim(), pubDate: clean(d) });
		if (items.length >= cap) return items;
	}
	return items;
}

// Spaceflight News API (The Space Devs, keyless): launch/space coverage the
// wire RSS bundle misses — GNSS-jamming reports, pads, manifests.
const SNAPI_URL = "https://api.spaceflightnewsapi.net/v4/articles/?limit=15";

const SnapiArticle = z.object({
	id: z.union([z.string(), z.number()]).optional(),
	title: z.string().optional(),
	url: z.string().optional(),
	summary: z.string().nullable().optional(),
	published_at: z.string().optional(),
	news_site: z.string().optional(),
});

export async function collect() {
	const layer = "news";
	let n = 0;
	const errors: string[] = [];
	for (const f of FEEDS) {
		try {
			assertSafeUrl(f.url);
			const res = await stealthFetch(f.url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const xml = await res.text();
			const items = parseRSS(xml);
			await storeRaw(f.source, layer, res.status, { n: items.length });
			for (const a of items) {
				const ts = Date.parse(a.pubDate);
				await storeNormalized({
					id: `rss:${f.source}:${createHash("md5").update(a.link).digest("hex")}`,
					ts: Number.isNaN(ts)
						? new Date().toISOString()
						: new Date(ts).toISOString(),
					source: f.source,
					layer,
					title: a.title.slice(0, 300),
					url: a.link,
					severity: "info",
					confidence: 0.8,
					entities: {},
					meta: { feed: f.source },
				});
				n++;
			}
			await markHealth(f.source, true);
		} catch (e: unknown) {
			const msg = `${f.source}: ${errMsg(e)}`;
			errors.push(msg);
			await markHealth(f.source, false, msg);
		}
	}
	try {
		assertSafeUrl(SNAPI_URL);
		const res = await stealthFetch(SNAPI_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { results?: unknown };
		const arts = z.array(SnapiArticle).parse(json.results ?? []);
		await storeRaw("snapi", layer, res.status, { n: arts.length });
		for (const a of arts.slice(0, 15)) {
			if (!a.title) continue;
			const ts = Date.parse(a.published_at ?? "");
			await storeNormalized({
				id: `snapi:${String(a.id ?? createHash("md5").update(a.title).digest("hex"))}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "snapi",
				layer,
				title: a.title.slice(0, 300),
				body: (a.summary ?? "").slice(0, 300) || undefined,
				url: a.url,
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: { site: a.news_site },
			});
			n++;
		}
		await markHealth("snapi", true);
	} catch (e: unknown) {
		const msg = `snapi: ${errMsg(e)}`;
		errors.push(msg);
		await markHealth("snapi", false, msg);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

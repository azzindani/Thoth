import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// GDELT DOC 2.1, keyless. Artlist mode returns articles (no geo — geom stays null, like globenewslive brief feed).
const URL =
	"https://api.gdeltproject.org/api/v2/doc/doc?query=(protest%20OR%20conflict%20OR%20airstrike)&mode=artlist&maxrecords=50&format=json&timespan=24h&sort=datedesc";

const Article = z.object({
	seendate: z.string().optional(),
	title: z.string().optional(),
	url: z.string().optional(),
	domain: z.string().optional(),
	language: z.string().optional(),
});

export function parseSeen(s?: string): string {
	// "20260908T103000Z" -> ISO, fallback now
	if (s && /^\d{8}T\d{6}Z$/.test(s)) {
		const d = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
		const t = Date.parse(d);
		if (!Number.isNaN(t)) return new Date(t).toISOString();
	}
	return new Date().toISOString();
}

export async function collect() {
	const source = "gdelt";
	const layer = "news";
	let res: Response | null = null;
	let lastStatus = 0;
	try {
		assertSafeUrl(URL);
		for (let attempt = 0; attempt < 3; attempt++) {
			// GDELT DOC is slow + 429-prone: generous timeout, patient retries.
			res = await stealthFetch(URL, {}, 45000);
			lastStatus = res.status;
			if (res.ok) break;
			if (res.status === 429 && attempt < 2) {
				await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
				continue;
			}
			throw new Error(`HTTP ${res.status}`);
		}
		if (!res?.ok) throw new Error(`HTTP ${lastStatus}`);
		const json = (await res.json()) as { articles?: unknown };
		const articles = z.array(Article).parse(json.articles ?? []);
		await storeRaw(source, layer, res.status, { n: articles.length });
		let n = 0;
		for (const a of articles.slice(0, 50)) {
			if (!a.url || !a.title) continue;
			const id = `gdelt:${createHash("md5").update(a.url).digest("hex")}`;
			await storeNormalized({
				id,
				ts: parseSeen(a.seendate),
				source,
				layer,
				title: a.title,
				url: a.url,
				severity: "info",
				confidence: 0.6,
				entities: {},
				meta: { domain: a.domain, language: a.language },
			});
			n++;
		}
		await markHealth(source, true);
		return { ok: true, count: n };
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

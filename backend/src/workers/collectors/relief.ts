import { createHash } from "node:crypto";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { sleep } from "../lib/sleep.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";
import { parseRSS } from "./news.js";

// ReliefWeb updates RSS (API v2 needs a registered appname; RSS is open).
// Humanitarian/conflict reporting that wire RSS misses — shared `news` layer.
// OCHA + IFRC RSS (redirect to ?q=/rss.xml, then 200) carry the UN/agency load.
const URL = "https://reliefweb.int/updates/rss.xml";
const EXTRA: { source: string; url: string }[] = [
	{ source: "ocha", url: "https://www.unocha.org/rss.xml?q=/rss.xml" },
	{ source: "ifrc", url: "https://www.ifrc.org/rss.xml?q=/rss.xml" },
];
// OCHA answers 406 to fetch's default `Accept: */*` (2026-09-24) and 200 once
// the request asks for a feed — plain content negotiation, same for IFRC.
// Even then one of its AWS load-balancer nodes answers 406, and a kept-alive
// connection stays pinned to it (8/8 retries 406 on keep-alive, 200 within
// three tries with `Connection: close` — curl, a fresh connection each time,
// never saw it). So OCHA/IFRC requests close their connection, and a 406 is
// retried on a new one.
const FEED_ACCEPT = "application/rss+xml, application/xml;q=0.9, */*;q=0.8";
const RETRIES_ON_406 = 3;
const RETRY_PAUSE_MS = 3000;

async function fetchFeed(url: string): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await stealthFetch(url, {
			headers: { Accept: FEED_ACCEPT, Connection: "close" },
		});
		if (res.status !== 406 || attempt >= RETRIES_ON_406) return res;
		await res.arrayBuffer();
		await sleep(RETRY_PAUSE_MS);
	}
}

export async function collect() {
	const source = "reliefweb";
	const layer = "news";
	try {
		assertSafeUrl(URL);
		// ReliefWeb's WAF answers browser UAs with a 202 challenge page but serves this
		// public syndication feed to plain clients (verified: curl UA → 200 + 61KB RSS).
		const res = await stealthFetch(URL, {
			headers: { "User-Agent": "curl/8.5.0" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const items = parseRSS(await res.text(), 30);
		await storeRaw(source, layer, res.status, { n: items.length });
		let n = 0;
		for (const a of items) {
			const ts = Date.parse(a.pubDate);
			await storeNormalized({
				id: `relief:${createHash("md5").update(a.link).digest("hex")}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source,
				layer,
				title: a.title.slice(0, 300),
				url: a.link,
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: { feed: "reliefweb" },
			});
			n++;
		}
		await markHealth(source, true);
		const extra = await collectExtra();
		return { ok: true, count: n + extra };
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		const extra = await collectExtra();
		if (extra > 0) return { ok: true, count: extra };
		return { ok: false, error: errMsg(e) };
	}
}

async function collectExtra(): Promise<number> {
	let n = 0;
	for (const f of EXTRA) {
		try {
			assertSafeUrl(f.url);
			const res = await fetchFeed(f.url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const items = parseRSS(await res.text(), 15);
			await storeRaw(f.source, "news", res.status, { n: items.length });
			for (const a of items) {
				const ts = Date.parse(a.pubDate);
				await storeNormalized({
					id: `${f.source}:${createHash("md5").update(a.link).digest("hex")}`,
					ts: Number.isNaN(ts)
						? new Date().toISOString()
						: new Date(ts).toISOString(),
					source: f.source,
					layer: "news",
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
			await markHealth(f.source, false, errMsg(e));
		}
	}
	return n;
}

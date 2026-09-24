// National CERT advisories (keyless RSS/RDF/Atom): CERT-FR avis and
// alertes, CERT-EU security advisories, Canada's Cyber Centre (CCCS) alerts
// and advisories, JPCERT/CC security alerts. One row per advisory on the
// cyber layer (no geometry). In-the-wild exploitation → critical, alerts →
// watch, routine vendor advisories → info. The feeds are rolling windows,
// so rows are kept after they scroll off.
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

type Kind = "alert" | "advisory";
type Feed = {
	source: string;
	agency: string;
	country: string;
	url: string;
	/** Fixed kind, or read it per item (CCCS serials: AL alert, AV advisory). */
	kind: Kind | ((title: string) => Kind);
};

const FEEDS: Feed[] = [
	{
		source: "cert-fr",
		agency: "CERT-FR",
		country: "FR",
		url: "https://www.cert.ssi.gouv.fr/alerte/feed/",
		kind: "alert",
	},
	{
		source: "cert-fr",
		agency: "CERT-FR",
		country: "FR",
		url: "https://www.cert.ssi.gouv.fr/avis/feed/",
		kind: "advisory",
	},
	{
		source: "cert-eu",
		agency: "CERT-EU",
		country: "EU",
		url: "https://cert.europa.eu/publications/security-advisories-rss",
		kind: "alert",
	},
	{
		source: "cccs",
		agency: "CCCS",
		country: "CA",
		url: "https://www.cyber.gc.ca/api/cccs/atom/v1/get?feed=alerts_advisories&lang=en",
		kind: (title) => (/\bAL\d{2}-\d+/.test(title) ? "alert" : "advisory"),
	},
	{
		source: "jpcert",
		agency: "JPCERT/CC",
		country: "JP",
		url: "https://www.jpcert.or.jp/english/rss/jpcert-en.rdf",
		kind: "alert",
	},
];
const TIMEOUT_MS = 30_000;

export type FeedItem = {
	title: string;
	link: string;
	date: string;
	summary: string;
};

const NAMED: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** CDATA unwrapped, entities decoded (one pass), tags dropped, whitespace
 * collapsed. */
export function plain(s: string): string {
	return s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
			if (e[0] !== "#") return NAMED[e.toLowerCase()] ?? m;
			const n =
				e[1] === "x" || e[1] === "X"
					? Number.parseInt(e.slice(2), 16)
					: Number(e.slice(1));
			return Number.isFinite(n) && n > 0 && n <= 0x10ffff
				? String.fromCodePoint(n)
				: m;
		})
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

const tag = (block: string, name: string) =>
	block.match(
		new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`),
	)?.[1] ?? "";

/** RSS 2.0 / RDF items and Atom entries. Items without title or link drop. */
export function feedItems(xml: string): FeedItem[] {
	const out: FeedItem[] = [];
	for (const m of xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)) {
		const b = m[0];
		const link =
			plain(tag(b, "link")) || (b.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "");
		const title = plain(tag(b, "title"));
		if (!title || !link) continue;
		out.push({
			title,
			link,
			date: plain(
				tag(b, "pubDate") ||
					tag(b, "dc:date") ||
					tag(b, "published") ||
					tag(b, "updated"),
			),
			summary: (
				plain(tag(b, "description")) ||
				plain(tag(b, "summary")) ||
				plain(tag(b, "content"))
			).slice(0, 2000),
		});
	}
	return out;
}

/** RFC 822 or ISO stamp → ISO. CERT-EU writes European zone names. */
export function feedDate(s: string): string | null {
	const t = Date.parse(
		s.replace(/\sCEST$/, " +0200").replace(/\sCET$/, " +0100"),
	);
	return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const EXPLOITED =
	/actively exploited|(?:being|been) exploited|exploited in the wild|exploitation in the wild|active exploitation|activement exploitée|exploitation active/i;

export function certSeverity(
	kind: Kind,
	text: string,
): "critical" | "watch" | "info" {
	if (EXPLOITED.test(text)) return "critical";
	return kind === "alert" ? "watch" : "info";
}

/** Stable advisory reference: the link's last path segment
 * (CERTFR-2026-AVI-1175, 2026-013, …-av26-960, at260026). */
export function advisoryRef(link: string): string {
	const seg = link
		.replace(/[?#].*$/, "")
		.split("/")
		.filter(Boolean)
		.pop();
	return (seg ?? link).replace(/\.html?$/, "");
}

const cves = (s: string) => [...new Set(s.match(/CVE-\d{4}-\d{4,}/g) ?? [])];

export async function collect() {
	const layer = "cyber";
	const errors: string[] = [];
	const bySource = new Map<string, { n: number; errors: string[] }>();
	let total = 0;
	for (const f of FEEDS) {
		const tally = bySource.get(f.source) ?? { n: 0, errors: [] };
		bySource.set(f.source, tally);
		try {
			assertSafeUrl(f.url);
			const res = await stealthFetch(f.url, {}, TIMEOUT_MS);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const items = feedItems(await res.text());
			await storeRaw(f.source, layer, res.status, {
				url: f.url,
				n: items.length,
			});
			// Every agency feed carries items; none means the format moved.
			if (!items.length) throw new Error("no items parsed");
			for (const it of items) {
				const kind = typeof f.kind === "function" ? f.kind(it.title) : f.kind;
				const ref = advisoryRef(it.link);
				const text = `${it.title} ${it.summary}`;
				await storeNormalized({
					id: `${f.source}:${ref}`,
					ts: feedDate(it.date) ?? new Date().toISOString(),
					source: f.source,
					layer,
					title: it.title.slice(0, 300),
					body: it.summary || undefined,
					url: it.link,
					severity: certSeverity(kind, text),
					confidence: 0.95,
					entities: { cve: cves(text).slice(0, 20), agency: f.agency },
					meta: { ref, kind, agency: f.agency, country: f.country },
				});
				tally.n++;
				total++;
			}
		} catch (e: unknown) {
			const msg = `${new URL(f.url).pathname}: ${errMsg(e)}`;
			tally.errors.push(msg);
			errors.push(`${f.source} ${msg}`);
		}
	}
	for (const [source, t] of bySource) {
		const ok = t.errors.length === 0;
		await markHealth(source, ok, ok ? undefined : t.errors.join("; "));
	}
	const ok = total > 0;
	return ok ? { ok, count: total } : { ok, error: errors.join("; ") };
}

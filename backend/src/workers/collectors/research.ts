// Open research intel (all keyless): OpenAlex + Crossref + Europe PMC +
// arXiv (single query/day, backoff-honest) → `research` layer. Non-geo rows
// (ticker/counts/timeline pattern like fx): ts = publication date, digest
// budget covers the lag. Each upstream independent — one 429 never kills all.
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";
import { parseRSS } from "./news.js";

const TOPICS = [
	"cyber warfare",
	"autonomous weapons",
	"disinformation",
	"critical minerals",
	"subsea cables",
	"lunar exploration",
	"space debris",
];
const HEALTH_TOPICS = ["viral hemorrhagic fever", "mpox", "avian influenza"];

const OpenAlexWork = z
	.object({
		id: z.string().optional(),
		doi: z.string().nullable().optional(),
		title: z.string().nullable().optional(),
		publication_date: z.string().nullable().optional(),
		cited_by_count: z.number().nullable().optional(),
		authorships: z
			.array(
				z
					.object({
						author: z
							.object({ display_name: z.string().optional() })
							.passthrough(),
					})
					.passthrough(),
			)
			.optional(),
		primary_location: z
			.object({ landing_page_url: z.string().nullable().optional() })
			.passthrough()
			.optional(),
	})
	.passthrough();

const CrossrefWork = z
	.object({
		DOI: z.string().optional(),
		title: z.array(z.string()).optional(),
		published: z
			.object({ "date-parts": z.array(z.array(z.number())).optional() })
			.passthrough()
			.optional(),
		author: z
			.array(
				z
					.object({
						family: z.string().optional(),
						given: z.string().optional(),
					})
					.passthrough(),
			)
			.optional(),
		URL: z.string().optional(),
		"is-referenced-by-count": z.number().optional(),
	})
	.passthrough();

const EpmcPaper = z
	.object({
		id: z.string().optional(),
		title: z.string().nullable().optional(),
		authorString: z.string().nullable().optional(),
		pubYear: z.string().nullable().optional(),
		citedByCount: z.number().nullable().optional(),
		doi: z.string().nullable().optional(),
	})
	.passthrough();

function datePartsToTs(dp?: number[][]): string {
	const p = dp?.[0] ?? [];
	if (!p[0]) return new Date().toISOString();
	const m = String(p[1] ?? 1).padStart(2, "0");
	const d = String(p[2] ?? 1).padStart(2, "0");
	return `${p[0]}-${m}-${d}T00:00:00Z`;
}

export async function collect() {
	const layer = "research";
	let n = 0;
	const errors: string[] = [];

	// OpenAlex: scholarly works, keyless, polite single-topic pages.
	try {
		let stored = 0;
		for (const q of TOPICS) {
			const url =
				`https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
				`&per-page=5&sort=publication_date:desc&select=id,title,doi,publication_date,cited_by_count,authorships,primary_location`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} for ${q}`);
			const j = (await res.json()) as { results?: unknown[] };
			const works = z.array(OpenAlexWork).parse(j.results ?? []);
			await storeRaw("openalex", layer, res.status, { q, n: works.length });
			for (const w of works) {
				const title = (w.title ?? "").slice(0, 280);
				if (!title || !w.id) continue;
				const oid = w.id.split("/").pop() ?? w.id;
				const authors = (w.authorships ?? [])
					.slice(0, 3)
					.map((a) => a.author.display_name ?? "?")
					.join(", ");
				await storeNormalized({
					id: `openalex:${oid}`,
					ts: w.publication_date
						? `${w.publication_date}T00:00:00Z`
						: new Date().toISOString(),
					source: "openalex",
					layer,
					title,
					body: `${authors} · ${w.cited_by_count ?? 0} cites · ${q}`.slice(
						0,
						300,
					),
					url: w.primary_location?.landing_page_url ?? w.doi ?? undefined,
					severity: "info",
					confidence: 0.8,
					entities: {},
					meta: { topic: q, cites: w.cited_by_count ?? 0, doi: w.doi },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("openalex", true);
	} catch (e: unknown) {
		errors.push(`openalex: ${errMsg(e)}`);
		await markHealth("openalex", false, errors[errors.length - 1]);
	}

	// Crossref: publisher metadata mirror, keyless at daily rate.
	try {
		let stored = 0;
		for (const q of TOPICS) {
			const url =
				`https://api.crossref.org/works?query=${encodeURIComponent(q)}` +
				`&rows=5&sort=published&order=desc&select=DOI,title,published,author,URL,is-referenced-by-count`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} for ${q}`);
			const j = (await res.json()) as { message?: { items?: unknown[] } };
			const items = z.array(CrossrefWork).parse(j.message?.items ?? []);
			await storeRaw("crossref", layer, res.status, { q, n: items.length });
			for (const w of items) {
				const title = (w.title?.[0] ?? "").slice(0, 280);
				if (!title || !w.DOI) continue;
				await storeNormalized({
					id: `crossref:${w.DOI.toLowerCase()}`,
					ts: datePartsToTs(w.published?.["date-parts"]),
					source: "crossref",
					layer,
					title,
					body: `${(w.author ?? [])
						.slice(0, 3)
						.map((a) => a.family ?? "?")
						.join(
							", ",
						)} · ${w["is-referenced-by-count"] ?? 0} refs · ${q}`.slice(0, 300),
					url: w.URL,
					severity: "info",
					confidence: 0.8,
					entities: {},
					meta: {
						topic: q,
						doi: w.DOI,
						refs: w["is-referenced-by-count"] ?? 0,
					},
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("crossref", true);
	} catch (e: unknown) {
		errors.push(`crossref: ${errMsg(e)}`);
		await markHealth("crossref", false, errors[errors.length - 1]);
	}

	// Europe PMC: outbreak-literature watch, keyless, generous quota.
	try {
		let stored = 0;
		for (const q of HEALTH_TOPICS) {
			const url =
				`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}` +
				`&format=json&pageSize=5&sort=PUB_YEAR%20desc`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} for ${q}`);
			const j = (await res.json()) as { resultList?: { result?: unknown[] } };
			const papers = z.array(EpmcPaper).parse(j.resultList?.result ?? []);
			await storeRaw("epmc", layer, res.status, { q, n: papers.length });
			for (const p of papers) {
				const title = (p.title ?? "").slice(0, 280);
				if (!title || !p.id) continue;
				await storeNormalized({
					id: `epmc:${p.id}`,
					ts: p.pubYear
						? `${p.pubYear}-06-15T00:00:00Z`
						: new Date().toISOString(),
					source: "epmc",
					layer,
					title,
					body: `${(p.authorString ?? "").slice(0, 120)} · ${p.citedByCount ?? 0} cites · ${q}`.slice(
						0,
						300,
					),
					url: p.doi ? `https://doi.org/${p.doi}` : undefined,
					severity: "info",
					confidence: 0.8,
					entities: {},
					meta: { topic: q, year: p.pubYear, cites: p.citedByCount ?? 0 },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("epmc", true);
	} catch (e: unknown) {
		errors.push(`epmc: ${errMsg(e)}`);
		await markHealth("epmc", false, errors[errors.length - 1]);
	}

	// arXiv: one query/day (their 429 is per-second rate, not daily quota).
	// parseRSS reuse from news.js — Atom <entry> blocks.
	try {
		const url =
			`https://export.arxiv.org/api/query?search_query=${encodeURIComponent("all:cyberwarfare OR all:autonomous weapons")}` +
			`&sortBy=submitted&sortOrder=descending&max_results=10`;
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const items = parseRSS(await res.text(), 10);
		await storeRaw("arxiv", layer, res.status, { n: items.length });
		let stored = 0;
		for (const it of items) {
			const m = it.link.match(/abs\/([\d.]+v?\d*)/);
			if (!m) continue;
			const ts = Date.parse(it.pubDate);
			await storeNormalized({
				id: `arxiv:${m[1]}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "arxiv",
				layer,
				title: it.title.slice(0, 280),
				url: it.link,
				severity: "info",
				confidence: 0.75,
				entities: {},
				meta: { venue: "arxiv" },
			});
			stored++;
		}
		n += stored;
		await markHealth("arxiv", true);
	} catch (e: unknown) {
		errors.push(`arxiv: ${errMsg(e)}`);
		await markHealth("arxiv", false, errors[errors.length - 1]);
	}

	// Zenodo open records per outbreak topic (OpenAIRE-adjacent EU leg).
	try {
		let stored = 0;
		for (const q of HEALTH_TOPICS.slice(0, 2)) {
			const url = `https://zenodo.org/api/records?q=${encodeURIComponent(q)}&size=5`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} zenodo/${q}`);
			const j = (await res.json()) as {
				hits?: {
					hits?: {
						id?: number;
						title?: string;
						doi?: string;
						publication_date?: string | null;
					}[];
				};
			};
			const hits = j.hits?.hits ?? [];
			await storeRaw("zenodo", layer, res.status, { q, n: hits.length });
			for (const h of hits) {
				if (!h.id || !h.title) continue;
				await storeNormalized({
					id: `zenodo:${h.id}`,
					ts: h.publication_date ?? new Date().toISOString(),
					source: "zenodo",
					layer,
					title: h.title.slice(0, 280),
					url: h.doi ? `https://doi.org/${h.doi}` : undefined,
					severity: "info",
					confidence: 0.7,
					entities: {},
					meta: { topic: q, doi: h.doi ?? null },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("zenodo", true);
	} catch (e: unknown) {
		errors.push(`zenodo: ${errMsg(e)}`);
		await markHealth("zenodo", false, errors[errors.length - 1]);
	}

	// HAL French open archive per outbreak topic (label_s + uri_s fields).
	try {
		let stored = 0;
		for (const q of HEALTH_TOPICS.slice(0, 2)) {
			const url = `https://api.archives-ouvertes.fr/search/?q=${encodeURIComponent(q)}&rows=5&wt=json`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} hal/${q}`);
			const j = (await res.json()) as {
				response?: {
					docs?: { docid?: string; label_s?: string; uri_s?: string }[];
				};
			};
			const docs = j.response?.docs ?? [];
			await storeRaw("hal", layer, res.status, { q, n: docs.length });
			for (const d of docs) {
				if (!d.docid || !d.label_s) continue;
				await storeNormalized({
					id: `hal:${d.docid}`,
					ts: new Date().toISOString(),
					source: "hal",
					layer,
					title: d.label_s.slice(0, 280),
					url: d.uri_s,
					severity: "info",
					confidence: 0.7,
					entities: {},
					meta: { topic: q },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("hal", true);
	} catch (e: unknown) {
		errors.push(`hal: ${errMsg(e)}`);
		await markHealth("hal", false, errors[errors.length - 1]);
	}

	// INSPIRE-HEP literature per tech topic (title search, size 3).
	try {
		let stored = 0;
		for (const q of TOPICS.slice(0, 2)) {
			const url = `https://inspirehep.net/api/literature?q=${encodeURIComponent(`title:${q}`)}&size=3`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} inspire/${q}`);
			const j = (await res.json()) as {
				hits?: {
					hits?: {
						id?: string;
						metadata?: {
							titles?: { title?: string }[];
							dois?: { value?: string }[];
						};
					}[];
				};
			};
			const hits = j.hits?.hits ?? [];
			await storeRaw("inspire", layer, res.status, { q, n: hits.length });
			for (const h of hits) {
				const title = h.metadata?.titles?.[0]?.title ?? "";
				if (!title || !h.id) continue;
				const doi = h.metadata?.dois?.[0]?.value;
				await storeNormalized({
					id: `inspire:${h.id}`,
					ts: new Date().toISOString(),
					source: "inspire",
					layer,
					title: title.slice(0, 280),
					url: doi ? `https://doi.org/${doi}` : undefined,
					severity: "info",
					confidence: 0.7,
					entities: {},
					meta: { topic: q },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("inspire", true);
	} catch (e: unknown) {
		errors.push(`inspire: ${errMsg(e)}`);
		await markHealth("inspire", false, errors[errors.length - 1]);
	}

	// CORE papers per outbreak topic (keyless v3, no key): title + year.
	try {
		let stored = 0;
		for (const q of HEALTH_TOPICS.slice(0, 2)) {
			const url = `https://api.core.ac.uk/v3/search/works/?q=${encodeURIComponent(q)}&limit=3`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} core/${q}`);
			const j = (await res.json()) as {
				results?: {
					id?: number;
					title?: string;
					doi?: string;
					yearPublished?: number;
				}[];
			};
			const rows = j.results ?? [];
			await storeRaw("core", layer, res.status, { q, n: rows.length });
			for (const r of rows) {
				if (!r.title || !r.id) continue;
				await storeNormalized({
					id: `core:${r.id}`,
					ts: r.yearPublished
						? `${r.yearPublished}-06-15T00:00:00Z`
						: new Date().toISOString(),
					source: "core",
					layer,
					title: r.title.slice(0, 280),
					url: r.doi ? `https://doi.org/${r.doi}` : undefined,
					severity: "info",
					confidence: 0.7,
					entities: {},
					meta: { topic: q, year: r.yearPublished ?? null },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("core", true);
	} catch (e: unknown) {
		errors.push(`core: ${errMsg(e)}`);
		await markHealth("core", false, errors[errors.length - 1]);
	}
	// Figshare latest articles (keyless v2, no query path): newest datasets.
	try {
		const url = "https://api.figshare.com/v2/articles?page_size=5";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status} figshare`);
		const rows = (await res.json()) as {
			id?: number;
			title?: string;
			doi?: string;
			published_date?: string;
			defined_type_name?: string;
		}[];
		await storeRaw("figshare", layer, res.status, { n: rows.length });
		let stored = 0;
		for (const r of rows) {
			if (!r.title || !r.id) continue;
			await storeNormalized({
				id: `figshare:${r.id}`,
				ts: r.published_date ?? new Date().toISOString(),
				source: "figshare",
				layer,
				title: r.title.slice(0, 280),
				url: r.doi ? `https://doi.org/${r.doi}` : undefined,
				severity: "info",
				confidence: 0.65,
				entities: {},
				meta: { kind: r.defined_type_name ?? null },
			});
			stored++;
		}
		n += stored;
		await markHealth("figshare", true);
	} catch (e: unknown) {
		errors.push(`figshare: ${errMsg(e)}`);
		await markHealth("figshare", false, errors[errors.length - 1]);
	}

	// OpenAIRE EU publications per outbreak topic (keyless): nested OAF
	// metadata — title[]/dateofacceptance/pid arrays with $ payloads.
	try {
		let stored = 0;
		for (const q of HEALTH_TOPICS.slice(0, 2)) {
			const url = `https://api.openaire.eu/search/publications?size=3&format=json&title=${encodeURIComponent(q)}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} openaire/${q}`);
			const j = (await res.json()) as {
				response?: {
					results?: {
						result?: {
							header?: { "dri:objIdentifier"?: { $?: string } };
							metadata?: {
								"oaf:entity"?: {
									"oaf:result"?: {
										title?: { $?: string }[];
										dateofacceptance?: { $?: string };
										pid?: { $?: string }[];
									};
								};
							};
						}[];
					};
				};
			};
			const rows = j.response?.results?.result ?? [];
			await storeRaw("openaire", layer, res.status, { q, n: rows.length });
			for (const r of rows) {
				const ent = r.metadata?.["oaf:entity"]?.["oaf:result"];
				const title = (ent?.title?.[0]?.$ ?? "").slice(0, 280);
				if (!title) continue;
				const doi =
					(ent?.pid ?? []).map((p) => p.$ ?? "").find((s) => s.includes("/")) ??
					null;
				const date = ent?.dateofacceptance?.$ ?? null;
				const oid = r.header?.["dri:objIdentifier"]?.$ ?? title;
				await storeNormalized({
					id: `openaire:${createHash("md5").update(oid).digest("hex").slice(0, 16)}`,
					ts: date ?? new Date().toISOString(),
					source: "openaire",
					layer,
					title,
					url: doi ? `https://doi.org/${doi}` : undefined,
					severity: "info",
					confidence: 0.65,
					entities: {},
					meta: { topic: q, doi },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("openaire", true);
	} catch (e: unknown) {
		errors.push(`openaire: ${errMsg(e)}`);
		await markHealth("openaire", false, errors[errors.length - 1]);
	}

	// Yahoo symbol search (keyless, fincept digest 2026-09-17): ticker →
	// exchange + sector + industry — the security-master seed leg. Fixed
	// watchlist (AAPL/MSFT/NVDA/TSLA) so rows are deterministic.
	for (const sym of ["AAPL", "MSFT", "NVDA", "TSLA"] as const) {
		try {
			const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${sym}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${sym}`);
			const j = (await res.json()) as {
				quotes?: {
					symbol?: string;
					shortname?: string;
					exchDisp?: string;
					sectorDisp?: string;
					industry?: string;
					quoteType?: string;
				}[];
			};
			const q0 = (j.quotes ?? []).find((x) => x.symbol === sym);
			await storeRaw("yahoo-search", layer, res.status, { sym });
			if (!q0?.shortname) throw new Error(`no quote ${sym}`);
			await storeNormalized({
				id: `yseek:${sym}`,
				ts: new Date().toISOString(),
				source: "yahoo-search",
				layer,
				title: `${sym}: ${q0.shortname} (${q0.exchDisp ?? "?"} · ${q0.sectorDisp ?? "?"} · ${q0.industry ?? "?"})`,
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: {
					symbol: sym,
					name: q0.shortname,
					exchange: q0.exchDisp ?? null,
					sector: q0.sectorDisp ?? null,
					industry: q0.industry ?? null,
					type: q0.quoteType ?? null,
				},
			});
			n++;
			await markHealth("yahoo-search", true);
		} catch (e: unknown) {
			errors.push(`yahoo-search/${sym}: ${errMsg(e)}`);
			await markHealth("yahoo-search", false, errors[errors.length - 1]);
		}
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

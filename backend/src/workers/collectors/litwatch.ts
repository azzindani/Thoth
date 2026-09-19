// Outbreak/tech-literature watch (all keyless): ClinicalTrials.gov v2 studies +
// PubMed E-utilities counts + HN Algolia tech stories + DOAJ open-access +
// DataCite datasets + OpenAIRE EU mirror → `research` layer. Europe PMC covers
// abstracts; these cover trials, counts, datasets, and hacker mindshare.
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";
import { parseRSS } from "./news.js";

const TRIAL_TOPICS = ["ebola", "mpox", "avian influenza"];
const TECH_TOPICS = ["drone", "satellite", "ransomware"];

const Study = z
	.object({
		protocolSection: z
			.object({
				identificationModule: z
					.object({
						nctId: z.string().optional(),
						briefTitle: z.string().nullable().optional(),
						organization: z
							.object({ fullName: z.string().nullable().optional() })
							.passthrough()
							.optional(),
					})
					.passthrough()
					.optional(),
				statusModule: z
					.object({ overallStatus: z.string().nullable().optional() })
					.passthrough()
					.optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

const HnHit = z
	.object({
		objectID: z.string().optional(),
		title: z.string().nullable().optional(),
		url: z.string().nullable().optional(),
		points: z.number().nullable().optional(),
		created_at: z.string().optional(),
	})
	.passthrough();

export async function collect() {
	const layer = "research";
	let n = 0;
	const errors: string[] = [];

	// ClinicalTrials.gov: newest trials per outbreak topic.
	try {
		let stored = 0;
		for (const q of TRIAL_TOPICS) {
			const url =
				`https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(q)}` +
				`&pageSize=5&sort=LastUpdatePostDate&format=json`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} for ${q}`);
			const j = (await res.json()) as { studies?: unknown[] };
			const studies = z.array(Study).parse(j.studies ?? []);
			await storeRaw("trials", layer, res.status, { q, n: studies.length });
			for (const s of studies) {
				const idm = s.protocolSection?.identificationModule;
				const title = (idm?.briefTitle ?? "").slice(0, 280);
				if (!title || !idm?.nctId) continue;
				await storeNormalized({
					id: `trial:${idm.nctId}`,
					ts: new Date().toISOString(),
					source: "trials",
					layer,
					title,
					body: `${idm.organization?.fullName ?? "?"} · ${s.protocolSection?.statusModule?.overallStatus ?? "?"} · ${q}`.slice(
						0,
						300,
					),
					url: `https://clinicaltrials.gov/study/${idm.nctId}`,
					severity: "info",
					confidence: 0.8,
					entities: {},
					meta: { nct: idm.nctId, topic: q },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("trials", true);
	} catch (e: unknown) {
		errors.push(`trials: ${errMsg(e)}`);
		await markHealth("trials", false, errors[errors.length - 1]);
	}

	// PubMed: count-only rows (thesis: literature volume IS the signal).
	try {
		let stored = 0;
		for (const q of TRIAL_TOPICS) {
			const url =
				`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed` +
				`&term=${encodeURIComponent(q)}&retmode=json&retmax=1`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} for ${q}`);
			const j = (await res.json()) as {
				esearchresult?: { count?: string; idlist?: string[] };
			};
			const count = Number(j.esearchresult?.count ?? NaN);
			if (!Number.isFinite(count)) continue;
			await storeRaw("pubmed", layer, res.status, { q, count });
			await storeNormalized({
				id: `pubmed:${q.replace(/[^a-z]+/gi, "-")}`,
				ts: new Date().toISOString(),
				source: "pubmed",
				layer,
				title: `PubMed: ${count.toLocaleString("en-US")} papers on ${q}`,
				severity: "info",
				confidence: 0.8,
				entities: {},
				meta: { topic: q, papers: count },
			});
			stored++;
		}
		n += stored;
		await markHealth("pubmed", true);
	} catch (e: unknown) {
		errors.push(`pubmed: ${errMsg(e)}`);
		await markHealth("pubmed", false, errors[errors.length - 1]);
	}

	// HN Algolia: top tech stories per topic (points = mindshare weight).
	try {
		let stored = 0;
		for (const q of TECH_TOPICS) {
			const url =
				`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}` +
				`&tags=story&hitsPerPage=5`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} for ${q}`);
			const j = (await res.json()) as { hits?: unknown[] };
			const hits = z.array(HnHit).parse(j.hits ?? []);
			await storeRaw("hn", layer, res.status, { q, n: hits.length });
			for (const h of hits) {
				const title = (h.title ?? "").slice(0, 280);
				if (!title || !h.objectID) continue;
				await storeNormalized({
					id: `hn:${h.objectID}`,
					ts: h.created_at ?? new Date().toISOString(),
					source: "hn",
					layer,
					title,
					url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
					severity: "info",
					confidence: 0.7,
					entities: {},
					meta: { topic: q, points: h.points ?? 0 },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("hn", true);
	} catch (e: unknown) {
		errors.push(`hn: ${errMsg(e)}`);
		await markHealth("hn", false, errors[errors.length - 1]);
	}

	// StackExchange votes-sorted per tech topic: practitioner Q&A signal.
	try {
		let stored = 0;
		for (const q of TECH_TOPICS.slice(0, 2)) {
			const url = `https://api.stackexchange.com/2.3/search?order=desc&sort=votes&intitle=${encodeURIComponent(q)}&site=stackoverflow&pagesize=3`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} for ${q}`);
			const j = (await res.json()) as {
				items?: {
					title?: string;
					link?: string;
					score?: number;
					answer_count?: number;
				}[];
			};
			const items = j.items ?? [];
			await storeRaw("stack", layer, res.status, { q, n: items.length });
			for (const x of items) {
				if (!x.title || !x.link) continue;
				await storeNormalized({
					id: `stack:${createHash("md5").update(x.link).digest("hex")}`,
					ts: new Date().toISOString(),
					source: "stack",
					layer,
					title: x.title.slice(0, 280),
					url: x.link,
					severity: "info",
					confidence: 0.7,
					entities: {},
					meta: { topic: q, score: x.score ?? 0, answers: x.answer_count ?? 0 },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("stack", true);
	} catch (e: unknown) {
		errors.push(`stack: ${errMsg(e)}`);
		await markHealth("stack", false, errors[errors.length - 1]);
	}

	// DOAJ: open-access articles per outbreak topic (article-level detail).
	try {
		let stored = 0;
		for (const q of TRIAL_TOPICS) {
			const url = `https://doaj.org/api/search/articles/${encodeURIComponent(q)}?pageSize=5`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} for ${q}`);
			const j = (await res.json()) as {
				results?: {
					bibjson?: {
						title?: string;
						journal?: { title?: string };
						year?: string;
						identifier?: { id?: string; type?: string }[];
					};
				}[];
			};
			const results = j.results ?? [];
			await storeRaw("doaj", layer, res.status, { q, n: results.length });
			for (const r of results) {
				const b = r.bibjson;
				const title = (b?.title ?? "").slice(0, 280);
				if (!title) continue;
				const doi = b?.identifier?.find((x) => x.type === "doi")?.id;
				await storeNormalized({
					id: `doaj:${(doi ?? title)
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.slice(0, 100)}`,
					ts: b?.year ? `${b.year}-06-15T00:00:00Z` : new Date().toISOString(),
					source: "doaj",
					layer,
					title,
					url: doi ? `https://doi.org/${doi}` : undefined,
					severity: "info",
					confidence: 0.75,
					entities: {},
					meta: { topic: q, journal: b?.journal?.title, year: b?.year },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("doaj", true);
	} catch (e: unknown) {
		errors.push(`doaj: ${errMsg(e)}`);
		await markHealth("doaj", false, errors[errors.length - 1]);
	}

	// DataCite: datasets per outbreak topic (data behind the papers).
	try {
		let stored = 0;
		for (const q of TRIAL_TOPICS) {
			const url = `https://api.datacite.org/dois?query=${encodeURIComponent(q)}&page[size]=5`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} for ${q}`);
			const j = (await res.json()) as {
				data?: {
					id?: string;
					attributes?: {
						titles?: { title?: string }[];
						publicationYear?: number;
					};
				}[];
			};
			const items = j.data ?? [];
			await storeRaw("datacite", layer, res.status, { q, n: items.length });
			for (const d of items) {
				const title = (d.attributes?.titles?.[0]?.title ?? "").slice(0, 280);
				if (!title || !d.id) continue;
				await storeNormalized({
					id: `datacite:${d.id
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.slice(0, 100)}`,
					ts: d.attributes?.publicationYear
						? `${d.attributes.publicationYear}-06-15T00:00:00Z`
						: new Date().toISOString(),
					source: "datacite",
					layer,
					title,
					url: `https://doi.org/${d.id}`,
					severity: "info",
					confidence: 0.75,
					entities: {},
					meta: { topic: q, doi: d.id },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("datacite", true);
	} catch (e: unknown) {
		errors.push(`datacite: ${errMsg(e)}`);
		await markHealth("datacite", false, errors[errors.length - 1]);
	}

	// medRxiv preprints per outbreak topic (health preprint pulse).
	try {
		let stored = 0;
		for (const q of TRIAL_TOPICS.slice(0, 2)) {
			const url = `https://api.medrxiv.org/details/medrxiv/2026-08-01/2026-09-16/0/5`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} medrxiv`);
			const j = (await res.json()) as {
				collection?: {
					doi?: string;
					title?: string;
					date?: string;
					category?: string;
				}[];
			};
			const items = (j.collection ?? []).filter((p) =>
				`${p.title ?? ""} ${p.category ?? ""}`
					.toLowerCase()
					.includes(q.split(" ")[0]),
			);
			await storeRaw("medrxiv", layer, res.status, { q, n: items.length });
			for (const p of items.slice(0, 5)) {
				if (!p.doi || !p.title) continue;
				await storeNormalized({
					id: `medrxiv:${p.doi
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.slice(0, 100)}`,
					ts: p.date ?? new Date().toISOString(),
					source: "medrxiv",
					layer,
					title: p.title.slice(0, 280),
					url: `https://doi.org/${p.doi}`,
					severity: "info",
					confidence: 0.7,
					entities: {},
					meta: { topic: q, category: p.category ?? null },
				});
				stored++;
			}
		}
		n += stored;
		await markHealth("medrxiv", true);
	} catch (e: unknown) {
		errors.push(`medrxiv: ${errMsg(e)}`);
		await markHealth("medrxiv", false, errors[errors.length - 1]);
	}

	// PubMed latest-article titles (esearch idlist → esummary): newest
	// paper per topic with journal + date — the freshness leg next to the
	// count-only PubMed rows above.
	try {
		let stored = 0;
		for (const q of ["avian influenza", "ebola", "measles"]) {
			const sUrl =
				`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed` +
				`&term=${encodeURIComponent(q)}&retmode=json&retmode=json&retmax=1&sort=date`;
			assertSafeUrl(sUrl);
			const sRes = await stealthFetch(sUrl);
			if (!sRes.ok) throw new Error(`HTTP ${sRes.status} for ${q}`);
			const sJ = (await sRes.json()) as {
				esearchresult?: { idlist?: string[] };
			};
			const pmid = sJ.esearchresult?.idlist?.[0];
			if (!pmid) continue;
			const eUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
			assertSafeUrl(eUrl);
			const eRes = await stealthFetch(eUrl);
			if (!eRes.ok) throw new Error(`HTTP ${eRes.status} summary ${pmid}`);
			const eJ = (await eRes.json()) as {
				result?: Record<
					string,
					{ title?: string; pubdate?: string; source?: string }
				>;
			};
			const r = eJ.result?.[pmid];
			if (!r?.title) continue;
			await storeRaw("pubmed-latest", layer, eRes.status, { q, pmid });
			await storeNormalized({
				id: `pmid:${pmid}`,
				ts: new Date().toISOString(),
				source: "pubmed-latest",
				layer,
				title: `${(r.title ?? "?").slice(0, 230)} (${r.source ?? "?"}, ${r.pubdate ?? "?"})`,
				url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
				severity: "info",
				confidence: 0.8,
				entities: {},
				meta: {
					topic: q,
					journal: r.source ?? null,
					pubdate: r.pubdate ?? null,
				},
			});
			stored++;
		}
		n += stored;
		await markHealth("pubmed-latest", true);
	} catch (e: unknown) {
		errors.push(`pubmed-latest: ${errMsg(e)}`);
		await markHealth("pubmed-latest", false, errors[errors.length - 1]);
	}

	// Arbeitnow job board (keyless, 250/post page): remote-work pulse —
	// newest postings with company + location + tags.
	try {
		const url = "https://www.arbeitnow.com/api/job-board-api";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			data?: {
				slug?: string;
				title?: string;
				company_name?: string;
				location?: string;
				created_at?: number;
				tags?: string[];
				url?: string;
			}[];
		};
		const jobs = j.data ?? [];
		await storeRaw("arbeitnow", layer, res.status, { n: jobs.length });
		for (const jb of jobs.slice(0, 10)) {
			if (!jb.slug || !jb.title) continue;
			await storeNormalized({
				id: `arbeitnow:${jb.slug.slice(0, 80)}`,
				ts: new Date((jb.created_at ?? Date.now() / 1000) * 1000).toISOString(),
				source: "arbeitnow",
				layer,
				title: `${jb.title.slice(0, 200)} @ ${jb.company_name ?? "?"} (${jb.location ?? "?"})`,
				url: jb.url ?? undefined,
				severity: "info",
				confidence: 0.6,
				entities: {},
				meta: {
					company: jb.company_name ?? null,
					location: jb.location ?? null,
					tags: (jb.tags ?? []).slice(0, 5),
				},
			});
			n++;
		}
		await markHealth("arbeitnow", true);
	} catch (e: unknown) {
		errors.push(`arbeitnow: ${errMsg(e)}`);
		await markHealth("arbeitnow", false, errors[errors.length - 1]);
	}

	// RemoteOK (keyless, attribution-OK): newest tech postings with salary
	// range + tags — the salary-signal leg next to Arbeitnow volume.
	try {
		const url = "https://remoteok.com/api?limit=10";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			id?: string | number;
			position?: string;
			company?: string;
			location?: string;
			date?: string;
			salary_min?: number;
			salary_max?: number;
			tags?: string[];
			url?: string;
		}[];
		await storeRaw("remoteok", layer, res.status, { n: rows.length });
		for (const r of rows.slice(1, 11)) {
			if (!r.id || !r.position) continue;
			const sal =
				r.salary_min && r.salary_max
					? `$${Math.round(r.salary_min / 1000)}k-${Math.round(r.salary_max / 1000)}k`
					: null;
			await storeNormalized({
				id: `remoteok:${r.id}`,
				ts: r.date ?? new Date().toISOString(),
				source: "remoteok",
				layer,
				title:
					`${r.position.slice(0, 180)} @ ${r.company ?? "?"}${sal ? ` ${sal}` : ""}`.slice(
						0,
						280,
					),
				url: r.url ?? undefined,
				severity: "info",
				confidence: 0.6,
				entities: {},
				meta: {
					company: r.company ?? null,
					salary: sal,
					tags: (r.tags ?? []).slice(0, 5),
				},
			});
			n++;
		}
		await markHealth("remoteok", true);
	} catch (e: unknown) {
		errors.push(`remoteok: ${errMsg(e)}`);
		await markHealth("remoteok", false, errors[errors.length - 1]);
	}

	// TheMuse jobs (keyless, 411k postings): newest US postings with
	// company + location + category — the general-labor leg next to
	// Arbeitnow/RemoteOK tech postings.
	try {
		const url = "https://www.themuse.com/api/public/jobs?page=1&descending=true";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			results?: {
				id?: number;
				name?: string;
				company?: { name?: string };
				locations?: { name?: string }[];
				publication_date?: string;
				refs?: { landing_page?: string };
			}[];
		};
		const jobs = j.results ?? [];
		await storeRaw("themuse", layer, res.status, { n: jobs.length });
		for (const jb of jobs.slice(0, 8)) {
			if (!jb.id || !jb.name) continue;
			await storeNormalized({
				id: `themuse:${jb.id}`,
				ts: jb.publication_date ?? new Date().toISOString(),
				source: "themuse",
				layer,
				title: `${jb.name.slice(0, 180)} @ ${jb.company?.name ?? "?"} (${(jb.locations ?? []).map((l) => l.name).slice(0, 2).join("/") || "?"})`,
				url: jb.refs?.landing_page ?? undefined,
				severity: "info",
				confidence: 0.6,
				entities: {},
				meta: { company: jb.company?.name ?? null },
			});
			n++;
		}
		await markHealth("themuse", true);
	} catch (e: unknown) {
		errors.push(`themuse: ${errMsg(e)}`);
		await markHealth("themuse", false, errors[errors.length - 1]);
	}

	// OpenFoodFacts product lookup (keyless): Nutella sentinel row with
	// nutriscore + nova + additive count — the food-transparency heartbeat
	// (proves the API leg; real lookups stay on-demand OSINT).
	try {
		const url = "https://world.openfoodfacts.org/api/v2/product/3017620422003.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			code?: string;
			product?: {
				product_name?: string;
				nutriscore_grade?: string;
				nova_group?: number;
				additives_n?: number;
				brands?: string;
			};
		};
		const pr = j.product;
		if (!pr?.product_name) throw new Error("no product");
		await storeRaw("openfood", layer, res.status, { code: j.code });
		await storeNormalized({
			id: `openfood:3017620422003:${new Date().toISOString().slice(0, 10)}`,
			ts: new Date().toISOString(),
			source: "openfood",
			layer,
			title: `${pr.product_name} (${pr.brands ?? "?"}) — nutriscore ${String(pr.nutriscore_grade ?? "?").toUpperCase()} · NOVA ${pr.nova_group ?? "?"} · ${pr.additives_n ?? "?"} additives`,
			severity: "info",
			confidence: 0.85,
			entities: {},
			meta: { nutriscore: pr.nutriscore_grade ?? null, nova: pr.nova_group ?? null },
		});
		n++;
		await markHealth("openfood", true);
	} catch (e: unknown) {
		errors.push(`openfood: ${errMsg(e)}`);
		await markHealth("openfood", false, errors[errors.length - 1]);
	}

	// MusicBrainz release search (keyless, no key, polite UA): Nevermind
	// sentinel + result count — the music-catalog heartbeat leg.
	try {
		const url = "https://musicbrainz.org/ws/2/release/?query=release:nevermind&fmt=json&limit=1";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {
			headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			count?: number;
			releases?: { id?: string; title?: string; date?: string }[];
		};
		const rel = (j.releases ?? [])[0];
		if (!rel?.id) throw new Error("no release");
		await storeRaw("musicbrainz", layer, res.status, { count: j.count });
		await storeNormalized({
			id: `musicbrainz:nevermind:${new Date().toISOString().slice(0, 10)}`,
			ts: new Date().toISOString(),
			source: "musicbrainz",
			layer,
			title: `MusicBrainz "${rel.title ?? "?"}": ${j.count ?? "?"} matching releases`,
			url: `https://musicbrainz.org/release/${rel.id}`,
			severity: "info",
			confidence: 0.8,
			entities: {},
			meta: { matches: j.count ?? null, release: rel.id },
		});
		n++;
		await markHealth("musicbrainz", true);
	} catch (e: unknown) {
		errors.push(`musicbrainz: ${errMsg(e)}`);
		await markHealth("musicbrainz", false, errors[errors.length - 1]);
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

// Re-exported for unit tests: NHC empty-season must be honest-ok, not failure.
export function nhcEmptySeason(xml: string): boolean {
	return /No current storm/i.test(xml);
}
export { parseRSS };

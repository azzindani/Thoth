// ENISA EU Vulnerability Database (keyless JSON): the latest, the
// critical and the known-exploited lists. One row per EUVD id on the
// cyber layer (no geometry — list/search/alerts). Exploited → critical,
// CVSS ≥ 9 critical, ≥ 7 watch.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const BASE = "https://euvdservices.enisa.europa.eu/api";
const SOURCE = "enisa-euvd";
const LISTS = [
	["exploited", `${BASE}/exploitedvulnerabilities`],
	["critical", `${BASE}/criticalvulnerabilities`],
	["latest", `${BASE}/lastvulnerabilities`],
] as const;

const Named = z.object({ name: z.string().nullish() }).passthrough().nullish();
const Vuln = z
	.object({
		id: z.string(),
		description: z.string().nullish(),
		datePublished: z.string().nullish(),
		dateUpdated: z.string().nullish(),
		baseScore: z.union([z.number(), z.string()]).nullish(),
		baseScoreVersion: z.string().nullish(),
		aliases: z.string().nullish(),
		assigner: z.string().nullish(),
		epss: z.union([z.number(), z.string()]).nullish(),
		enisaIdProduct: z
			.array(z.object({ product: Named }).passthrough())
			.nullish(),
		enisaIdVendor: z.array(z.object({ vendor: Named }).passthrough()).nullish(),
	})
	.passthrough();
export type EuvdVuln = z.infer<typeof Vuln>;

/** The API answers a bare array or {items: [...]}; accept both. */
export function parseEuvd(j: unknown): EuvdVuln[] {
	const arr = Array.isArray(j)
		? j
		: ((j as { items?: unknown[] } | null)?.items ?? []);
	const out: EuvdVuln[] = [];
	for (const x of arr) {
		const r = Vuln.safeParse(x);
		if (r.success) out.push(r.data);
	}
	return out;
}

export function euvdSeverity(
	score: number | null,
	exploited: boolean,
): "critical" | "watch" | "info" {
	if (exploited || (score ?? 0) >= 9) return "critical";
	return (score ?? 0) >= 7 ? "watch" : "info";
}

const cves = (aliases?: string | null) =>
	(aliases ?? "").match(/CVE-\d{4}-\d{4,}/g) ?? [];

export async function collect() {
	const layer = "cyber";
	const seen = new Map<string, { v: EuvdVuln; exploited: boolean }>();
	const errors: string[] = [];
	for (const [list, url] of LISTS) {
		try {
			assertSafeUrl(url);
			const res = await stealthFetch(url, {}, 30000);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const rows = parseEuvd(await res.json());
			await storeRaw(SOURCE, layer, res.status, { list, n: rows.length });
			for (const v of rows) {
				const prev = seen.get(v.id);
				seen.set(v.id, {
					v,
					exploited: (prev?.exploited ?? false) || list === "exploited",
				});
			}
		} catch (e: unknown) {
			errors.push(`${list}: ${errMsg(e)}`);
		}
	}
	try {
		for (const { v, exploited } of seen.values()) {
			const score = v.baseScore == null ? null : Number(v.baseScore);
			const vendor = v.enisaIdVendor?.[0]?.vendor?.name ?? "";
			const product = v.enisaIdProduct?.[0]?.product?.name ?? "";
			const ids = cves(v.aliases);
			const ts = Date.parse(v.dateUpdated ?? v.datePublished ?? "");
			await storeNormalized({
				id: `euvd:${v.id}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: SOURCE,
				layer,
				title: [
					`${v.id}${ids[0] ? ` (${ids[0]})` : ""}`,
					[vendor, product].filter(Boolean).join(" "),
					score != null && Number.isFinite(score) ? `CVSS ${score}` : "",
					exploited ? "exploited" : "",
				]
					.filter(Boolean)
					.join(" · ")
					.slice(0, 280),
				body: v.description?.slice(0, 2000) ?? undefined,
				url: `https://euvd.enisa.europa.eu/vulnerability/${encodeURIComponent(v.id)}`,
				severity: euvdSeverity(
					Number.isFinite(score) ? score : null,
					exploited,
				),
				confidence: 0.95,
				entities: { cve: ids, vendor, product },
				meta: {
					score,
					scoreVersion: v.baseScoreVersion ?? null,
					epss: v.epss == null ? null : Number(v.epss),
					exploited,
					assigner: v.assigner ?? null,
				},
			});
		}
		const ok = seen.size > 0;
		await markHealth(
			SOURCE,
			ok,
			ok ? undefined : errors.join("; ") || "no vulnerabilities parsed",
		);
		return ok
			? { ok: true, count: seen.size }
			: { ok: false, error: errors.join("; ") || "empty" };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

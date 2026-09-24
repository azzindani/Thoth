// UK FCDO foreign travel advice (GOV.UK content API, keyless). The index
// lists every country with its last update; a country page carries
// details.alert_status (e.g. "avoid_all_travel_to_parts"). Only pages
// updated since the last stored copy are fetched. Countries without an
// alert are not mapped (and leave the map when an alert is lifted).
import { z } from "zod";
import { query } from "../../db/client.js";
import { locateCountry } from "../lib/countries.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const BASE = "https://www.gov.uk/api/content/foreign-travel-advice";
const SOURCE = "uk-fcdo";

const Child = z
	.object({
		title: z.string().nullish(),
		base_path: z.string(),
		public_updated_at: z.string().nullish(),
		details: z
			.object({
				country: z
					.object({ name: z.string().nullish(), slug: z.string().nullish() })
					.passthrough()
					.nullish(),
			})
			.passthrough()
			.nullish(),
	})
	.passthrough();
const Index = z
	.object({
		links: z.object({ children: z.array(Child) }).passthrough(),
	})
	.passthrough();
const Page = z
	.object({
		public_updated_at: z.string().nullish(),
		details: z
			.object({ alert_status: z.array(z.string()).nullish() })
			.passthrough()
			.nullish(),
	})
	.passthrough();

export type FcdoCountry = { slug: string; name: string; updated: string };

export function parseFcdoIndex(j: unknown): FcdoCountry[] {
	const idx = Index.parse(j);
	const out: FcdoCountry[] = [];
	for (const c of idx.links.children) {
		const slug =
			c.details?.country?.slug ?? c.base_path.split("/").filter(Boolean).pop();
		if (!slug) continue;
		out.push({
			slug,
			name: c.details?.country?.name ?? c.title ?? slug,
			updated: c.public_updated_at ?? "",
		});
	}
	return out;
}

/** Strongest alert wins. Null: no FCDO alert for this country. */
export function fcdoLevel(
	alerts: string[],
): { severity: "critical" | "watch" | "info"; advice: string } | null {
	const has = (s: string) => alerts.includes(s);
	if (has("avoid_all_travel_to_whole_country"))
		return { severity: "critical", advice: "Advise against all travel" };
	if (has("avoid_all_travel_to_parts"))
		return {
			severity: "watch",
			advice: has("avoid_all_but_essential_travel_to_whole_country")
				? "Against all travel to parts, all but essential travel to the rest"
				: "Advise against all travel to parts",
		};
	if (has("avoid_all_but_essential_travel_to_whole_country"))
		return {
			severity: "watch",
			advice: "Advise against all but essential travel",
		};
	if (has("avoid_all_but_essential_travel_to_parts"))
		return {
			severity: "info",
			advice: "Advise against all but essential travel to parts",
		};
	return null;
}

/** slug → update stamp of pages checked and found without an alert (the
 * worker is long-lived; a restart simply re-checks them once). */
const quiet = new Map<string, string>();

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
	const q = [...items];
	await Promise.all(
		Array.from({ length: Math.min(n, q.length) }, async () => {
			for (let t = q.shift(); t !== undefined; t = q.shift()) await fn(t);
		}),
	);
}

export async function collect() {
	const layer = "advisories";
	try {
		assertSafeUrl(BASE);
		const res = await stealthFetch(BASE, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const countries = parseFcdoIndex(await res.json());
		await storeRaw(SOURCE, layer, res.status, { n: countries.length });
		if (!countries.length) throw new Error("empty country index");
		// Last update we stored per slug; unchanged pages are skipped.
		const known = new Map(
			(
				await query<{ slug: string; updated: string }>(
					`SELECT meta->>'slug' AS slug, meta->>'updated' AS updated
					   FROM events WHERE source=$1`,
					[SOURCE],
				)
			).map((r) => [r.slug, r.updated]),
		);
		const due = countries.filter(
			(c) => known.get(c.slug) !== c.updated && quiet.get(c.slug) !== c.updated,
		);
		let fetched = 0;
		let failed = 0;
		let alerting = 0;
		await pool(due, 4, async (c) => {
			try {
				const url = `${BASE}/${encodeURIComponent(c.slug)}`;
				assertSafeUrl(url);
				const r = await stealthFetch(url, {}, 20000);
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				const page = Page.parse(await r.json());
				fetched++;
				const lvl = fcdoLevel(page.details?.alert_status ?? []);
				const id = `travel:uk:${c.slug}`;
				if (!lvl) {
					quiet.set(c.slug, c.updated);
					await query(`DELETE FROM events WHERE id=$1`, [id]);
					return;
				}
				quiet.delete(c.slug);
				alerting++;
				const where = locateCountry(c.name);
				const ts = Date.parse(page.public_updated_at ?? c.updated);
				await storeNormalized({
					id,
					ts: Number.isNaN(ts)
						? new Date().toISOString()
						: new Date(ts).toISOString(),
					source: SOURCE,
					layer,
					title: `UK FCDO · ${c.name}: ${lvl.advice}`.slice(0, 280),
					url: `https://www.gov.uk/foreign-travel-advice/${c.slug}`,
					severity: lvl.severity,
					confidence: 0.95,
					lat: where?.lat,
					lon: where?.lon,
					entities: { country: c.name },
					meta: {
						issuer: "UK",
						slug: c.slug,
						updated: c.updated,
						alerts: page.details?.alert_status ?? [],
						advice: lvl.advice,
					},
				});
			} catch {
				failed++;
			}
		});
		const ok = failed === 0 || fetched > 0;
		await markHealth(
			SOURCE,
			ok,
			ok ? undefined : `all ${failed} country pages failed`,
		);
		return {
			ok,
			count: alerting,
			fetched,
			skipped: countries.length - due.length,
		};
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

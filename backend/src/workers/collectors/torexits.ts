// Tor exit relays by country (Onionoo, keyless): count + share of exit
// capacity per country, anchored on the capital. The current consensus is
// the picture, so countries that lose their last exit leave the map.
import { z } from "zod";
import { locateCountry } from "../lib/countries.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import {
	dbClock,
	errMsg,
	markHealth,
	pruneStale,
	storeNormalized,
	storeRaw,
} from "../lib/store.js";

const URL_TOR =
	"https://onionoo.torproject.org/details?type=relay&running=true&flag=Exit&fields=country,country_name,exit_probability";
const SOURCE = "tor-onionoo";

const Doc = z
	.object({
		relays_published: z.string().nullish(),
		relays: z.array(
			z
				.object({
					country: z.string().nullish(),
					country_name: z.string().nullish(),
					exit_probability: z.number().nullish(),
				})
				.passthrough(),
		),
	})
	.passthrough();

export type TorCountry = {
	cc: string;
	name: string;
	relays: number;
	share: number;
};

/** Per-country exit relay count and share of exit probability (0..1). */
export function aggregateExits(doc: z.infer<typeof Doc>): TorCountry[] {
	const by = new Map<string, TorCountry>();
	for (const r of doc.relays) {
		const cc = (r.country ?? "").toLowerCase();
		if (!/^[a-z]{2}$/.test(cc)) continue;
		const c = by.get(cc) ?? {
			cc,
			name: r.country_name ?? cc.toUpperCase(),
			relays: 0,
			share: 0,
		};
		c.relays++;
		c.share += r.exit_probability ?? 0;
		by.set(cc, c);
	}
	return [...by.values()].sort((a, b) => b.share - a.share);
}

/** Onionoo prints "2026-09-23 11:00:00" (UTC, no zone). */
function published(s?: string | null): string {
	const t = Date.parse(s ? `${s.replace(" ", "T")}Z` : "");
	return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

export async function collect() {
	const layer = "cyber";
	try {
		const runStart = await dbClock();
		assertSafeUrl(URL_TOR);
		const res = await stealthFetch(URL_TOR, {}, 45000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const doc = Doc.parse(await res.json());
		const rows = aggregateExits(doc);
		await storeRaw(SOURCE, layer, res.status, {
			relays: doc.relays.length,
			countries: rows.length,
		});
		if (!rows.length) throw new Error("no exit relays in consensus");
		const ts = published(doc.relays_published);
		for (const c of rows) {
			const where = locateCountry(c.name);
			const pct = Math.round(c.share * 1000) / 10;
			await storeNormalized({
				id: `tor:exit:${c.cc}`,
				ts,
				source: SOURCE,
				layer,
				title: `Tor exits · ${c.name}: ${c.relays} relay${c.relays === 1 ? "" : "s"}, ${pct}% of exit capacity`,
				url: `https://metrics.torproject.org/rs.html#search/flag:exit%20country:${c.cc}`,
				severity: "info",
				confidence: 0.9,
				lat: where?.lat,
				lon: where?.lon,
				entities: { country: c.name, cc: c.cc },
				meta: { relays: c.relays, share: c.share },
			});
		}
		await pruneStale(SOURCE, runStart);
		await markHealth(SOURCE, true);
		return { ok: true, count: rows.length };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

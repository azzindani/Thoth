// UNHCR Refugee Data Finder (keyless JSON): people displaced from each
// country of origin — refugees, asylum-seekers, IDPs and others in need of
// international protection — for the latest published year. Annual data:
// the newest year with rows wins (the current year is usually empty).
// Anchored on the origin country's capital.
import { z } from "zod";
import { locateCountry } from "../lib/countries.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const API = "https://api.unhcr.org/population/v1/population/";
const SOURCE = "unhcr";

const num = z
	.union([z.number(), z.string()])
	.nullish()
	.transform((v) => {
		const n =
			typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
		return Number.isFinite(n) ? n : 0;
	});
const Row = z
	.object({
		year: z.union([z.number(), z.string()]),
		coo_name: z.string().nullish(),
		coo_iso: z.string().nullish(),
		refugees: num,
		asylum_seekers: num,
		idps: num,
		oip: num,
		stateless: num,
	})
	.passthrough();
export type UnhcrRow = z.infer<typeof Row>;

export function parseUnhcr(j: unknown): UnhcrRow[] {
	const items = (j as { items?: unknown[] } | null)?.items ?? [];
	const out: UnhcrRow[] = [];
	for (const x of items) {
		const r = Row.safeParse(x);
		if (r.success && r.data.coo_iso && r.data.coo_iso !== "-") out.push(r.data);
	}
	return out;
}

export const displaced = (r: UnhcrRow) =>
	r.refugees + r.asylum_seekers + r.idps + r.oip;

export function displacementSeverity(n: number): "critical" | "watch" | "info" {
	return n >= 1_000_000 ? "critical" : n >= 100_000 ? "watch" : "info";
}

const fmt = (n: number) =>
	n >= 1e6
		? `${(n / 1e6).toFixed(1)}M`
		: n >= 1e3
			? `${Math.round(n / 1e3)}k`
			: String(n);

export async function collect() {
	const layer = "displacement";
	try {
		const now = new Date().getUTCFullYear();
		let rows: UnhcrRow[] = [];
		let year = 0;
		for (const y of [now - 1, now - 2]) {
			const url = `${API}?limit=1000&yearFrom=${y}&yearTo=${y}&coo_all=true`;
			assertSafeUrl(url);
			const res = await stealthFetch(url, {}, 45000);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			rows = parseUnhcr(await res.json());
			await storeRaw(SOURCE, layer, res.status, { year: y, n: rows.length });
			if (rows.length) {
				year = y;
				break;
			}
		}
		let n = 0;
		for (const r of rows) {
			const total = displaced(r);
			if (total < 1000) continue;
			const name = r.coo_name ?? r.coo_iso ?? "";
			const where = locateCountry(name);
			await storeNormalized({
				id: `unhcr:origin:${String(r.coo_iso).toLowerCase()}`,
				ts: `${year}-12-31T00:00:00.000Z`,
				source: SOURCE,
				layer,
				title: `${fmt(total)} displaced from ${name} (${year})`,
				body: [
					r.refugees && `${fmt(r.refugees)} refugees`,
					r.asylum_seekers && `${fmt(r.asylum_seekers)} asylum-seekers`,
					r.idps && `${fmt(r.idps)} internally displaced`,
					r.oip && `${fmt(r.oip)} others in need of protection`,
					r.stateless && `${fmt(r.stateless)} stateless`,
				]
					.filter(Boolean)
					.join(" · "),
				url: "https://www.unhcr.org/refugee-statistics/",
				severity: displacementSeverity(total),
				confidence: 0.9,
				lat: where?.lat,
				lon: where?.lon,
				entities: { country: name, iso3: r.coo_iso },
				meta: {
					year,
					total,
					refugees: r.refugees,
					asylum_seekers: r.asylum_seekers,
					idps: r.idps,
					oip: r.oip,
					stateless: r.stateless,
				},
			});
			n++;
		}
		await markHealth(SOURCE, n > 0, n > 0 ? undefined : "no origin rows");
		return { ok: n > 0, count: n, year };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

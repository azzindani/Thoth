// IDMC internal-displacement via HDX CKAN (keyless, OCHA) → `disasters`.
// Per-country CSVs (conflict + disaster new displacements); curated hotspot
// list, daily poll. Country-level rows (entities.country), ts = latest year.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// ISO3 hotspot list: protracted + recent large displacements. Static facts.
const COUNTRIES = [
	"NGA",
	"ETH",
	"MMR",
	"COD",
	"SDN",
	"SOM",
	"SSD",
	"YEM",
	"SYR",
	"AFG",
	"UKR",
	"VEN",
	"COL",
	"IRQ",
	"PAK",
	"BGD",
	"PHL",
	"IDN",
	"MOZ",
	"CMR",
	"TCD",
	"NER",
	"MLI",
	"BFA",
	"CAF",
];

const Pkg = z.object({
	success: z.boolean(),
	result: z.object({
		resources: z.array(
			z.object({
				name: z.string().optional(),
				format: z.string().optional(),
				url: z.string().optional(),
			}),
		),
	}),
});

function parseLine(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let q = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (q) {
			if (c === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (c === '"') q = false;
			else cur += c;
		} else if (c === '"') q = true;
		else if (c === ",") {
			out.push(cur);
			cur = "";
		} else cur += c;
	}
	out.push(cur);
	return out;
}

export function dispSeverity(n: number): "info" | "watch" | "critical" {
	if (n >= 1000000) return "critical";
	if (n >= 100000) return "watch";
	return "info";
}

export async function collect() {
	const source = "hdx-idmc";
	const layer = "disasters";
	let n = 0;
	const errors: string[] = [];

	for (const iso of COUNTRIES) {
		try {
			const meta = `https://data.humdata.org/api/3/action/package_show?id=idmc-idp-data-${iso.toLowerCase()}`;
			assertSafeUrl(meta);
			const mr = await stealthFetch(meta);
			if (!mr.ok) throw new Error(`HTTP ${mr.status} meta`);
			const pkg = Pkg.parse(await mr.json());
			const csvs = pkg.result.resources.filter(
				(r) =>
					(r.format ?? "").toUpperCase() === "CSV" &&
					/new[_ -]displacement/i.test(r.name ?? "") &&
					typeof r.url === "string",
			);
			if (!csvs.length) throw new Error("no displacement CSV");
			for (const r of csvs.slice(0, 2)) {
				const url = r.url as string;
				assertSafeUrl(url);
				const cr = await stealthFetch(url, {}, 30000);
				if (!cr.ok) throw new Error(`HTTP ${cr.status} csv`);
				const lines = (await cr.text()).split("\n").filter((l) => l.trim());
				if (lines.length < 2) continue;
				const head = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
				const yi = head.indexOf("year");
				const ni = head.indexOf("new_displacement");
				const ci = head.indexOf("country_name");
				if (yi < 0 || ni < 0) continue;
				let best: { year: number; n: number; country: string } | null = null;
				for (const ln of lines.slice(1)) {
					const c = parseLine(ln);
					const year = Number(c[yi]);
					const v = Number((c[ni] ?? "").replace(/[^0-9]/g, ""));
					if (!Number.isFinite(year) || !Number.isFinite(v)) continue;
					if (!best || year > best.year)
						best = { year, n: v, country: (c[ci] ?? iso).trim() || iso };
				}
				if (!best) continue;
				const kind = /disaster/i.test(r.name ?? "") ? "disaster" : "conflict";
				await storeNormalized({
					id: `hdx-idmc:${iso}:${best.year}:${kind}`,
					ts: `${best.year}-12-31T00:00:00Z`,
					source,
					layer,
					title: `${best.country}: ${best.n.toLocaleString("en-US")} new ${kind} displacements (${best.year})`,
					severity: dispSeverity(best.n),
					confidence: 0.85,
					entities: { country: iso },
					meta: { iso, year: best.year, new_displacements: best.n, kind },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`${iso}: ${errMsg(e)}`);
		}
	}

	await storeRaw(source, layer, n > 0 ? 200 : 500, { countries: n });
	await markHealth(
		source,
		n > 0,
		n > 0 ? undefined : errors.slice(0, 3).join("; "),
	);

	// Gov open-data catalog pulse (keyless CKAN package_search, from the
	// fincept digest, 2026-09-18): dataset counts per portal for fixed
	// probe queries — the catalog-freshness leg next to IDMC rows.
	// Probe-verified: Canada 576 (gdp), Swiss 1321 (energy, redirect host),
	// AU 11679 (climate, /data/api path), Slovenia 3 (energy).
	// Dead: US catalog.data.gov 404 (fincept URL stale), Italy 403,
	// Brazil 401, Uruguay untested. US re-add when portal URL confirmed.
	for (const [tag, url] of [
		[
			"ca-gdp",
			"https://open.canada.ca/data/api/action/package_search?q=gdp&rows=1",
		],
		[
			"ch-energy",
			"https://ckan.opendata.swiss/api/3/action/package_search?q=energy&rows=1",
		],
		[
			"au-climate",
			"https://data.gov.au/data/api/3/action/package_search?q=climate&rows=1",
		],
		[
			"si-energy",
			"https://podatki.gov.si/api/3/action/package_search?q=energy&rows=1",
		],
	] as const) {
		try {
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${tag}`);
			const j = (await res.json()) as {
				success?: boolean;
				result?: {
					count?: number;
					results?: {
						title?: string;
						organization?: { title?: string };
					}[];
				};
			};
			if (j.success !== true) throw new Error(`CKAN fail ${tag}`);
			const count = Number(j.result?.count ?? NaN);
			if (!Number.isFinite(count)) throw new Error(`no count ${tag}`);
			const top = j.result?.results?.[0];
			await storeRaw(`ckan-${tag}`, layer, res.status, { count });
			await storeNormalized({
				id: `ckan:${tag}:${new Date().toISOString().slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: `ckan-${tag}`,
				layer,
				title: `Catalog ${tag}: ${count.toLocaleString("en-US")} datasets`,
				severity: "info",
				confidence: 0.8,
				entities: {},
				meta: {
					portal: tag,
					count,
					top_org:
						typeof top?.organization?.title === "string"
							? top.organization.title
							: null,
				},
			});
			n++;
			await markHealth(`ckan-${tag}`, true);
		} catch (e: unknown) {
			errors.push(`ckan-${tag}: ${errMsg(e)}`);
			await markHealth(`ckan-${tag}`, false, errors[errors.length - 1]);
		}
	}

	if (n === 0) return { ok: false, error: errors.slice(0, 5).join("; ") };
	return { ok: true, count: n };
}

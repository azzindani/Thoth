// WHO Global Health Observatory (keyless OData) → `health` layer.
// Indicator snapshots for a curated country list, weekly poll. Country-level
// rows (entities.country), ts = latest TimeDim year, NEVER_FROZEN in server.ts
// (annual data, inherently old — fetch-failure is the only signal).

import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { sleep } from "../lib/sleep.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// OData code → short label. Stable WHO indicator vocabulary.
const INDICATORS = [
	["WHOSIS_000001", "life expectancy"],
	["WHOSIS_000002", "healthy life expectancy"],
	["SDG_SH_DTH_RNCOM", "NCD mortality"],
	["MALARIA_EST_CASES", "malaria cases"],
	["TB_EST_CASES", "TB cases"],
	["HIV_0000000026", "new HIV infections"],
] as const;

// ISO3 watchlist: theaters + outbreak-prone states. Static facts.
const COUNTRIES = [
	"USA",
	"GBR",
	"FRA",
	"DEU",
	"UKR",
	"RUS",
	"ISR",
	"IRN",
	"CHN",
	"IND",
	"BRA",
	"NGA",
	"ETH",
	"COD",
	"SDN",
	"MMR",
	"AFG",
	"SYR",
	"YEM",
	"SOM",
	"EGY",
	"TUR",
	"SAU",
	"PAK",
	"BGD",
];

const Row = z
	.object({
		IndicatorCode: z.string().optional(),
		SpatialDim: z.string().optional(),
		TimeDim: z.number().nullable().optional(),
		Dim1: z.string().nullable().optional(),
		NumericValue: z.number().nullable().optional(),
		Value: z.string().nullable().optional(),
	})
	.passthrough();

const Resp = z.object({ value: z.array(Row).optional() });

export function fmtVal(v: number): string {
	if (v >= 1000000) return `${Math.round(v / 100000) / 10}M`;
	if (v >= 10000) return `${Math.round(v / 100) / 10}k`;
	if (Number.isInteger(v)) return String(v);
	return String(Math.round(v * 10) / 10);
}

export async function collect() {
	const source = "who-gho";
	const layer = "health";
	let n = 0;
	const errors: string[] = [];

	for (const [code, label] of INDICATORS) {
		try {
			const url = `https://ghoapi.azureedge.net/api/${code}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url, {}, 60000);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${code}`);
			const rows = Resp.parse(await res.json()).value ?? [];
			await storeRaw(source, layer, res.status, { code, n: rows.length });
			// Latest year per country, BOTH sexes preferred else any.
			const latest = new Map<
				string,
				{
					year: number;
					num: number | null;
					raw: string | null;
					dim: string | null;
				}
			>();
			for (const r of rows) {
				if (!r.SpatialDim || !COUNTRIES.includes(r.SpatialDim)) continue;
				if (typeof r.TimeDim !== "number") continue;
				const prev = latest.get(r.SpatialDim);
				const both = !r.Dim1 || r.Dim1 === "SEX_BTSX";
				const prevBoth = !prev?.dim || prev.dim === "SEX_BTSX";
				if (
					!prev ||
					r.TimeDim > prev.year ||
					(r.TimeDim === prev.year && both && !prevBoth)
				)
					latest.set(r.SpatialDim, {
						year: r.TimeDim,
						num: r.NumericValue ?? null,
						raw: r.Value ?? null,
						dim: r.Dim1 ?? null,
					});
			}
			for (const [iso, v] of latest) {
				const shown =
					v.num !== null && Number.isFinite(v.num)
						? fmtVal(v.num)
						: (v.raw ?? "?").slice(0, 24);
				await storeNormalized({
					id: `who:${code}:${iso}:${v.year}`,
					ts: `${v.year}-06-15T00:00:00Z`,
					source,
					layer,
					title: `${iso} ${label} ${shown} (${v.year})`,
					severity: "info",
					confidence: 0.9,
					entities: { country: iso },
					meta: { indicator: code, label, year: v.year, value: v.num ?? v.raw },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`${code}: ${errMsg(e)}`);
		}
	}

	// openFDA recalls: food + device enforcement, latest 5 each.
	// Drug labels already have an OSINT route; recalls are the poll leg.
	for (const [kind, url] of [
		["food", "https://api.fda.gov/food/enforcement.json?limit=5"],
		["device", "https://api.fda.gov/device/recall.json?limit=5"],
	] as const) {
		try {
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${kind}`);
			const j = (await res.json()) as {
				results?: {
					recall_number?: string;
					recalling_firm?: string;
					product_description?: string;
					reason_for_recall?: string;
					classification?: string;
					state?: string;
					country?: string;
					recall_initiation_date?: string;
				}[];
			};
			const rows = j.results ?? [];
			await storeRaw(`fda-${kind}`, layer, res.status, { n: rows.length });
			for (const r of rows) {
				if (!r.recall_number) continue;
				const cls = (r.classification ?? "").toLowerCase();
				await storeNormalized({
					id: `fda:${r.recall_number.replace(/[^A-Za-z0-9-]+/g, "-")}`,
					ts: r.recall_initiation_date
						? `${r.recall_initiation_date.slice(0, 4)}-${r.recall_initiation_date.slice(4, 6)}-${r.recall_initiation_date.slice(6, 8)}T00:00:00Z`
						: new Date().toISOString(),
					source: `fda-${kind}`,
					layer,
					title:
						`${r.recalling_firm ?? kind} recall: ${(r.product_description ?? "").slice(0, 160)} (${r.classification ?? "?"})`.slice(
							0,
							300,
						),
					body: (r.reason_for_recall ?? "").slice(0, 300),
					severity: cls.includes("class i") ? "watch" : "info",
					confidence: 0.9,
					entities: {},
					meta: { kind, firm: r.recalling_firm, state: r.state },
				});
				n++;
			}
			await markHealth(`fda-${kind}`, true);
		} catch (e: unknown) {
			errors.push(`fda-${kind}: ${errMsg(e)}`);
			await markHealth(`fda-${kind}`, false, errors[errors.length - 1]);
		}
	}

	// openFDA FAERS: serious adverse-event reports, latest 5.
	// 20M+ total; serious=1 filter keeps the signal leg.
	try {
		const url = "https://api.fda.gov/drug/event.json?limit=5&search=serious:1";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status} faers`);
		const j = (await res.json()) as {
			results?: {
				safetyreportid?: string;
				receivedate?: string;
				serious?: string;
				patient?: {
					drug?: { medicinalproduct?: string }[];
					reaction?: { reactionmeddrapt?: string }[];
				};
			}[];
		};
		const rows = j.results ?? [];
		await storeRaw("fda-faers", layer, res.status, { n: rows.length });
		for (const r of rows) {
			if (!r.safetyreportid) continue;
			const drugs = (r.patient?.drug ?? [])
				.map((d) => d.medicinalproduct ?? "")
				.filter(Boolean)
				.slice(0, 2)
				.join(" + ");
			const reactions = (r.patient?.reaction ?? [])
				.map((x) => x.reactionmeddrapt ?? "")
				.filter(Boolean)
				.slice(0, 3)
				.join("; ");
			const rd = r.receivedate ?? "";
			await storeNormalized({
				id: `faers:${r.safetyreportid.replace(/[^A-Za-z0-9-]+/g, "-")}`,
				ts:
					rd.length === 8
						? `${rd.slice(0, 4)}-${rd.slice(4, 6)}-${rd.slice(6, 8)}T00:00:00Z`
						: new Date().toISOString(),
				source: "fda-faers",
				layer,
				title:
					`FAERS serious: ${drugs || "?"} → ${(reactions || "?").slice(0, 160)}`.slice(
						0,
						300,
					),
				severity: /death|life threatening|disability/i.test(reactions)
					? "watch"
					: "info",
				confidence: 0.8,
				entities: {},
				meta: { report: r.safetyreportid, drugs: drugs || null },
			});
			n++;
		}
		await markHealth("fda-faers", true);
	} catch (e: unknown) {
		errors.push(`fda-faers: ${errMsg(e)}`);
		await markHealth("fda-faers", false, errors[errors.length - 1]);
	}

	// openFDA 510(k) clearances + NDC directory (keyless): device + drug
	// catalog pulse, 1 row each.
	for (const [kind, url] of [
		["510k", "https://api.fda.gov/device/510k.json?limit=1"],
		["ndc", "https://api.fda.gov/drug/ndc.json?limit=1"],
	] as const) {
		try {
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${kind}`);
			const j = (await res.json()) as {
				results?: Record<string, unknown>[];
			};
			const r = (j.results ?? [])[0] as
				| {
						k_number?: string;
						applicant?: string;
						device_name?: string;
						decision_date?: string;
						product_ndc?: string;
						brand_name?: string;
						generic_name?: string;
						labeler_name?: string;
				  }
				| undefined;
			await storeRaw(`fda-${kind}`, layer, res.status, {
				n: j.results?.length ?? 0,
			});
			if (!r) throw new Error(`no ${kind} row`);
			const label =
				kind === "510k"
					? `${r.k_number ?? "?"} ${r.applicant ?? "?"} — ${(r.device_name ?? "").slice(0, 120)}`
					: `${r.product_ndc ?? "?"} ${(r.brand_name ?? r.generic_name ?? "?").slice(0, 120)} (${r.labeler_name ?? "?"})`;
			await storeNormalized({
				id: `fda-${kind}:${new Date().toISOString().slice(0, 13)}`,
				ts: new Date().toISOString(),
				source: `fda-${kind}`,
				layer,
				title: `FDA ${kind}: ${label}`.slice(0, 300),
				severity: "info",
				confidence: 0.75,
				entities: {},
				meta: { kind },
			});
			n++;
			await markHealth(`fda-${kind}`, true);
		} catch (e: unknown) {
			errors.push(`fda-${kind}: ${errMsg(e)}`);
			await markHealth(`fda-${kind}`, false, errors[errors.length - 1]);
		}
	}

	await markHealth(
		source,
		n > 0,
		n > 0 ? undefined : errors.slice(0, 3).join("; "),
	);

	// UNESCO education enrolment (keyless, fincept digest 2026-09-17):
	// primary-education pupils per watchlist country — the schooling leg
	// next to WHO vitals. Probe-verified (indicator 20062, USA 24.5M 2016).
	for (const iso of COUNTRIES) {
		try {
			const url = `https://api.uis.unesco.org/api/public/data/indicators?indicator=20062&geoUnit=${iso}&per_page=30`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${iso}`);
			const j = (await res.json()) as {
				records?: { year?: number; value?: number | null }[];
			};
			const rows = (j.records ?? []).filter(
				(r): r is { year: number; value: number } =>
					typeof r.year === "number" && typeof r.value === "number",
			);
			if (!rows.length) continue;
			const last = rows[rows.length - 1];
			await storeRaw("unesco-enrol", layer, res.status, { iso });
			await storeNormalized({
				id: `unesco:enrol:${iso}:${last.year}`,
				ts: `${last.year}-06-15T00:00:00Z`,
				source: "unesco-enrol",
				layer,
				title: `${iso} primary pupils ${fmtVal(last.value)} (${last.year})`,
				severity: "info",
				confidence: 0.85,
				entities: { country: iso },
				meta: {
					indicator: "20062",
					label: "primary enrolment",
					year: last.year,
					value: last.value,
				},
			});
			n++;
			await sleep(400);
		} catch (e: unknown) {
			errors.push(`unesco-enrol/${iso}: ${errMsg(e)}`);
		}
	}
	const unescoOk = !errors.some((e) => e.startsWith("unesco-enrol/"));
	await markHealth(
		"unesco-enrol",
		unescoOk,
		unescoOk
			? undefined
			: errors
					.filter((e) => e.startsWith("unesco-enrol/"))
					.slice(0, 3)
					.join("; "),
	);

	if (n === 0) return { ok: false, error: errors.slice(0, 5).join("; ") };
	return { ok: true, count: n };
}

// IMF DataMapper (keyless): GDP growth + inflation + unemployment, latest
// year per country → `markets` layer as country rows. World Bank macro is the
// per-indicator time series; IMF is the forecast-vintage second opinion.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const INDS = [
	["NGDP_RPCH", "GDP growth %"],
	["PCPIPCH", "inflation %"],
	["LUR", "unemployment %"],
] as const;

// ISO3 watchlist shared with health-who. Static facts.
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

const Resp = z.object({
	values: z.record(z.record(z.record(z.number().nullable()))).optional(),
});

export async function collect() {
	const source = "imf";
	const layer = "markets";
	let n = 0;
	const errors: string[] = [];

	for (const [ind, label] of INDS) {
		try {
			const url = `https://www.imf.org/external/datamapper/api/v1/${ind}/${COUNTRIES.join("/")}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url, {}, 30000);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${ind}`);
			const vals = Resp.parse(await res.json()).values?.[ind] ?? {};
			await storeRaw(source, layer, res.status, {
				ind,
				n: Object.keys(vals).length,
			});
			for (const iso of COUNTRIES) {
				const series = vals[iso] ?? {};
				const years = Object.keys(series)
					.map(Number)
					.filter((y) => Number.isFinite(y) && series[String(y)] !== null);
				if (!years.length) continue;
				const year = Math.max(...years);
				const v = series[String(year)] as number;
				await storeNormalized({
					id: `imf:${ind}:${iso}:${year}`,
					ts: `${year}-06-15T00:00:00Z`,
					source,
					layer,
					title: `${iso} ${label} ${Math.round(v * 10) / 10} (${year})`,
					severity: ind === "NGDP_RPCH" && v < -2 ? "watch" : "info",
					confidence: 0.9,
					entities: { country: iso },
					meta: { indicator: ind, label, year, value: v },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`${ind}: ${errMsg(e)}`);
		}
	}

	// BLS CPI (keyless, no signup): latest CPI-U index + MoM read.
	try {
		const url =
			"https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0?startyear=2025&endyear=2026";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status} bls`);
		const j = (await res.json()) as {
			status?: string;
			Results?: {
				series?: {
					seriesID?: string;
					data?: { year?: string; periodName?: string; value?: string }[];
				}[];
			};
		};
		if (j.status !== "REQUEST_SUCCEEDED") throw new Error("BLS status");
		const data = j.Results?.series?.[0]?.data ?? [];
		await storeRaw("bls-cpi", layer, res.status, { n: data.length });
		const cur = data[0];
		const prev = data[1];
		const v = Number(cur?.value ?? NaN);
		if (!Number.isFinite(v) || !cur?.year) throw new Error("no CPI");
		const pv = Number(prev?.value ?? NaN);
		const mom = Number.isFinite(pv) && pv ? ((v - pv) / pv) * 100 : null;
		await storeNormalized({
			id: `bls:cpi:${cur.year}-${cur.periodName ?? "?"}`,
			ts: new Date().toISOString(),
			source: "bls-cpi",
			layer,
			title: `US CPI ${v.toFixed(1)} (${cur.periodName} ${cur.year}${mom !== null ? `, ${mom >= 0 ? "+" : ""}${mom.toFixed(2)}% MoM` : ""})`,
			severity: mom !== null && mom > 0.5 ? "watch" : "info",
			confidence: 0.95,
			entities: { country: "USA" },
			meta: { cpi: v, mom, period: `${cur.periodName} ${cur.year}` },
		});
		n++;
		await markHealth("bls-cpi", true);
	} catch (e: unknown) {
		errors.push(`bls-cpi: ${errMsg(e)}`);
		await markHealth("bls-cpi", false, errors[errors.length - 1]);
	}

	// Bank of Canada daily FX (keyless Valet): CAD-base majors snapshot —
	// the CAD leg next to NBP-PLN (fxdepth) and Frankfurter-USD.
	try {
		const url =
			"https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json?start_date=2026-09-10";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status} boc`);
		const j = (await res.json()) as {
			observations?: { d?: string; [k: string]: unknown }[];
		};
		const obs = (j.observations ?? []).filter((o) => o.d);
		await storeRaw("boc-fx", layer, res.status, { n: obs.length });
		const last = obs[obs.length - 1];
		if (last?.d) {
			let stored = 0;
			for (const [key, label] of [
				["FXUSDCAD", "USD/CAD"],
				["FXEURCAD", "EUR/CAD"],
				["FXGBPCAD", "GBP/CAD"],
				["FXJPYCAD", "JPY/CAD"],
			] as const) {
				const v = Number((last[key] as { v?: string })?.v ?? NaN);
				if (!Number.isFinite(v)) continue;
				await storeNormalized({
					id: `boc:${label.replace("/", "")}:${last.d}`,
					ts: last.d,
					source: "boc-fx",
					layer,
					title: `${label} ${v} (BoC ${last.d})`,
					severity: "info",
					confidence: 0.95,
					entities: {},
					meta: { pair: label, rate: v, date: last.d },
				});
				stored++;
			}
			n += stored;
		}
		await markHealth("boc-fx", true);
	} catch (e: unknown) {
		errors.push(`boc-fx: ${errMsg(e)}`);
		await markHealth("boc-fx", false, errors[errors.length - 1]);
	}

	await markHealth(source, n > 0, n > 0 ? undefined : errors.join("; "));
	// World Bank GDP current-US$ (keyless): latest value for USA + CHN +
	// IND + DEU + JPN — the nominal-GDP leg next to IMF growth rates.
	try {
		let stored = 0;
		for (const [iso, code] of [
			["USA", "US"],
			["CHN", "CN"],
			["IND", "IN"],
			["DEU", "DE"],
			["JPN", "JP"],
		] as const) {
			const url = `https://api.worldbank.org/v2/country/${code}/indicator/NY.GDP.MKTP.CD?format=json&per_page=2`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${iso}`);
			const j = (await res.json()) as {
				indicator?: { value?: string };
				country?: { value?: string };
				date?: string;
				value?: number;
			}[][];
			const row = (j[1] ?? []).find((r) => typeof r.value === "number");
			if (!row?.date || typeof row.value !== "number") continue;
			await storeRaw("worldbank", layer, res.status, { iso });
			await storeNormalized({
				id: `wb:gdp:${iso}:${row.date}`,
				ts: `${row.date}-06-15T00:00:00Z`,
				source: "worldbank",
				layer,
				title: `${iso} GDP $${(row.value / 1e12).toFixed(2)}T (${row.date})`,
				severity: "info",
				confidence: 0.95,
				entities: { country: iso },
				meta: { gdp: row.value, year: row.date },
			});
			stored++;
		}
		n += stored;
		await markHealth("worldbank", true);
	} catch (e: unknown) {
		errors.push(`worldbank: ${errMsg(e)}`);
		await markHealth("worldbank", false, errors[errors.length - 1]);
	}

	// DBnomics BEA GDP (keyless, fincept digest 2026-09-17): US nominal
	// GDP time series via the DBnomics mirror — the BEA-direct leg without
	// the BEA key. Probe-verified (NIPA-T10105, annual, 1929→2025).
	try {
		const url =
			"https://api.db.nomics.world/v22/series/BEA/NIPA-T10105?observations=1";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status} dbnomics`);
		const j = (await res.json()) as {
			series?: {
				docs?: {
					series_code?: string;
					series_name?: string;
					period?: string[];
					value?: (number | null)[];
				}[];
			};
		};
		const docs = j.series?.docs ?? [];
		await storeRaw("dbnomics-bea", layer, res.status, { n: docs.length });
		const gdp = docs.find((d) =>
			(d.series_name ?? "").startsWith("Gross domestic product "),
		);
		const periods = gdp?.period ?? [];
		const values = gdp?.value ?? [];
		const year = periods[periods.length - 1] ?? "";
		const v = values[values.length - 1];
		if (year && typeof v === "number") {
			await storeNormalized({
				id: `dbn:bea-gdp:${year}`,
				ts: `${year}-06-15T00:00:00Z`,
				source: "dbnomics-bea",
				layer,
				title: `US GDP $${(v / 1e6).toFixed(2)}T via DBnomics/BEA (${year})`,
				severity: "info",
				confidence: 0.9,
				entities: { country: "USA" },
				meta: { gdp_m: v, year },
			});
			n++;
		}
		await markHealth("dbnomics-bea", true);
	} catch (e: unknown) {
		errors.push(`dbnomics-bea: ${errMsg(e)}`);
		await markHealth("dbnomics-bea", false, errors[errors.length - 1]);
	}

	// World Bank WDI source-series (keyless, V2/sources endpoint):
	// central-government debt % GDP + real GDP growth %, latest non-null
	// year per series for USA + CHN — the fiscal-sustainability leg next to
	// the NY.GDP.MKTP.CD nominal-GDP leg. Probe-verified (WDI source id 2,
	// 2024 values, nulls skipped).
	for (const [series, label, unit] of [
		["GC.DOD.TOTL.GD.ZS", "govt debt", "% GDP"],
		["NY.GDP.MKTP.KD.ZG", "GDP growth", "%"],
	] as const) {
		try {
			let stored = 0;
			for (const iso of series === "GC.DOD.TOTL.GD.ZS"
				? (["USA", "GBR"] as const)
				: (["USA", "CHN"] as const)) {
				const url = `https://api.worldbank.org/V2/sources/2/country/${iso}/series/${series}?format=json`;
				assertSafeUrl(url);
				const res = await stealthFetch(url);
				if (!res.ok) throw new Error(`HTTP ${res.status} ${series}/${iso}`);
				const j = (await res.json()) as {
					source?: {
						data?: { variable?: { value?: string }[]; value?: number | null }[];
					};
				};
				const rows = j.source?.data ?? [];
				const hit = rows.find(
					(r) => typeof r.value === "number" && r.value !== null,
				);
				// Time value is "2024" (the YR2024 code lives in .id, not
				// .value — probed live 2026-09-18). Match the 4-digit value.
				const year =
					hit?.variable?.find((v) => /^\d{4}$/.test(v.value ?? ""))?.value ??
					"";
				const v = hit?.value;
				if (!year || typeof v !== "number") continue;
				await storeRaw("worldbank-src", layer, res.status, { series, iso });
				await storeNormalized({
					id: `wbs:${series}:${iso}:${year}`,
					ts: `${year}-06-15T00:00:00Z`,
					source: "worldbank-src",
					layer,
					title: `${iso} ${label} ${Math.round(v * 10) / 10}${unit} (${year})`,
					severity:
						series === "GC.DOD.TOTL.GD.ZS" && v > 100 ? "watch" : "info",
					confidence: 0.9,
					entities: { country: iso },
					meta: { series, label, year, value: v },
				});
				stored++;
			}
			n += stored;
			await markHealth("worldbank-src", true);
		} catch (e: unknown) {
			errors.push(`worldbank-src/${series}: ${errMsg(e)}`);
			await markHealth("worldbank-src", false, errors[errors.length - 1]);
		}
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

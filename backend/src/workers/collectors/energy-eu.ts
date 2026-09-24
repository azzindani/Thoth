// EU energy depth (keyless): Danish Energi Data Service day-ahead spot
// prices (DK1/DK2) + UK carbon intensity 48h history + EIA open-data QB
// series index (coal series catalog — the QB host serves bulk JSON without a
// key at the /qb.php path). All → `energy` layer.

import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { sleep } from "../lib/sleep.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// Energy-Charts country legs: ENTSO-E data lands 6–16 h late for several
// countries, so the default "today" window answers 404 "no content
// available" (DK/GR/LU/PT/SI, 2026-09-24). Ask for the last 48 h and read
// the newest slot that actually has data. 1.5 s spacing drew 429s on most of
// the 23 countries; 6 s spacing did not (probe 2026-09-24).
const ECHARTS_WINDOW_MS = 48 * 3600 * 1000;
const ECHARTS_SPACING_MS = 6000;
// Even at 6 s the last few of 25 calls still drew 429 (LU/RO/SK, 2026-09-24):
// the limit is a window budget, so a 429 waits once and retries.
const ECHARTS_429_PAUSE_MS = 30_000;

type EchartsPower = {
	unix_seconds?: number[];
	production_types?: { name?: string; data?: (number | null)[] }[];
};

/** Index of the newest slot where any production type reports a value. */
export function latestFilledSlot(j: EchartsPower): number {
	const slots = j.unix_seconds ?? [];
	for (let i = slots.length - 1; i >= 0; i--)
		if ((j.production_types ?? []).some((t) => typeof t.data?.[i] === "number"))
			return i;
	return -1;
}

const DkRow = z.object({
	HourUTC: z.string().optional(),
	PriceArea: z.string().optional(),
	SpotPriceDKK: z.number().nullable().optional(),
	SpotPriceEUR: z.number().nullable().optional(),
});

const CarbonHist = z.object({
	data: z
		.array(
			z.object({
				from: z.string().optional(),
				intensity: z
					.object({
						actual: z.number().nullable().optional(),
						forecast: z.number().nullable().optional(),
						index: z.string().nullable().optional(),
					})
					.optional(),
			}),
		)
		.optional(),
});

export async function collect() {
	const layer = "energy";
	let n = 0;
	const errors: string[] = [];

	// Danish spot: latest 4 rows (DK1+DK2 × 2h).
	try {
		const url =
			"https://api.energidataservice.dk/dataset/Elspotprices?limit=4&sort=HourUTC%20DESC";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as { records?: unknown[] };
		const rows = z.array(DkRow).parse(j.records ?? []);
		await storeRaw("dk-spot", layer, res.status, { n: rows.length });
		for (const r of rows) {
			if (!r.HourUTC || typeof r.SpotPriceEUR !== "number") continue;
			await storeNormalized({
				id: `dkspot:${r.PriceArea ?? "?"}:${r.HourUTC.slice(0, 13)}`,
				ts: r.HourUTC,
				source: "dk-spot",
				layer,
				title: `DK ${r.PriceArea ?? "?"} spot €${r.SpotPriceEUR.toFixed(2)}/MWh`,
				severity: r.SpotPriceEUR > 300 ? "watch" : "info",
				confidence: 0.9,
				entities: { country: "DNK" },
				meta: { area: r.PriceArea, eur: r.SpotPriceEUR, dkk: r.SpotPriceDKK },
			});
			n++;
		}
		await markHealth("dk-spot", true);
	} catch (e: unknown) {
		errors.push(`dk-spot: ${errMsg(e)}`);
		await markHealth("dk-spot", false, errors[errors.length - 1]);
	}

	// UK carbon 48h history: peak actual intensity of the last day.
	try {
		const url = "https://api.carbonintensity.org.uk/intensity/date";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = CarbonHist.parse(await res.json()).data ?? [];
		await storeRaw("carbon-uk-hist", layer, res.status, { n: rows.length });
		let peak = 0;
		let peakT = "";
		for (const r of rows) {
			const a = r.intensity?.actual ?? r.intensity?.forecast ?? 0;
			if (typeof a === "number" && a > peak) {
				peak = a;
				peakT = r.from ?? "";
			}
		}
		if (peak > 0) {
			await storeNormalized({
				id: `carbonhist:${peakT.slice(0, 10)}`,
				ts: peakT || new Date().toISOString(),
				source: "carbon-uk-hist",
				layer,
				title: `UK grid 24h peak ${Math.round(peak)} gCO₂/kWh`,
				severity: peak >= 300 ? "watch" : "info",
				confidence: 0.9,
				entities: { country: "GBR" },
				meta: { peak: Math.round(peak) },
			});
			n++;
		}
		await markHealth("carbon-uk-hist", true);
	} catch (e: unknown) {
		errors.push(`carbon-uk-hist: ${errMsg(e)}`);
		await markHealth("carbon-uk-hist", false, errors[errors.length - 1]);
	}

	// Fraunhofer Energy-Charts public power DE (keyless, 15-min slots):
	// latest-slot mix rows for the 3 biggest positive contributors.
	try {
		const url = "https://api.energy-charts.info/public_power?country=de";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			unix_seconds?: number[];
			production_types?: { name?: string; data?: (number | null)[] }[];
		};
		const slots = j.unix_seconds ?? [];
		const types = j.production_types ?? [];
		const last = slots.length - 1;
		const ranked = types
			.map((t) => ({ name: t.name ?? "?", mw: t.data?.[last] ?? null }))
			.filter(
				(t): t is { name: string; mw: number } =>
					typeof t.mw === "number" && t.mw > 0,
			)
			.sort((a, b) => b.mw - a.mw)
			.slice(0, 3);
		await storeRaw("energy-charts", layer, res.status, {
			n: ranked.length,
			ts: slots[last] ?? null,
		});
		for (const r of ranked) {
			await storeNormalized({
				id: `echarts:de:${r.name.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}:${slots[last] ?? "latest"}`,
				ts: new Date((slots[last] ?? Date.now() / 1000) * 1000).toISOString(),
				source: "energy-charts",
				layer,
				title: `DE power ${r.name}: ${Math.round(r.mw).toLocaleString()} MW`,
				severity: "info",
				confidence: 0.85,
				entities: { country: "DEU" },
				meta: { fuel: r.name, mw: Math.round(r.mw) },
			});
			n++;
		}
		await markHealth("energy-charts", true);
	} catch (e: unknown) {
		errors.push(`energy-charts: ${errMsg(e)}`);
		await markHealth("energy-charts", false, errors[errors.length - 1]);
	}

	// Fraunhofer Energy-Charts public power FR (keyless, 15-min slots):
	// same latest-slot shape as DE — the French-mix leg.
	try {
		const url = "https://api.energy-charts.info/public_power?country=fr";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			unix_seconds?: number[];
			production_types?: { name?: string; data?: (number | null)[] }[];
		};
		const slots = j.unix_seconds ?? [];
		const types = j.production_types ?? [];
		const last = slots.length - 1;
		const ranked = types
			.map((t) => ({ name: t.name ?? "?", mw: t.data?.[last] ?? null }))
			.filter(
				(t): t is { name: string; mw: number } =>
					typeof t.mw === "number" && t.mw > 0,
			)
			.sort((a, b) => b.mw - a.mw)
			.slice(0, 3);
		await storeRaw("energy-charts-fr", layer, res.status, {
			n: ranked.length,
			ts: slots[last] ?? null,
		});
		for (const r of ranked) {
			await storeNormalized({
				id: `echarts:fr:${r.name.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}:${slots[last] ?? "latest"}`,
				ts: new Date((slots[last] ?? Date.now() / 1000) * 1000).toISOString(),
				source: "energy-charts-fr",
				layer,
				title: `FR power ${r.name}: ${Math.round(r.mw).toLocaleString()} MW`,
				severity: "info",
				confidence: 0.85,
				entities: { country: "FRA" },
				meta: { fuel: r.name, mw: Math.round(r.mw) },
			});
			n++;
		}
		await markHealth("energy-charts-fr", true);
	} catch (e: unknown) {
		errors.push(`energy-charts-fr: ${errMsg(e)}`);
		await markHealth("energy-charts-fr", false, errors[errors.length - 1]);
	}

	// Fraunhofer Energy-Charts ES + IT + NL + PL + BE + AT + SE + DK
	// + PT + GR + FI + NO + CZ + HU + SI + RO + SK + HR + IE + LU + EE
	// + LV + LT (keyless, same shape): EU27 with DE/FR — see ECHARTS_* for
	// the window and spacing. RO/SK/HR/IE/LU/EE/LV/LT probe-verified 2026-09-17 (LV needed a
	// retry after a 429); GB answers 400, MT/CY/RS/TR/IS 429 — skipped.
	for (const [cc, iso] of [
		["es", "ESP"],
		["it", "ITA"],
		["nl", "NLD"],
		["pl", "POL"],
		["be", "BEL"],
		["at", "AUT"],
		["se", "SWE"],
		["dk", "DNK"],
		["pt", "PRT"],
		["gr", "GRC"],
		["fi", "FIN"],
		["no", "NOR"],
		["cz", "CZE"],
		["hu", "HUN"],
		["si", "SVN"],
		["ro", "ROU"],
		["sk", "SVK"],
		["hr", "HRV"],
		["ie", "IRL"],
		["lu", "LUX"],
		["ee", "EST"],
		["lv", "LVA"],
		["lt", "LTU"],
	] as const) {
		try {
			await sleep(ECHARTS_SPACING_MS);
			const end = new Date();
			const start = new Date(end.getTime() - ECHARTS_WINDOW_MS);
			const minute = (d: Date) => `${d.toISOString().slice(0, 16)}Z`;
			const url = `https://api.energy-charts.info/public_power?country=${cc}&start=${minute(start)}&end=${minute(end)}`;
			assertSafeUrl(url);
			let res = await stealthFetch(url);
			if (res.status === 429) {
				await res.arrayBuffer();
				await sleep(ECHARTS_429_PAUSE_MS);
				res = await stealthFetch(url);
			}
			if (!res.ok) throw new Error(`HTTP ${res.status} ${cc}`);
			const j = (await res.json()) as EchartsPower;
			const slots = j.unix_seconds ?? [];
			const types = j.production_types ?? [];
			const last = latestFilledSlot(j);
			if (last < 0) throw new Error(`no data in 48h ${cc}`);
			const ranked = types
				.map((t) => ({ name: t.name ?? "?", mw: t.data?.[last] ?? null }))
				.filter(
					(t): t is { name: string; mw: number } =>
						typeof t.mw === "number" && t.mw > 0,
				)
				.sort((a, b) => b.mw - a.mw)
				.slice(0, 3);
			await storeRaw(`energy-charts-${cc}`, layer, res.status, {
				n: ranked.length,
			});
			for (const r of ranked) {
				await storeNormalized({
					id: `echarts:${cc}:${r.name.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}:${slots[last] ?? "latest"}`,
					ts: new Date((slots[last] ?? Date.now() / 1000) * 1000).toISOString(),
					source: `energy-charts-${cc}`,
					layer,
					title: `${cc.toUpperCase()} power ${r.name}: ${Math.round(r.mw).toLocaleString()} MW`,
					severity: "info",
					confidence: 0.85,
					entities: { country: iso },
					meta: { fuel: r.name, mw: Math.round(r.mw) },
				});
				n++;
			}
			await markHealth(`energy-charts-${cc}`, true);
		} catch (e: unknown) {
			errors.push(`energy-charts-${cc}: ${errMsg(e)}`);
			await markHealth(`energy-charts-${cc}`, false, errors[errors.length - 1]);
		}
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

// NOTE: three sibling paths were probed (2026-09-17) and parked, with reason:
// - total_power?country=de → 200, 41 slots, same production_types shape as
//   public_power (a fatter duplicate of the 25-country loop — skip, not new
//   signal).
// - price?country=de → 200, 96 slots of EUR/MWh day-ahead (Bundesnetzagentur
//   via SMARD, CC BY 4.0). Real signal, but every slot is a price row with
//   no severity semantics — parked until a spike rule is specced.
// - signal?country=de → 200, renewable-share + green-signal 0/1/2 series.
//   Real signal, parked with price (needs a threshold rule, not blind rows).
// - dayahead_price → 404 (dropped path).

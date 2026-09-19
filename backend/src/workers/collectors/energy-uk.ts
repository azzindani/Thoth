// UK Carbon Intensity (keyless, National Grid ESO): current grid CO₂
// intensity + index → `energy` layer. Regional but real-time — the only
// live grid-decarbonization signal in the keyless set.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const URL = "https://api.carbonintensity.org.uk/intensity";

const Resp = z.object({
	data: z.array(
		z.object({
			from: z.string().optional(),
			to: z.string().optional(),
			intensity: z
				.object({
					forecast: z.number().nullable().optional(),
					actual: z.number().nullable().optional(),
					index: z.string().nullable().optional(),
				})
				.optional(),
		}),
	),
});

export function gridSeverity(
	index?: string | null,
): "info" | "watch" | "critical" {
	const i = (index ?? "").toLowerCase();
	if (i === "very high") return "critical";
	if (i === "high") return "watch";
	return "info";
}

export async function collect() {
	const source = "carbon-uk";
	const layer = "energy";
	let n = 0;
	const errors: string[] = [];
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const row = Resp.parse(await res.json()).data[0];
		const it = row?.intensity;
		const g = it?.actual ?? it?.forecast;
		if (typeof g !== "number" || !row?.from) throw new Error("no intensity");
		await storeRaw(source, layer, res.status, { g, index: it?.index });
		await storeNormalized({
			id: `carbonuk:${row.from.slice(0, 16)}`,
			ts: row.from,
			source,
			layer,
			title: `UK grid ${g} gCO₂/kWh (${it?.index ?? "?"})`,
			severity: gridSeverity(it?.index),
			confidence: 0.9,
			entities: { country: "GBR" },
			meta: { gco2kwh: g, index: it?.index, forecast: it?.forecast },
		});
		n++;
		await markHealth(source, true);
	} catch (e: unknown) {
		errors.push(`${source}: ${errMsg(e)}`);
		await markHealth(source, false, errors[errors.length - 1]);
	}
	// Carbon Intensity 48h forecast window (keyless, same host): the coming
	// peak forecast + its index — the look-ahead leg next to current
	// intensity. Probe-verified 2026-09-17 (97 half-hour slots).
	try {
		const today = new Date().toISOString().slice(0, 10);
		const url = `https://api.carbonintensity.org.uk/intensity/${today}T00:00Z/fw48h`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = Resp.parse(await res.json()).data;
		await storeRaw("carbon-uk-fw", layer, res.status, { n: rows.length });
		let peak = 0;
		let peakT = "";
		let peakIdx: string | null = null;
		for (const r of rows) {
			const f = r.intensity?.forecast;
			if (typeof f === "number" && f > peak) {
				peak = f;
				peakT = r.from ?? "";
				peakIdx = r.intensity?.index ?? null;
			}
		}
		if (peak > 0 && peakT) {
			await storeNormalized({
				id: `carbonfw:${peakT.slice(0, 10)}`,
				ts: peakT,
				source: "carbon-uk-fw",
				layer,
				title: `UK grid 48h forecast peak ${Math.round(peak)} gCO₂/kWh (${peakIdx ?? "?"})`,
				severity: gridSeverity(peakIdx),
				confidence: 0.85,
				entities: { country: "GBR" },
				meta: { peak: Math.round(peak), index: peakIdx },
			});
			n++;
		}
		await markHealth("carbon-uk-fw", true);
	} catch (e: unknown) {
		errors.push(`carbon-uk-fw: ${errMsg(e)}`);
		await markHealth("carbon-uk-fw", false, errors[errors.length - 1]);
	}
	// Carbon Intensity generation mix (keyless, same host): current fuel
	// shares — wind/solar/gas/nuclear percents. Probe-verified 2026-09-17
	// (wind 56.9% sample).
	try {
		const url = "https://api.carbonintensity.org.uk/generation";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			data?: {
				from?: string;
				generationmix?: { fuel?: string; perc?: number }[];
			};
		};
		const mix = j.data?.generationmix ?? [];
		await storeRaw("carbon-uk-mix", layer, res.status, { n: mix.length });
		const ranked = mix
			.filter(
				(x): x is { fuel: string; perc: number } =>
					typeof x.fuel === "string" && typeof x.perc === "number",
			)
			.sort((a, b) => b.perc - a.perc)
			.slice(0, 3);
		for (const r of ranked) {
			await storeNormalized({
				id: `carbonmix:${r.fuel}:${(j.data?.from ?? "latest").slice(0, 10)}`,
				ts: j.data?.from ?? new Date().toISOString(),
				source: "carbon-uk-mix",
				layer,
				title: `UK generation ${r.fuel}: ${r.perc}%`,
				severity: "info",
				confidence: 0.85,
				entities: { country: "GBR" },
				meta: { fuel: r.fuel, perc: r.perc },
			});
			n++;
		}
		await markHealth("carbon-uk-mix", true);
	} catch (e: unknown) {
		errors.push(`carbon-uk-mix: ${errMsg(e)}`);
		await markHealth("carbon-uk-mix", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

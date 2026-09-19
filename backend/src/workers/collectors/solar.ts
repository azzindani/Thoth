// NOAA SWPC solar depth (keyless): Ovation aurora power, GOES X-ray flux
// (flare class), F10.7 radio flux. The kp/alerts pair in spacewx.ts sees the
// storm; these see the sun driving it.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const Ovation = z.object({
	"Observation Time": z.string().optional(),
	"Forecast Time": z.string().optional(),
	coordinates: z.array(z.array(z.number())).optional(),
});

const Xray = z.object({
	time_tag: z.string().optional(),
	flux: z.number().optional(),
	energy: z.string().optional(),
});

const F107 = z.object({
	time_tag: z.string().optional(),
	flux: z.number().optional(),
});

export function flareClass(flux: number): string {
	// GOES 0.1–0.8nm band, W/m² → A/B/C/M/X.
	if (flux >= 1e-4) return "X";
	if (flux >= 1e-5) return "M";
	if (flux >= 1e-6) return "C";
	if (flux >= 1e-7) return "B";
	return "A";
}

export async function collect() {
	const layer = "spacewx";
	let n = 0;
	const errors: string[] = [];

	// Ovation: max auroral power over the grid ≈ storm visibility right now.
	try {
		const url =
			"https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const ov = Ovation.parse(await res.json());
		await storeRaw("swpc-aurora", layer, res.status, {
			obs: ov["Observation Time"],
		});
		let peak = 0;
		for (const c of ov.coordinates ?? []) peak = Math.max(peak, c[2] ?? 0);
		const obs = Date.parse(ov["Observation Time"] ?? "");
		await storeNormalized({
			id: `swpc:aurora:${(ov["Observation Time"] ?? "").slice(0, 16)}`,
			ts: Number.isNaN(obs)
				? new Date().toISOString()
				: new Date(obs).toISOString(),
			source: "swpc-aurora",
			layer,
			title: `Aurora power peak ${peak}${peak >= 50 ? " — visible mid-latitudes" : ""}`,
			severity: peak >= 80 ? "critical" : peak >= 50 ? "watch" : "info",
			confidence: 0.9,
			entities: {},
			meta: { peak, forecast: ov["Forecast Time"] },
		});
		n++;
		await markHealth("swpc-aurora", true);
	} catch (e: unknown) {
		errors.push(`aurora: ${errMsg(e)}`);
		await markHealth("swpc-aurora", false, errors[errors.length - 1]);
	}

	// GOES X-ray: latest long-band flux → current flare class.
	try {
		const url =
			"https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z.array(Xray).parse(await res.json());
		const long = rows.filter((r) => r.energy === "0.1-0.8nm");
		const last = long[long.length - 1];
		await storeRaw("swpc-xray", layer, res.status, { n: rows.length });
		const flux = Number(last?.flux ?? NaN);
		if (!Number.isFinite(flux) || !last?.time_tag) throw new Error("no flux");
		const cls = flareClass(flux);
		await storeNormalized({
			id: `swpc:xray:${last.time_tag.slice(0, 16)}`,
			ts: last.time_tag,
			source: "swpc-xray",
			layer,
			title: `Solar X-ray ${cls}-class (${flux.toExponential(1)} W/m²)`,
			severity: cls === "X" ? "critical" : cls === "M" ? "watch" : "info",
			confidence: 0.95,
			entities: {},
			meta: { class: cls, flux },
		});
		n++;
		await markHealth("swpc-xray", true);
	} catch (e: unknown) {
		errors.push(`xray: ${errMsg(e)}`);
		await markHealth("swpc-xray", false, errors[errors.length - 1]);
	}

	// F10.7 solar flux: the slow driver behind kp trends.
	try {
		const url = "https://services.swpc.noaa.gov/json/f107_cm_flux.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z.array(F107).parse(await res.json());
		const last = rows[rows.length - 1];
		await storeRaw("swpc-f107", layer, res.status, { n: rows.length });
		const flux = Number(last?.flux ?? NaN);
		if (!Number.isFinite(flux) || !last?.time_tag) throw new Error("no flux");
		await storeNormalized({
			id: `swpc:f107:${last.time_tag.slice(0, 13)}`,
			ts: new Date(last.time_tag).toISOString(),
			source: "swpc-f107",
			layer,
			title: `Solar flux F10.7 ${Math.round(flux)} sfu${flux >= 200 ? " — high activity" : ""}`,
			severity: flux >= 250 ? "watch" : "info",
			confidence: 0.9,
			entities: {},
			meta: { flux: Math.round(flux * 10) / 10 },
		});
		n++;
		await markHealth("swpc-f107", true);
	} catch (e: unknown) {
		errors.push(`f107: ${errMsg(e)}`);
		await markHealth("swpc-f107", false, errors[errors.length - 1]);
	}

	// SILSO daily sunspots (keyless CSV): latest estimated sunspot number.
	try {
		const url = "https://www.sidc.be/SILSO/DATA/EISN/EISN_current.txt";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const lines = (await res.text())
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		const last = lines[lines.length - 1];
		const c = (last ?? "").split(/\s+/);
		const sn = Number(c[4]);
		await storeRaw("silso-daily", layer, res.status, { n: lines.length });
		if (!Number.isFinite(sn) || !c[0]) throw new Error("no sunspots");
		const day = `${c[0]}-${c[1]}-${c[2]}`;
		await storeNormalized({
			id: `silso:${day}`,
			ts: `${day}T12:00:00Z`,
			source: "silso-daily",
			layer,
			title: `Sunspots ${day}: ${sn} (SILSO daily)${sn >= 200 ? " — high activity" : ""}`,
			severity: sn >= 250 ? "watch" : "info",
			confidence: 0.9,
			entities: {},
			meta: { sunspots: sn },
		});
		n++;
		await markHealth("silso-daily", true);
	} catch (e: unknown) {
		errors.push(`silso: ${errMsg(e)}`);
		await markHealth("silso-daily", false, errors[errors.length - 1]);
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

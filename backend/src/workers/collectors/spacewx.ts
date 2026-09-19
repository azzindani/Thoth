import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

export function flareClass(flux: number): string {
	// GOES 0.1–0.8nm band, W/m² → A/B/C/M/X.
	if (flux >= 1e-4) return "X";
	if (flux >= 1e-5) return "M";
	if (flux >= 1e-6) return "C";
	if (flux >= 1e-7) return "B";
	return "A";
}

// NOAA SWPC, keyless: planetary K-index (1m) + active alerts. No geo — comms/GPS impact context layer.
const KP_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";
const ALERTS_URL = "https://services.swpc.noaa.gov/products/alerts.json";

type KpRow = { time_tag?: string; kp_index?: number; kp?: number };
type SwpcAlert = {
	message?: string;
	messageid?: string;
	issue_datetime?: string;
	messagetype?: string;
};

export async function collect() {
	const layer = "spacewx";
	let n = 0;
	const errors: string[] = [];
	try {
		assertSafeUrl(KP_URL);
		const res = await stealthFetch(KP_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const raw = (await res.json()) as KpRow[];
		const rows = Array.isArray(raw) ? raw : [];
		const last = rows.slice(-1)[0];
		await storeRaw("swpc-kp", layer, res.status, { last });
		const kp = Number(last?.kp_index ?? last?.kp ?? NaN);
		if (!Number.isNaN(kp)) {
			const tag =
				typeof last?.time_tag === "string"
					? last.time_tag
					: new Date().toISOString();
			await storeNormalized({
				id: `swpc:kp:${tag.slice(0, 16)}`,
				ts: tag,
				source: "swpc-kp",
				layer,
				title: `Planetary K-index ${kp}${kp >= 5 ? " — geomagnetic storm" : ""}`,
				severity: kp >= 7 ? "critical" : kp >= 5 ? "watch" : "info",
				confidence: 0.95,
				entities: {},
				meta: { kp },
			});
			n++;
		}
		await markHealth("swpc-kp", true);
	} catch (e: unknown) {
		errors.push(`kp: ${errMsg(e)}`);
		await markHealth("swpc-kp", false, errors[errors.length - 1]);
	}
	try {
		assertSafeUrl(ALERTS_URL);
		const res = await stealthFetch(ALERTS_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const raw = (await res.json()) as SwpcAlert[];
		const alerts = Array.isArray(raw) ? raw : [];
		await storeRaw("swpc-alerts", layer, res.status, { n: alerts.length });
		for (const a of alerts.slice(0, 20)) {
			const message = typeof a.message === "string" ? a.message : "SWPC alert";
			const ts =
				typeof a.issue_datetime === "string"
					? a.issue_datetime
					: new Date().toISOString();
			await storeNormalized({
				id: `swpc:alert:${String(a.messageid ?? a.issue_datetime ?? Math.random())}`,
				ts,
				source: "swpc-alerts",
				layer,
				title: message,
				severity: /warning/i.test(message) ? "watch" : "info",
				confidence: 0.9,
				entities: {},
				meta: { type: a.messagetype },
			});
			n++;
		}
		await markHealth("swpc-alerts", true);
	} catch (e: unknown) {
		errors.push(`alerts: ${errMsg(e)}`);
		await markHealth("swpc-alerts", false, errors[errors.length - 1]);
	}
	// NOAA scales: current R/S/G numbers + 3-day probabilities.
	try {
		const url = "https://services.swpc.noaa.gov/products/noaa-scales.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as Record<
			string,
			{
				R?: { Scale?: string };
				S?: { Scale?: string };
				G?: { Scale?: string };
			}
		>;
		const cur = j["0"];
		await storeRaw("swpc-scales", layer, res.status, { cur });
		const r = cur?.R?.Scale ?? "?";
		const s = cur?.S?.Scale ?? "?";
		const g = cur?.G?.Scale ?? "?";
		const hot = [r, s, g].some((x) => x !== "0" && x !== "?" && x !== null);
		await storeNormalized({
			id: `swpc:scales:${new Date().toISOString().slice(0, 13)}`,
			ts: new Date().toISOString(),
			source: "swpc-scales",
			layer,
			title: `NOAA scales R${r}/S${s}/G${g}${hot ? " — ACTIVE" : ""}`,
			severity: hot ? "watch" : "info",
			confidence: 0.95,
			entities: {},
			meta: { R: r, S: s, G: g },
		});
		n++;
		await markHealth("swpc-scales", true);
	} catch (e: unknown) {
		errors.push(`scales: ${errMsg(e)}`);
		await markHealth("swpc-scales", false, errors[errors.length - 1]);
	}
	// WWV daily digest: tiny text, solar flux + A/K indices verbatim.
	try {
		const url = "https://services.swpc.noaa.gov/text/wwv.txt";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const text = await res.text();
		const mFlux = text.match(/Solar flux (\d+)/i);
		const mK = text.match(/K-index[^0-9]*([\d.]+)/i);
		const mStorm = /storms (were observed|reaching|expected)/i.test(text);
		await storeRaw("swpc-wwv", layer, res.status, { bytes: text.length });
		await storeNormalized({
			id: `swpc:wwv:${new Date().toISOString().slice(0, 10)}`,
			ts: new Date().toISOString(),
			source: "swpc-wwv",
			layer,
			title: `WWV: flux ${mFlux?.[1] ?? "?"} · K ${mK?.[1] ?? "?"}${mStorm ? " — storm mention" : ""}`,
			severity: mStorm ? "watch" : "info",
			confidence: 0.9,
			entities: {},
			meta: { flux: mFlux?.[1] ?? null, k: mK?.[1] ?? null },
		});
		n++;
		await markHealth("swpc-wwv", true);
	} catch (e: unknown) {
		errors.push(`wwv: ${errMsg(e)}`);
		await markHealth("swpc-wwv", false, errors[errors.length - 1]);
	}
	// GOES X-ray 1-day (keyless SWPC, replaces DEMO_KEY DONKI flares which
	// 429 for hours under shared quota): peak long-band flux → flare class.
	try {
		const url =
			"https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z
			.array(
				z.object({
					time_tag: z.string().optional(),
					flux: z.number().optional(),
					energy: z.string().optional(),
				}),
			)
			.parse(await res.json());
		const longs = rows.filter((r) => r.energy === "0.1-0.8nm");
		let peak = 0;
		let peakT = "";
		for (const r of longs) {
			if (typeof r.flux === "number" && r.flux > peak) {
				peak = r.flux;
				peakT = r.time_tag ?? "";
			}
		}
		await storeRaw("goes-xray", layer, res.status, { n: longs.length });
		if (peak > 0) {
			const cls = flareClass(peak);
			await storeNormalized({
				id: `goesx:${peakT.slice(0, 16)}`,
				ts: peakT || new Date().toISOString(),
				source: "goes-xray",
				layer,
				title: `Solar X-ray peak ${cls}-class (${peak.toExponential(1)} W/m² 24h)`,
				severity: cls === "X" ? "critical" : cls === "M" ? "watch" : "info",
				confidence: 0.95,
				entities: {},
				meta: { class: cls, flux: peak },
			});
			n++;
		}
		await markHealth("goes-xray", true);
	} catch (e: unknown) {
		errors.push(`goes-xray: ${errMsg(e)}`);
		await markHealth("goes-xray", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

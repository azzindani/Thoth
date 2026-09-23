// NOAA Storm Prediction Center local storm reports (keyless CSV): today's
// and yesterday's tornado, damaging-wind and hail reports across the US.
// One file holds three sections, each with its own header row. Times are
// HHMM UTC within the SPC "convective day" (12Z to 11:59Z next day).
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const SOURCE = "spc";
const FILES = [
	["today", "https://www.spc.noaa.gov/climo/reports/today.csv", 0],
	["yesterday", "https://www.spc.noaa.gov/climo/reports/yesterday.csv", -1],
] as const;
const CAP_PER_DAY = 200; // big outbreak days run to 1000+ reports

export type StormReport = {
	kind: "tornado" | "wind" | "hail";
	hhmm: string;
	mag: string; // F/EF scale, wind mph, or hail size in 1/100 in ("UNK" allowed)
	location: string;
	county: string;
	state: string;
	lat: number;
	lon: number;
	comments: string;
};

/** Three-section SPC CSV → reports. Comments may contain commas, so
 * fields past the seventh are re-joined. */
export function parseSpcCsv(csv: string): StormReport[] {
	const out: StormReport[] = [];
	let kind: StormReport["kind"] | null = null;
	for (const raw of csv.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (/^Time,/i.test(line)) {
			kind = /F_Scale/i.test(line)
				? "tornado"
				: /Speed/i.test(line)
					? "wind"
					: /Size/i.test(line)
						? "hail"
						: null;
			continue;
		}
		if (!kind) continue;
		const f = line.split(",");
		if (f.length < 7) continue;
		const lat = Number(f[5]);
		const lon = Number(f[6]);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		out.push({
			kind,
			hhmm: f[0].padStart(4, "0"),
			mag: f[1],
			location: f[2],
			county: f[3],
			state: f[4],
			lat,
			lon,
			comments: f.slice(7).join(",").trim(),
		});
	}
	return out;
}

/** Tornadoes are critical; significant severe (hail ≥2 in, wind ≥75 mph)
 * is watch; the rest is routine severe weather. */
export function spcSeverity(r: StormReport): "critical" | "watch" | "info" {
	if (r.kind === "tornado") return "critical";
	const v = Number(r.mag);
	if (r.kind === "hail" && v >= 200) return "watch";
	if (r.kind === "wind" && v >= 75) return "watch";
	return "info";
}

/** Convective day start (00:00Z of day D, where D begins at 12Z). */
export function convectiveDay(now: Date, offsetDays: number): Date {
	const d = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	if (now.getUTCHours() < 12) d.setUTCDate(d.getUTCDate() - 1);
	d.setUTCDate(d.getUTCDate() + offsetDays);
	return d;
}

/** HHMM on convective day D: 1200–2359 on D, 0000–1159 on D+1. */
export function reportTime(day: Date, hhmm: string): string {
	const h = Number(hhmm.slice(0, 2));
	const m = Number(hhmm.slice(2, 4));
	const t = new Date(day);
	if (h < 12) t.setUTCDate(t.getUTCDate() + 1);
	t.setUTCHours(h, m, 0, 0);
	return t.toISOString();
}

function title(r: StormReport): string {
	const where = `${r.location}, ${r.state}`;
	if (r.kind === "tornado")
		return `Tornado${r.mag && r.mag !== "UNK" ? ` (${r.mag})` : ""} · ${where}`;
	if (r.kind === "hail")
		return `Hail ${Number.isFinite(Number(r.mag)) ? `${(Number(r.mag) / 100).toFixed(2)} in` : r.mag} · ${where}`;
	return `Wind ${Number.isFinite(Number(r.mag)) ? `${r.mag} mph` : "damage"} · ${where}`;
}

const RANK = { critical: 0, watch: 1, info: 2 } as const;

export async function collect() {
	const layer = "weather";
	const now = new Date();
	let n = 0;
	const errors: string[] = [];
	for (const [label, url, offset] of FILES) {
		try {
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const reports = parseSpcCsv(await res.text());
			await storeRaw(SOURCE, layer, res.status, {
				day: label,
				n: reports.length,
			});
			const day = convectiveDay(now, offset);
			const dayKey = day.toISOString().slice(0, 10);
			const ranked = reports
				.map((r) => ({ r, sev: spcSeverity(r) }))
				.sort((a, b) => RANK[a.sev] - RANK[b.sev])
				.slice(0, CAP_PER_DAY);
			for (const { r, sev } of ranked) {
				await storeNormalized({
					id: `spc:${dayKey}:${r.kind}:${r.hhmm}:${r.lat}:${r.lon}`,
					ts: reportTime(day, r.hhmm),
					source: SOURCE,
					layer,
					title: title(r).slice(0, 280),
					body: r.comments || undefined,
					url: `https://www.spc.noaa.gov/climo/reports/${label}.html`,
					severity: sev,
					confidence: 0.85,
					lat: r.lat,
					lon: r.lon,
					entities: { state: r.state, county: r.county },
					meta: { kind: r.kind, mag: r.mag, day: dayKey },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`${label}: ${errMsg(e)}`);
		}
	}
	// A quiet day (no reports) is a healthy fetch, not a failure.
	const ok = errors.length < FILES.length;
	await markHealth(SOURCE, ok, errors.length ? errors.join("; ") : undefined);
	return ok ? { ok, count: n } : { ok, error: errors.join("; ") };
}

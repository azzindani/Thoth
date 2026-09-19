import { writeFileSync } from "node:fs";

// One-time build (re-run for refresh): SILSO monthly sunspot numbers
// (WDC-SILSO, Royal Observatory of Belgium, free) → `spacewx` static rows.
// Format: YYYY;MM;decimalYear;monthlyMean;std;obs;definitive(1/0).
// Run: npx tsx src/scripts/build-sunspots.ts
const SRC = "https://www.sidc.be/SILSO/DATA/SN_m_tot_V2.0.csv";

export interface SunspotRow {
	year: number;
	month: number;
	mean: number;
}

export function pickSunspots(csv: string, cap = 120): SunspotRow[] {
	const out: SunspotRow[] = [];
	for (const line of csv.split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		const [ys, ms, , meanS] = t.split(";");
		const year = Number(ys);
		const month = Number(ms);
		const mean = Number((meanS ?? "").trim());
		if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
		if (!Number.isFinite(mean) || mean < 0) continue;
		out.push({ year, month, mean: Math.round(mean * 10) / 10 });
	}
	return out.slice(-cap);
}

// Import-safe: unit tests import pickSunspots without triggering the build.
async function main(): Promise<void> {
	const res = await fetch(SRC, {
		signal: AbortSignal.timeout(120000),
		headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const picks = pickSunspots(await res.text());
	writeFileSync(
		new URL("../../static/sunspots.json", import.meta.url).pathname,
		JSON.stringify(
			{ provenance: "WDC-SILSO monthly sunspot number (free)", items: picks },
			null,
			1,
		),
	);
	console.log(`sunspots: ${picks.length}`);
}

if (process.argv[1]?.endsWith("build-sunspots.ts")) void main();

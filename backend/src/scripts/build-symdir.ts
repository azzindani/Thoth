import { writeFileSync } from "node:fs";

// One-time build (re-run for refresh): NasdaqTrader Symbol Directory →
// compact listed-symbol master (security-master seed for the terminal
// pillar). Source: nasdaqtrader.com SymDir (public, no key, fincept digest
// 2026-09-17). Pipe-delimited, ~13k rows; keep test-issue=N + active only.
// Run: npx tsx src/scripts/build-symdir.ts
const TXT_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt";

export interface SymRow {
	sym: string;
	name: string;
	exch: string;
	etf: boolean;
}

const EXCH: Record<string, string> = {
	N: "NYSE",
	Q: "NASDAQ",
	P: "NYSEArca",
	Z: "CboeBZX",
	V: "IEX",
	A: "NYSEAmerican",
};

/** Keep live listings; drop test issues. Cap 13k (file is ~13k rows).
 * NOTE 2026-09-17: Test Issue flag semantics — N = live, D/E/H = test
 * variants, blank = live (A/AA/AAA all blank-live). Keep N + blank. */
export function pickSymbols(lines: string[], cap = 13000): SymRow[] {
	const out: SymRow[] = [];
	for (const line of lines.slice(1)) {
		const c = line.split("|");
		if (c.length < 12) continue;
		const test = (c[8] ?? "").trim();
		if (test !== "N" && test !== "") continue; // test-issue variants
		if ((c[0] ?? "").trim() !== "Y") continue; // not tradable
		const sym = (c[1] ?? "").trim().toUpperCase();
		if (!sym || sym.includes(" ") || sym.includes("$")) continue;
		out.push({
			sym,
			name: (c[2] ?? "").trim().slice(0, 120),
			exch: EXCH[(c[3] ?? "").trim()] ?? (c[3] ?? "").trim(),
			etf: (c[5] ?? "").trim() === "Y",
		});
		if (out.length >= cap) break;
	}
	return out;
}

// Import-safe: unit tests import pickSymbols without triggering the build.
async function main(): Promise<void> {
	const res = await fetch(TXT_URL, { signal: AbortSignal.timeout(180000) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const text = await res.text();
	const items = pickSymbols(text.split("\n"));
	writeFileSync(
		new URL("../../static/symdir.json", import.meta.url).pathname,
		JSON.stringify({
			provenance: "NasdaqTrader Symbol Directory (public, no key)",
			n: items.length,
			items,
		}),
	);
	console.log(`symdir: ${items.length}`);
}

if (process.argv[1]?.endsWith("build-symdir.ts")) await main();

import { writeFileSync } from "node:fs";

// One-time build (re-run for refresh): Our World in Data electricity mix
// (Ember, CC BY) → `energy` static rows. Latest year per entity, top 60
// entities by total generation share completeness.
// Run: npx tsx src/scripts/build-owid-energy.ts
const SRC =
	"https://ourworldindata.org/grapher/share-elec-by-source.csv?tab=table";

export interface EnergyMix {
	entity: string;
	code: string;
	year: number;
	coal: number | null;
	gas: number | null;
	solar: number | null;
	wind: number | null;
	nuclear: number | null;
	hydro: number | null;
}

export function pickMix(csv: string, cap = 60): EnergyMix[] {
	const lines = csv.split("\n");
	const head = (lines[0] ?? "").split(",");
	const ix = (name: string) => head.indexOf(name);
	const iE = ix("Entity");
	const iC = ix("Code");
	const iY = ix("Year");
	const iCoal = ix("Coal");
	const iGas = ix("Gas");
	const iSol = ix("Solar");
	const iWin = ix("Wind");
	const iNuc = ix("Nuclear");
	const iHyd = ix("Hydropower");
	const num = (row: string[], i: number): number | null => {
		if (i < 0) return null;
		const v = Number(row[i]);
		return Number.isFinite(v) ? v : null;
	};
	const latest = new Map<string, EnergyMix>();
	// Head: Entity,Code,Year,Coal,Gas,Hydropower,Solar,Wind,Oil,Nuclear,...
	// Entity may be quoted with commas. Parse with a tiny CSV reader.
	const parseLine = (line: string): string[] => {
		const out: string[] = [];
		let cur = "";
		let quoted = false;
		for (const ch of line) {
			if (ch === '"') quoted = !quoted;
			else if (ch === "," && !quoted) {
				out.push(cur);
				cur = "";
			} else cur += ch;
		}
		out.push(cur);
		return out;
	};
	for (const line of lines.slice(1)) {
		if (!line.trim()) continue;
		const cells = parseLine(line);
		if (cells.length < head.length) continue;
		const entity = (cells[iE] ?? "").replace(/^"|"$/g, "").trim();
		const code = (cells[iC] ?? "").replace(/"/g, "").trim();
		const year = Number(cells[iY]);
		if (!entity || !Number.isFinite(year)) continue;
		const rec: EnergyMix = {
			entity: entity.slice(0, 80),
			code,
			year,
			coal: num(cells, iCoal),
			gas: num(cells, iGas),
			solar: num(cells, iSol),
			wind: num(cells, iWin),
			nuclear: num(cells, iNuc),
			hydro: num(cells, iHyd),
		};
		const prev = latest.get(entity);
		if (!prev || year > prev.year) latest.set(entity, rec);
	}
	return [...latest.values()]
		.filter(
			(r) =>
				r.entity &&
				r.code &&
				!/\(Ember\)|\(EI\)|World|EU-27|OECD/i.test(r.entity),
		)
		.sort((a, b) => b.year - a.year || a.entity.localeCompare(b.entity))
		.slice(0, cap);
}

// Import-safe: unit tests import pickMix without triggering the build.
async function main(): Promise<void> {
	const res = await fetch(SRC, {
		signal: AbortSignal.timeout(120000),
		headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const picks = pickMix(await res.text());
	writeFileSync(
		new URL("../../static/owid-energy.json", import.meta.url).pathname,
		JSON.stringify(
			{
				provenance: "Our World in Data / Ember electricity mix (CC BY)",
				items: picks,
			},
			null,
			1,
		),
	);
	console.log(`owid-energy: ${picks.length}`);
}

if (process.argv[1]?.endsWith("build-owid-energy.ts")) void main();

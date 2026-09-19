import { readFileSync, writeFileSync } from "node:fs";
import { parseCSV } from "../workers/collectors/sanctions.js";

// One-time build (re-run for refresh): WRI Global Power Plant Database v1.3.0
// (CC BY 4.0, https://datasets.wri.org/dataset/global-power-plant-database)
// → `energy` static. Existing shadowbroker >=1000MW entries are kept; WRI
// rows at the same threshold are appended, deduped by name+country.
// Run: npx tsx src/scripts/build-powerplants.ts
const ZIP_URL =
	"https://datasets.wri.org/private-admin/dataset/53623dfd-3df6-4f15-a091-67457cdb571f/resource/66bcdacc-3d0e-46ad-9271-a5a76b1853d2/download/globalpowerplantdatabasev130.zip";

export interface PlantRow {
	name: string;
	country: string;
	fuel: string;
	mw: number;
	lat: number;
	lon: number;
	owner: string;
}

export function pickPlants(
	head: string[],
	rows: string[][],
	capMW = 1000,
): PlantRow[] {
	const ix = (c: string) => head.indexOf(c);
	const out: PlantRow[] = [];
	for (const r of rows) {
		const mw = Number(r[ix("capacity_mw")]);
		// Number("") is 0 — reject blank coords explicitly.
		const latRaw = (r[ix("latitude")] ?? "").trim();
		const lonRaw = (r[ix("longitude")] ?? "").trim();
		const lat = latRaw ? Number(latRaw) : NaN;
		const lon = lonRaw ? Number(lonRaw) : NaN;
		const name = (r[ix("name")] ?? "").trim().slice(0, 120);
		if (!Number.isFinite(mw) || mw < capMW) continue;
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		if (!name) continue;
		out.push({
			name,
			country: (r[ix("country_long")] ?? r[ix("country")] ?? "")
				.trim()
				.slice(0, 60),
			fuel: (r[ix("primary_fuel")] ?? "").trim().slice(0, 24),
			mw: Math.round(mw * 10) / 10,
			lat,
			lon,
			owner: (r[ix("owner")] ?? "").trim().slice(0, 120),
		});
	}
	return out;
}

// Import-safe: unit tests import pickPlants without triggering the build.
async function main(): Promise<void> {
	const { unzipEntry } = await import("./zip-read.js");
	const res = await fetch(ZIP_URL, {
		signal: AbortSignal.timeout(180000),
		headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const csv = unzipEntry(
		Buffer.from(await res.arrayBuffer()),
		"global_power_plant_database.csv",
	);
	const { head, rows } = parseCSV(csv);
	const picks = pickPlants(head, rows);
	const prev = JSON.parse(
		readFileSync(
			new URL("../../static/energy.json", import.meta.url).pathname,
			"utf8",
		),
	) as { provenance?: string; items: Record<string, unknown>[] };
	const have = new Set(
		prev.items.map(
			(it) =>
				`${String(it.name ?? "").toLowerCase()}|${String(it.country ?? "").toLowerCase()}`,
		),
	);
	const fresh = picks.filter(
		(p) => !have.has(`${p.name.toLowerCase()}|${p.country.toLowerCase()}`),
	);
	prev.items.push(...(fresh as unknown as Record<string, unknown>[]));
	const suffix = " + WRI Global Power Plant DB v1.3.0 (CC BY 4.0, >=1000MW)";
	const prov = prev.provenance ?? "vendored";
	writeFileSync(
		new URL("../../static/energy.json", import.meta.url).pathname,
		JSON.stringify({
			provenance: prov.includes("WRI") ? prov : prov + suffix,
			n: prev.items.length,
			items: prev.items,
		}),
	);
	console.log(
		`energy: +${fresh.length} wri (scanned ${rows.length}, total ${prev.items.length})`,
	);
}

if (process.argv[1]?.endsWith("build-powerplants.ts")) await main();

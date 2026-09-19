import { writeFileSync } from "node:fs";
import { parseCSV } from "../workers/collectors/sanctions.js";

// One-time build (re-run for refresh): OurAirports daily dump → compact
// large + scheduled-medium airport map. Source: OurAirports (public domain,
// https://ourairports.com/data, Unlicense via davidmegginson/ourairports-data).
// Run: npx tsx src/scripts/build-airports.ts
const CSV_URL =
	"https://davidmegginson.github.io/ourairports-data/airports.csv";

export interface AirportRow {
	iata: string;
	icao: string;
	name: string;
	city: string;
	country: string;
	lat: number;
	lon: number;
	scheduled: boolean;
}

/** Keep large + medium airports; drop heliports/strips/closed fields.
 * (scheduled_service is sparsely set upstream — Changi itself reads 0 —
 * so it rides as metadata, never as a filter.) */
export function pickAirports(
	head: string[],
	rows: string[][],
	cap = 6000,
): AirportRow[] {
	const ix = (c: string) => head.indexOf(c);
	const out: AirportRow[] = [];
	for (const r of rows) {
		const type = r[ix("type")] ?? "";
		const sched = (r[ix("scheduled_service")] ?? "").trim();
		if (type !== "large_airport" && type !== "medium_airport") continue;
		const lat = Number(r[ix("latitude_deg")]);
		const lon = Number(r[ix("longitude_deg")]);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		const ident = (r[ix("ident")] ?? "").trim().toUpperCase();
		const gps = (r[ix("gps_code")] ?? "").trim().toUpperCase();
		const icao = /^[A-Z0-9]{4}$/.test(ident)
			? ident
			: /^[A-Z0-9]{4}$/.test(gps)
				? gps
				: "";
		out.push({
			iata: (r[ix("iata_code")] ?? "").trim().toUpperCase(),
			icao,
			name: (r[ix("name")] ?? "").trim().slice(0, 120),
			city: (r[ix("municipality")] ?? "").trim().slice(0, 80),
			country: (r[ix("iso_country")] ?? "").trim().toUpperCase(),
			lat,
			lon,
			scheduled: sched === "1",
		});
		if (out.length >= cap) break;
	}
	return out;
}

// Import-safe: unit tests import pickAirports without triggering the build.
async function main(): Promise<void> {
	const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(180000) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const { head, rows } = parseCSV(await res.text());
	const items = pickAirports(head, rows);
	writeFileSync(
		new URL("../../static/airports.json", import.meta.url).pathname,
		JSON.stringify({
			provenance: "OurAirports daily dump (public domain)",
			n: items.length,
			items,
		}),
	);
	console.log(`airports: ${items.length} (from ${rows.length} rows)`);
}

if (process.argv[1]?.endsWith("build-airports.ts")) await main();

import { readFileSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";

// One-time build (re-run for refresh): UCDP GED v26.1 event CSV (free for
// research/teaching, https://ucdp.uu.se/downloads/) → per-conflict aggregates
// appended to `conflicts` static. Existing 10 hand-curated entries are kept;
// GED rows whose conflict matches one are skipped (token overlap) so Ukraine
// etc. don't double-pin. NOTE: this is the downloads path — the UCDP *API*
// needs a token and is NOT used.
// Run: npx tsx src/scripts/build-ucdp.ts
const ZIP_URL = "https://ucdp.uu.se/downloads/ged/ged261-csv.zip";

export interface ConflictAgg {
	name: string;
	violence: string;
	deaths: number;
	events: number;
	yearFrom: number;
	yearTo: number;
	lat: number;
	lon: number;
	countries: string[];
	intensity: "high" | "medium" | "low";
}

// Single-pass CSV: GED is ~274MB / ~1.5M rows — aggregate per completed
// line, never accumulate rows. Only the per-conflict map (~hundreds) persists.
type Acc = ConflictAgg & {
	latSum: number;
	lonSum: number;
	n: number;
	cc: Set<string>;
};

export async function aggregateGed(
	stream: AsyncIterable<Uint8Array>,
	minYear = 2015,
): Promise<ConflictAgg[]> {
	const agg = new Map<string, Acc>();
	let cols: Record<string, number> | null = null;
	let rows = 0;

	function splitLine(raw: string): string[] {
		const fields: string[] = [];
		let cur = "";
		let q = false;
		for (let i = 0; i < raw.length; i++) {
			const c = raw[i];
			if (q) {
				if (c === '"' && raw[i + 1] === '"') {
					cur += '"';
					i++;
				} else if (c === '"') q = false;
				else cur += c;
			} else if (c === '"') q = true;
			else if (c === ",") {
				fields.push(cur);
				cur = "";
			} else cur += c;
		}
		fields.push(cur);
		return fields;
	}

	function eat(raw: string) {
		const f = splitLine(raw);
		if (!cols) {
			// header row: freeze column indices once
			const c: Record<string, number> = {};
			f.forEach((h, i) => {
				c[h.trim()] = i;
			});
			cols = c;
			return;
		}
		const cc: Record<string, number> = cols;
		const year = Number(f[cc.year]);
		if (!Number.isFinite(year) || year < minYear) return;
		const name = (f[cc.conflict_name] ?? "").trim();
		if (!name) return;
		rows++;
		const deaths = Number(f[cc.best] ?? 0);
		const lat = Number(f[cc.latitude]);
		const lon = Number(f[cc.longitude]);
		const tov = (f[cc.type_of_violence] ?? "").trim();
		let a = agg.get(name);
		if (!a) {
			a = {
				name,
				violence: tov,
				deaths: 0,
				events: 0,
				yearFrom: year,
				yearTo: year,
				lat: 0,
				lon: 0,
				countries: [],
				intensity: "low",
				latSum: 0,
				lonSum: 0,
				n: 0,
				cc: new Set(),
			};
			agg.set(name, a);
		}
		a.events++;
		if (Number.isFinite(deaths)) a.deaths += deaths;
		a.yearFrom = Math.min(a.yearFrom, year);
		a.yearTo = Math.max(a.yearTo, year);
		const ctry = (f[cc.country] ?? "").trim();
		if (ctry) a.cc.add(ctry);
		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			a.latSum += lat;
			a.lonSum += lon;
			a.n++;
		}
	}

	// quote-aware line splitter over chunk boundaries
	let carry = "";
	let inQ = false;
	for await (const chunk of stream) {
		carry += Buffer.from(chunk).toString("utf8");
		let start = 0;
		for (let i = 0; i < carry.length; i++) {
			const c = carry[i];
			if (c === '"') {
				if (inQ && carry[i + 1] === '"') i++;
				else inQ = !inQ;
			} else if ((c === "\n" || c === "\r") && !inQ) {
				eat(carry.slice(start, i));
				if (c === "\r" && carry[i + 1] === "\n") i++;
				start = i + 1;
			}
		}
		carry = carry.slice(start);
	}
	if (carry.trim()) eat(carry);
	console.log(
		`ged: scanned ${rows} post-${minYear} rows into ${agg.size} conflicts`,
	);
	const out: ConflictAgg[] = [];
	for (const a of agg.values()) {
		if (a.n === 0) continue;
		const deaths = Math.round(a.deaths);
		out.push({
			name: a.name,
			violence:
				a.violence === "1"
					? "state-based"
					: a.violence === "2"
						? "non-state"
						: a.violence === "3"
							? "one-sided"
							: a.violence,
			deaths,
			events: a.events,
			yearFrom: a.yearFrom,
			yearTo: a.yearTo,
			lat: Math.round((a.latSum / a.n) * 10000) / 10000,
			lon: Math.round((a.lonSum / a.n) * 10000) / 10000,
			countries: [...a.cc].sort(),
			intensity: deaths >= 5000 ? "high" : deaths >= 500 ? "medium" : "low",
		});
	}
	return out.sort((x, y) => y.deaths - x.deaths);
}

const SKIP_TOKENS = [
	"ukraine",
	"gaza",
	"israel",
	"sudan",
	"myanmar",
	"syria",
	"yemen",
	"ethiopia",
	"sahel",
	"congo",
	"haiti",
	"somalia",
	"afghanistan",
];

// Import-safe: unit tests import aggregateGed without triggering the build.
async function main(): Promise<void> {
	const { unzipEntry } = await import("./zip-read.js");
	const res = await fetch(ZIP_URL, {
		signal: AbortSignal.timeout(300000),
		headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
	});
	if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
	// Zip still needs one buffer for inflate; the CSV parse itself streams.
	const csv = unzipEntry(Buffer.from(await res.arrayBuffer()), ".csv");
	const aggs = await aggregateGed(
		Readable.toWeb(
			Readable.from([csv]),
		) as unknown as AsyncIterable<Uint8Array>,
	);
	const prev = JSON.parse(
		readFileSync(
			new URL("../../static/conflicts.json", import.meta.url).pathname,
			"utf8",
		),
	) as { provenance?: string; items: Record<string, unknown>[] };
	const fresh = aggs
		.filter((a) => {
			const l = a.name.toLowerCase();
			return !SKIP_TOKENS.some((t) => l.includes(t));
		})
		.slice(0, 60)
		.map((a) => ({
			name: a.name,
			lat: a.lat,
			lon: a.lon,
			type: `ucdp ${a.violence}`,
			intensity: a.intensity,
			deaths: a.deaths,
			events: a.events,
			years: `${a.yearFrom}–${a.yearTo}`,
			countries: a.countries,
		}));
	prev.items.push(...(fresh as unknown as Record<string, unknown>[]));
	const suffix =
		" + UCDP GED v26.1 per-conflict aggregates (2015+, free research use)";
	const prov = prev.provenance ?? "vendored";
	writeFileSync(
		new URL("../../static/conflicts.json", import.meta.url).pathname,
		JSON.stringify({
			provenance: prov.includes("UCDP") ? prov : prov + suffix,
			n: prev.items.length,
			items: prev.items,
		}),
	);
	console.log(
		`conflicts: +${fresh.length} ucdp (aggregated ${aggs.length}, total ${prev.items.length})`,
	);
}

if (process.argv[1]?.endsWith("build-ucdp.ts")) await main();

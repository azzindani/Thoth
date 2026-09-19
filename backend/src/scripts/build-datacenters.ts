import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

// One-time build (re-run for refresh): PeeringDB facilities (guest reads need
// no key) → top interconnection facilities appended to the datacenter map.
// Existing shadowbroker entries are kept; dedupe is by normalized name+city.
// Run: npx tsx src/scripts/build-datacenters.ts
const FAC_URL = "https://api.peeringdb.com/api/fac";

const Fac = z.object({
	id: z.number().optional(),
	name: z.string().optional(),
	org_name: z.string().optional(),
	city: z.string().optional(),
	country: z.string().optional(),
	latitude: z.number().nullable().optional(),
	longitude: z.number().nullable().optional(),
	net_count: z.number().nullable().optional(),
	status: z.string().optional(),
});

export interface DcRow {
	name: string;
	company: string;
	city: string;
	country: string;
	lat: number;
	lng: number;
	net_count: number;
	src: string;
}

export function pickFacilities(raw: unknown[], cap = 400): DcRow[] {
	const rows = z.array(Fac).parse(raw);
	return rows
		.filter(
			(f) =>
				(f.status ?? "ok") === "ok" &&
				typeof f.latitude === "number" &&
				typeof f.longitude === "number" &&
				(f.name ?? "").trim().length > 0,
		)
		.sort((a, b) => (b.net_count ?? 0) - (a.net_count ?? 0))
		.slice(0, cap)
		.map((f) => ({
			name: String(f.name).slice(0, 120),
			company: String(f.org_name ?? "").slice(0, 80),
			city: String(f.city ?? "").slice(0, 80),
			country: String(f.country ?? "")
				.toUpperCase()
				.slice(0, 4),
			lat: Number(f.latitude),
			lng: Number(f.longitude),
			net_count: Number(f.net_count ?? 0),
			src: "peeringdb",
		}));
}

// Import-safe: unit tests import pickFacilities without triggering the build.
async function main(): Promise<void> {
	const seen: unknown[] = [];
	// First pages skew old (low IDs = the giants: Equinix Ashburn is id 1),
	// which is exactly the bias a top-by-networks list wants.
	for (let skip = 0; skip < 2000; skip += 250) {
		const url = `${FAC_URL}?limit=250&skip=${skip}&depth=0`;
		const res = await fetch(url, {
			signal: AbortSignal.timeout(60000),
			headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status} at skip=${skip}`);
		const json = (await res.json()) as { data?: unknown };
		const page = Array.isArray(json.data) ? json.data : [];
		if (!page.length) break;
		seen.push(...page);
		if (page.length < 250) break;
	}
	const picks = pickFacilities(seen);
	const prev = JSON.parse(
		readFileSync(
			new URL("../../static/datacenters.json", import.meta.url).pathname,
			"utf8",
		),
	) as { provenance?: string; items: Record<string, unknown>[] };
	const have = new Set(
		prev.items.map(
			(it) =>
				`${String(it.name ?? "").toLowerCase()}|${String(it.city ?? "").toLowerCase()}`,
		),
	);
	const fresh = picks.filter(
		(p) => !have.has(`${p.name.toLowerCase()}|${p.city.toLowerCase()}`),
	);
	prev.items.push(...(fresh as unknown as Record<string, unknown>[]));
	const suffix = " + PeeringDB facilities (guest reads, top interconnection)";
	const prov = prev.provenance ?? "vendored";
	writeFileSync(
		new URL("../../static/datacenters.json", import.meta.url).pathname,
		JSON.stringify({
			provenance: prov.includes("PeeringDB") ? prov : prov + suffix,
			n: prev.items.length,
			items: prev.items,
		}),
	);
	console.log(
		`datacenters: +${fresh.length} peeringdb (scanned ${seen.length}, total ${prev.items.length})`,
	);
}

if (process.argv[1]?.endsWith("build-datacenters.ts")) await main();

import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

// One-time build (re-run for refresh): Natural Earth 10m ports (public domain,
// https://www.naturalearthdata.com/downloads/10m-cultural-vectors/ports)
// → `ports` static. Existing osiris top-container entries are kept; NE world
// ports are appended, deduped by name+country.
// Run: npx tsx src/scripts/build-ports-wpi.ts
const GEO_URL =
	"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_ports.geojson";

const Feature = z.object({
	properties: z
		.object({
			name: z.string().optional(),
			website: z.string().nullable().optional(),
		})
		.passthrough(),
	geometry: z.object({
		type: z.string(),
		coordinates: z.array(z.number()),
	}),
});

export interface PortRow {
	name: string;
	country: string;
	lat: number;
	lon: number;
	type: string;
	website?: string;
}

export function pickPorts(raw: unknown): PortRow[] {
	const feats = z
		.array(Feature)
		.parse((raw as { features?: unknown })?.features ?? raw);
	const out: PortRow[] = [];
	for (const f of feats) {
		const name = (f.properties.name ?? "").trim().slice(0, 120);
		const [lon, lat] = f.geometry.coordinates;
		if (!name) continue;
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		out.push({
			name,
			country: "?",
			lat,
			lon,
			type: "port",
			website: f.properties.website ?? undefined,
		});
	}
	return out;
}

// Import-safe: unit tests import pickPorts without triggering the build.
async function main(): Promise<void> {
	const res = await fetch(GEO_URL, {
		signal: AbortSignal.timeout(120000),
		headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const picks = pickPorts(await res.json());
	const prev = JSON.parse(
		readFileSync(
			new URL("../../static/ports.json", import.meta.url).pathname,
			"utf8",
		),
	) as { provenance?: string; items: Record<string, unknown>[] };
	const have = new Set(
		prev.items.map((it) => String(it.name ?? "").toLowerCase()),
	);
	const fresh = picks.filter((p) => !have.has(p.name.toLowerCase()));
	prev.items.push(...(fresh as unknown as Record<string, unknown>[]));
	const suffix = " + Natural Earth 10m ports (public domain)";
	const prov = prev.provenance ?? "vendored";
	writeFileSync(
		new URL("../../static/ports.json", import.meta.url).pathname,
		JSON.stringify({
			provenance: prov.includes("Natural Earth") ? prov : prov + suffix,
			n: prev.items.length,
			items: prev.items,
		}),
	);
	console.log(
		`ports: +${fresh.length} natural-earth (scanned ${picks.length}, total ${prev.items.length})`,
	);
}

if (process.argv[1]?.endsWith("build-ports-wpi.ts")) await main();

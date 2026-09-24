import { readFileSync } from "node:fs";
import { pool } from "../db/client.js";

// Idempotent seed of static intel layers (vendored PORT-*.md statics).
// Re-run anytime; stable ids refresh in place via ON CONFLICT.
const LAYERS: {
	file: string;
	layer: string;
	title: (it: Record<string, unknown>) => string;
}[] = [
	{
		file: "bases.json",
		layer: "bases",
		title: (it) => String(it.name ?? "base"),
	},
	{
		file: "chokepoints.json",
		layer: "chokepoints",
		title: (it) => String(it.name ?? "chokepoint"),
	},
	{
		file: "conflicts.json",
		layer: "conflicts",
		title: (it) => String(it.name ?? "conflict"),
	},
	{
		file: "ports.json",
		layer: "ports",
		title: (it) => `${it.name} (${it.country ?? "?"})`,
	},
	{
		file: "airports.json",
		layer: "airports",
		title: (it) => `${it.iata ?? it.icao} — ${it.name}`,
	},
	{
		file: "datacenters.json",
		layer: "datacenters",
		title: (it) => `${it.name} (${it.city ?? "?"})`,
	},
	{
		file: "energy.json",
		layer: "energy",
		title: (it) => `${it.name} — ${it.mw}MW ${it.fuel ?? ""}`,
	},
	{
		file: "signals.json",
		layer: "signals",
		title: (it) => `KiwiSDR — ${it.name}`,
	},
	{
		file: "owid-energy.json",
		layer: "energy",
		title: (it) =>
			`${it.entity} electricity: coal ${it.coal ?? "?"}% · gas ${it.gas ?? "?"}% · solar ${it.solar ?? "?"}% · wind ${it.wind ?? "?"}% (${it.year})`,
	},
	{
		file: "sunspots.json",
		layer: "spacewx",
		title: (it) =>
			`Sunspots ${it.year}-${String(it.month).padStart(2, "0")}: ${it.mean}`,
	},
];

for (const { file, layer, title } of LAYERS) {
	const raw = JSON.parse(
		readFileSync(
			new URL(`../../static/${file}`, import.meta.url).pathname,
			"utf8",
		),
	) as { items: Record<string, unknown>[] };
	let n = 0;
	for (const it of raw.items) {
		const name = title(it).slice(0, 300);
		const lat = Number(it.lat);
		const lon = Number(it.lon ?? it.lng);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		const id = `static:${layer}:${name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.slice(0, 120)}`;
		await pool.query(
			`INSERT INTO events(id, ts, source, layer, title, severity, confidence, geom, entities, meta)
       VALUES ($1, now(), 'static', $2, $3, $4, 1.0,
          ST_SetSRID(ST_MakePoint($5::float,$6::float),4326), '{}', $7)
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, geom=EXCLUDED.geom, meta=EXCLUDED.meta,
          -- last-seen refresh, same contract as storeNormalized (24h stats window)
          ingested_at=now()`,
			[
				id,
				layer,
				name,
				it.intensity === "high" || it.risk === "high" ? "watch" : "info",
				lon,
				lat,
				JSON.stringify(it),
			],
		);
		n++;
	}
	await pool.query(
		`INSERT INTO layer_versions(layer, version) VALUES ($1, 1)
     ON CONFLICT (layer) DO UPDATE SET version = layer_versions.version + 1`,
		[layer],
	);
	console.log(`${layer}: ${n}`);
}
// Theaters: ironsight city datasets → `theaters` reference layer.
const th = JSON.parse(
	readFileSync(
		new URL("../../static/theaters.json", import.meta.url).pathname,
		"utf8",
	),
) as {
	theaters: Record<
		string,
		{
			label: string;
			cities: {
				name: string;
				lat: number;
				lon: number;
				country: string;
				capital: boolean;
			}[];
		}
	>;
};
let tn = 0;
for (const [key, t] of Object.entries(th.theaters)) {
	for (const c of t.cities) {
		const id = `static:theaters:${key}:${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
		await pool.query(
			`INSERT INTO events(id, ts, source, layer, title, severity, confidence, geom, entities, meta)
       VALUES ($1, now(), 'static', 'theaters', $2, 'info', 1.0,
          ST_SetSRID(ST_MakePoint($3::float,$4::float),4326), '{}', $5)
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, geom=EXCLUDED.geom, meta=EXCLUDED.meta,
          -- last-seen refresh, same contract as storeNormalized (24h stats window)
          ingested_at=now()`,
			[
				id,
				`${c.name} (${c.country})`,
				c.lon,
				c.lat,
				JSON.stringify({
					theater: key,
					label: t.label,
					capital: c.capital,
					country: c.country,
				}),
			],
		);
		tn++;
	}
}
await pool.query(
	`INSERT INTO layer_versions(layer, version) VALUES ('theaters', 1)
   ON CONFLICT (layer) DO UPDATE SET version = layer_versions.version + 1`,
);
console.log(`theaters: ${tn}`);
await pool.end();
console.log("statics seeded");

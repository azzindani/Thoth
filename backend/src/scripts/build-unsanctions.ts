import { pool } from "../db/client.js";

// One-time build (re-run for refresh): UN Security Council consolidated
// sanctions XML (public, updated daily) → sanctions_entities with
// dataset='unsc'. Name = FIRST+SECOND(+THIRD/FOURTH); aliases from
// INDIVIDUAL_ALIAS / ALIAS_NAME; countries from NATIONALITY values.
// Follows redirects (302 → www.un.org download host).
// Run: npx tsx src/scripts/build-unsanctions.ts
const URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";

function tag(block: string, name: string): string[] {
	const out: string[] = [];
	for (const m of block.matchAll(
		new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"),
	)) {
		const v = m[1].trim();
		if (v) out.push(v);
	}
	return out;
}

function values(block: string, outer: string): string[] {
	const out: string[] = [];
	for (const m of block.matchAll(
		new RegExp(`<${outer}>[\\s\\S]*?</${outer}>`, "g"),
	)) {
		for (const v of m[0].matchAll(/<VALUE>([\s\S]*?)<\/VALUE>/g)) {
			const t = v[1].trim();
			if (t) out.push(t);
		}
	}
	return out;
}

export interface UnRow {
	id: string;
	schema: string;
	name: string;
	aliases: string[];
	countries: string[];
	ref: string;
	listed: string;
}

export function parseUnXml(xml: string): UnRow[] {
	const out: UnRow[] = [];
	for (const kind of ["INDIVIDUAL", "ENTITY"] as const) {
		for (const m of xml.matchAll(
			new RegExp(`<${kind}>([\\s\\S]*?)</${kind}>`, "g"),
		)) {
			const b = m[1];
			const one = (t: string) => tag(b, t)[0] ?? "";
			const parts = [
				one("FIRST_NAME"),
				one("SECOND_NAME"),
				one("THIRD_NAME"),
				one("FOURTH_NAME"),
			]
				.filter(Boolean)
				.join(" ");
			const aliasNames =
				kind === "INDIVIDUAL"
					? tag(b, "INDIVIDUAL_ALIAS").flatMap((a) =>
							tag(`<X>${a}</X>`, "ALIAS_NAME"),
						)
					: tag(b, "ALIAS_NAME");
			const name = parts || aliasNames[0] || one("REFERENCE_NUMBER");
			if (!name) continue;
			out.push({
				id: `unsc:${one("DATAID") || one("REFERENCE_NUMBER")}`,
				schema: kind === "INDIVIDUAL" ? "Person" : "Organization",
				name: name.slice(0, 300),
				aliases: [...new Set(aliasNames)]
					.slice(0, 20)
					.map((a) => a.slice(0, 200)),
				countries: [...new Set(values(b, "NATIONALITY"))].slice(0, 10),
				ref: one("REFERENCE_NUMBER"),
				listed: one("LISTED_ON"),
			});
		}
	}
	return out;
}

// Import-safe: unit tests import parseUnXml without triggering the build.
async function main(): Promise<void> {
	const res = await fetch(URL, {
		signal: AbortSignal.timeout(180000),
		headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
		redirect: "follow",
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const rows = parseUnXml(await res.text());
	let n = 0;
	for (const r of rows) {
		await pool.query(
			`INSERT INTO sanctions_entities(id, schema, name, aliases, countries, dataset, meta)
	     VALUES ($1,$2,$3,$4,$5,'unsc',$6)
	     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, aliases=EXCLUDED.aliases,
	       countries=EXCLUDED.countries, meta=EXCLUDED.meta, updated_at=now()`,
			[
				r.id,
				r.schema,
				r.name,
				r.aliases,
				r.countries,
				JSON.stringify({ ref: r.ref, listed: r.listed }),
			],
		);
		n++;
	}
	await pool.query(
		`INSERT INTO sanctions_meta(key, value) VALUES ('unsc_count', $1)
	   ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
		[String(n)],
	);
	console.log(`unsc: ${n} entities`);
	await pool.end();
}

if (process.argv[1]?.endsWith("build-unsanctions.ts")) await main();

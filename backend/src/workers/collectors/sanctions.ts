import { pool } from "../../db/client.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth } from "../lib/store.js";

// OpenSanctions US OFAC SDN mirror, CC-BY 4.0, keyless ~7MB CSV, refreshed daily.
// Columns vary by release — header-mapped, whole row kept in meta.
const URL =
	"https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv";

export function parseCSV(text: string): { head: string[]; rows: string[][] } {
	const rows: string[][] = [];
	let cur: string[] = [],
		field = "",
		inQ = false;
	const push = () => {
		cur.push(field);
		field = "";
	};
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQ) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else inQ = false;
			} else field += c;
		} else if (c === '"') inQ = true;
		else if (c === ",") push();
		else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			push();
			if (cur.length > 1 || cur[0] !== "") rows.push(cur);
			cur = [];
		} else field += c;
	}
	push();
	if (cur.length > 1 || cur[0] !== "") rows.push(cur);
	const head = (rows.shift() ?? []).map((h) =>
		h.trim().toLowerCase().replace(/^"|"$/g, ""),
	);
	return { head, rows };
}

const splitList = (v: string) =>
	v
		.split(/[;|]/)
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 20);

export async function collect() {
	const source = "opensanctions";
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL, {}, 120000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const text = await res.text();
		const { head, rows } = parseCSV(text);
		const ix = (names: string[]) => {
			for (const n of names) {
				const i = head.indexOf(n);
				if (i >= 0) return i;
			}
			return -1;
		};
		const iId = ix(["id"]),
			iSchema = ix(["schema"]),
			iName = ix(["name", "caption"]),
			iAliases = ix(["aliases", "alias"]),
			iCountries = ix(["countries", "country"]),
			iDataset = ix(["dataset", "datasets"]);
		if (iId < 0 || iName < 0)
			throw new Error(`unexpected header: ${head.slice(0, 8).join(",")}`);
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			let n = 0;
			for (const r of rows) {
				const obj: Record<string, string> = {};
				head.forEach((h, i) => {
					if (r[i] !== undefined && r[i] !== "") obj[h] = r[i];
				});
				await client.query(
					`INSERT INTO sanctions_entities(id, schema, name, aliases, countries, dataset, meta, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now())
           ON CONFLICT (id) DO UPDATE SET schema=EXCLUDED.schema, name=EXCLUDED.name,
             aliases=EXCLUDED.aliases, countries=EXCLUDED.countries, dataset=EXCLUDED.dataset,
             meta=EXCLUDED.meta, updated_at=now()`,
					[
						r[iId],
						iSchema >= 0 ? r[iSchema] : null,
						r[iName],
						iAliases >= 0 ? splitList(r[iAliases] ?? "") : [],
						iCountries >= 0 ? splitList(r[iCountries] ?? "") : [],
						iDataset >= 0 ? r[iDataset] : "us_ofac_sdn",
						JSON.stringify(obj),
					],
				);
				if (++n % 2000 === 0) {
					await client.query("COMMIT");
					await client.query("BEGIN");
				}
			}
			await client.query(
				`INSERT INTO sanctions_meta(key, value, updated_at) VALUES ('us_ofac_sdn_count', $1, now())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
				[String(n)],
			);
			await client.query("COMMIT");
			await markHealth(source, true);
			return { ok: true, count: n };
		} catch (e) {
			try {
				await client.query("ROLLBACK");
			} catch {
				/* ignore */
			}
			throw e;
		} finally {
			client.release();
		}
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

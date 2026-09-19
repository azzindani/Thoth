import { readdirSync, readFileSync } from "node:fs";
import { pool } from "../db/client.js";

const files = readdirSync(
	new URL("../../db/migrations", import.meta.url).pathname,
).sort();
for (const f of files) {
	const sql = readFileSync(
		new URL(`../../db/migrations/${f}`, import.meta.url).pathname,
		"utf8",
	);
	console.log(`applying ${f}`);
	await pool.query(sql);
}
await pool.end();
console.log("migrated");

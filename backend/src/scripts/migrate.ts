import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { pool } from "../db/client.js";
import { log } from "../lib/logger.js";

// Tracked, transactional, single-flight migrations.
// - schema_migrations records each applied file + checksum; applied files are
//   skipped, edited-after-apply files are reported (never re-run silently).
// - Each file runs in its own transaction, unless its first line is
//   `-- migrate:no-transaction` (needed for e.g. CREATE INDEX CONCURRENTLY).
// - A session advisory lock serializes concurrent runners (two `migrate`
//   containers, a deploy racing a manual run).
// All pre-tracking files are idempotent, so the first tracked run on an
// existing database re-applies them harmlessly and records them.
const DIR = new URL("../../db/migrations", import.meta.url).pathname;
const LOCK_KEY = 0x7407_4d16; // arbitrary, stable: "Thoth migrate"
const NO_TX = /^--\s*migrate:no-transaction/;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const client = await pool.connect();
let failed = false;
try {
	// Schema changes may legitimately run long on big hypertables.
	await client.query("SET statement_timeout = 0");
	await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
	await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
		name TEXT PRIMARY KEY,
		checksum TEXT NOT NULL,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`);
	const done = new Map(
		(
			await client.query<{ name: string; checksum: string }>(
				"SELECT name, checksum FROM schema_migrations",
			)
		).rows.map((r) => [r.name, r.checksum]),
	);
	const files = readdirSync(DIR)
		.filter((f) => f.endsWith(".sql"))
		.sort();
	let applied = 0;
	for (const f of files) {
		const sql = readFileSync(`${DIR}/${f}`, "utf8");
		const sum = sha(sql);
		const prev = done.get(f);
		if (prev) {
			if (prev !== sum)
				log.warn("migration edited after apply — add a new file instead", {
					migration: f,
				});
			continue;
		}
		log.info("applying migration", { migration: f });
		const tx = !NO_TX.test(sql);
		try {
			if (tx) await client.query("BEGIN");
			await client.query(sql);
			await client.query(
				"INSERT INTO schema_migrations(name, checksum) VALUES ($1,$2)",
				[f, sum],
			);
			if (tx) await client.query("COMMIT");
			applied++;
		} catch (e) {
			if (tx) await client.query("ROLLBACK").catch(() => {});
			throw new Error(`${f}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	log.info("migrated", { applied, total: files.length });
} catch (e) {
	failed = true;
	log.error("migration failed", {
		error: e instanceof Error ? e.message : String(e),
	});
} finally {
	await client
		.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY])
		.catch(() => {});
	client.release();
	await pool.end();
}
if (failed) process.exit(1);

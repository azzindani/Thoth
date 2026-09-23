import { Pool, type PoolClient } from "pg";
import { config } from "../config.js";
import { log } from "../lib/logger.js";

export const pool = new Pool({
	connectionString: config.DATABASE_URL,
	max: config.PG_POOL_MAX,
	application_name: `thoth-${process.argv[1]?.split("/").pop() ?? "node"}`,
	statement_timeout: config.PG_STATEMENT_TIMEOUT_MS || undefined,
	connectionTimeoutMillis: 10000,
	// Idle clients must not keep one-shot processes (scripts, test files,
	// `--once` runs) alive for the idle timeout after their work is done.
	allowExitOnIdle: true,
});

// An idle client losing its connection (DB restart, network blip) emits on
// the pool; unhandled, that event crashes the process.
pool.on("error", (e) => log.error("pg pool error", { error: e.message }));

export async function closePool() {
	await pool.end();
}

export async function query<T = unknown>(
	text: string,
	params?: unknown[],
): Promise<T[]> {
	const res = await pool.query(text, params);
	return res.rows as T[];
}

/** Runs fn inside BEGIN/COMMIT on one client; rolls back on any throw. */
export async function withTransaction<T>(
	fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const out = await fn(client);
		await client.query("COMMIT");
		return out;
	} catch (e) {
		await client.query("ROLLBACK").catch(() => {});
		throw e;
	} finally {
		client.release();
	}
}

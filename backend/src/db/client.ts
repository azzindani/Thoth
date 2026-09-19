import { Pool } from "pg";

const connectionString =
	process.env.DATABASE_URL ?? "postgres://thoth:thoth@localhost:5432/thoth";

export const pool = new Pool({ connectionString, max: 10 });

export async function closePool() {
	await pool.end();
}

export async function query<T = unknown>(
	text: string,
	params?: unknown[],
): Promise<T[]> {
	const client = await pool.connect();
	try {
		const res = await client.query(text, params);
		return res.rows as T[];
	} finally {
		client.release();
	}
}

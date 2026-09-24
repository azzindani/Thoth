// Shared plumbing for collector contract tests: stub fetch by URL pattern,
// canned responses, and read back what a collector stored. Each test file
// still owns its fixtures and its TRUNCATE (files run one at a time).
import { query } from "../../src/db/client.js";

export type Route = [
	RegExp,
	(url: string, init?: RequestInit) => Response | Promise<Response>,
];

const realFetch = globalThis.fetch;

/** Replace fetch: the first matching route answers, anything else 404s.
 * Returns the live list of requested URLs. */
export function stubFetch(routes: Route[]): string[] {
	const calls: string[] = [];
	globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
		const u = String(url);
		calls.push(u);
		for (const [re, respond] of routes) if (re.test(u)) return respond(u, init);
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
	return calls;
}

export function restoreFetch() {
	globalThis.fetch = realFetch;
}

export const json =
	(body: unknown, status = 200) =>
	() =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});

export const text =
	(body: string, status = 200) =>
	() =>
		new Response(body, { status });

export const resetTables = () =>
	query("TRUNCATE events, raw_events, feed_health");

export type StoredEvent = {
	id: string;
	ts: string;
	title: string;
	severity: string;
	layer: string;
	url: string | null;
	lon: number | null;
	lat: number | null;
	meta: Record<string, unknown>;
};

/** Every event a source stored, by id. Area geometries read as centroids. */
export const eventsOf = (source: string) =>
	query<StoredEvent>(
		`SELECT id, ts::text AS ts, title, severity, layer, url,
		        ST_X(ST_Centroid(geom)) AS lon, ST_Y(ST_Centroid(geom)) AS lat, meta
		   FROM events WHERE source=$1 ORDER BY id`,
		[source],
	);

/** A source's feed_health row; `ok` = has succeeded and carries no error. */
export const healthOf = async (source: string) =>
	(
		await query<{ ok: boolean; error: string | null }>(
			"SELECT (last_ok IS NOT NULL AND error IS NULL) AS ok, error FROM feed_health WHERE source=$1",
			[source],
		)
	)[0];

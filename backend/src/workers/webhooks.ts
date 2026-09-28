import { createHash, createHmac, randomUUID } from "node:crypto";
import { VERSION } from "../api/shared.js";
import { config } from "../config.js";
import { query } from "../db/client.js";
import { type Watch, watchCondition } from "../db/queries.js";
import { log } from "../lib/logger.js";

// Outbound webhooks: every configured URL receives a signed JSON POST for
// each new critical alert and each new watch match. A pass runs every
// minute in the worker. "New" = seen by a collector in the last WINDOW
// and not yet delivered to that URL (webhook_deliveries, 011); a failed
// delivery is retried on later passes, up to MAX_ATTEMPTS. The first pass
// ever records what is already live as a baseline instead of sending it,
// so switching webhooks on does not replay the current picture.
//
//   WEBHOOK_URLS    https://a.example/hook,https://b.example/hook
//   WEBHOOK_SECRET  HMAC-SHA256 key: X-Thoth-Signature = sha256=hex(
//                   HMAC(secret, `${X-Thoth-Timestamp}.${body}`))

const WINDOW = "30 minutes";
/** Observed-time cutoff: a re-seen old item is not news. */
const MAX_AGE = "24 hours";
const MAX_ATTEMPTS = 5;
/** Per target per pass, so a backlog cannot flood a receiver. */
const MAX_PER_PASS = 50;
const TIMEOUT_MS = 10_000;

export type Target = { url: string; id: string };
type Item = {
	kind: string;
	type: "alert.critical" | "watch.match";
	event: Record<string, unknown> & { id: string };
	watch?: Watch;
};

/** Valid http(s) URLs from a comma list; the id is a short URL hash. */
export function parseTargets(raw: string): Target[] {
	const out: Target[] = [];
	for (const part of raw.split(",")) {
		const url = part.trim();
		if (!url) continue;
		try {
			const u = new URL(url);
			if (u.protocol !== "https:" && u.protocol !== "http:") throw 0;
			out.push({
				url,
				id: createHash("sha256").update(url).digest("hex").slice(0, 12),
			});
		} catch {
			log.warn("WEBHOOK_URLS entry ignored", { url: url.slice(0, 60) });
		}
	}
	return out;
}

/** The signature a receiver recomputes to verify a delivery. */
export function sign(secret: string, timestamp: string, body: string): string {
	return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

const EVENT_COLS = `id, ts, ingested_at, source, layer, title, body, url, severity,
  confidence, ST_AsGeoJSON(geom)::json AS geom, meta`;
const FRESH = `ingested_at > now() - interval '${WINDOW}'
  AND ts > now() - interval '${MAX_AGE}'
  AND NOT EXISTS (SELECT 1 FROM event_dups d WHERE d.id = events.id)`;

/** New critical alerts and watch matches, oldest first. */
export async function candidates(): Promise<Item[]> {
	const items: Item[] = [];
	const crit = await query<Item["event"]>(
		`SELECT ${EVENT_COLS} FROM events
     WHERE severity = 'critical' AND ${FRESH}
     ORDER BY ts LIMIT 200`,
	);
	for (const e of crit)
		items.push({ kind: "alert", type: "alert.critical", event: e });
	const watches = await query<Watch>(
		"SELECT id, kind, value FROM watchlists ORDER BY created_at",
	);
	for (const w of watches) {
		const params: unknown[] = [];
		const cond = watchCondition(w, params);
		const rows = await query<Item["event"]>(
			`SELECT ${EVENT_COLS} FROM events WHERE ${cond} AND ${FRESH}
       ORDER BY ts LIMIT 100`,
			params,
		);
		for (const e of rows)
			items.push({
				kind: `watch:${w.id}`,
				type: "watch.match",
				event: e,
				watch: w,
			});
	}
	return items;
}

async function record(
	item: Item,
	t: Target,
	status: string,
	httpStatus: number | null,
	error: string | null,
): Promise<void> {
	await query(
		`INSERT INTO webhook_deliveries (event_id, kind, target, status, attempts, http_status, error)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'baseline' THEN 0 ELSE 1 END, $5, $6)
     ON CONFLICT (event_id, kind, target) DO UPDATE SET
       attempts = webhook_deliveries.attempts + 1,
       status = CASE WHEN EXCLUDED.status = 'retry'
                      AND webhook_deliveries.attempts + 1 >= ${MAX_ATTEMPTS}
                     THEN 'failed' ELSE EXCLUDED.status END,
       http_status = EXCLUDED.http_status, error = EXCLUDED.error,
       updated_at = now()`,
		[item.event.id, item.kind, t.id, status, httpStatus, error],
	);
}

export function payload(item: Item, delivery: string): string {
	const { ingested_at: _seen, ...event } = item.event;
	return JSON.stringify({
		type: item.type,
		delivery,
		sent_at: new Date().toISOString(),
		event,
		...(item.watch
			? {
					watch: {
						id: item.watch.id,
						kind: item.watch.kind,
						value: item.watch.value,
					},
				}
			: {}),
	});
}

async function deliver(
	item: Item,
	t: Target,
	secret: string,
	fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
	const delivery = randomUUID();
	const body = payload(item, delivery);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"User-Agent": `Thoth/${VERSION} (+webhooks)`,
		"X-Thoth-Event": item.type,
		"X-Thoth-Delivery": delivery,
		"X-Thoth-Timestamp": timestamp,
	};
	if (secret) headers["X-Thoth-Signature"] = sign(secret, timestamp, body);
	try {
		const r = await fetchImpl(t.url, {
			method: "POST",
			headers,
			body,
			redirect: "manual",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		return r.ok
			? { ok: true, status: r.status, error: null }
			: { ok: false, status: r.status, error: `HTTP ${r.status}` };
	} catch (e: unknown) {
		return { ok: false, status: null, error: String(e).slice(0, 200) };
	}
}

export async function webhookPass(
	opts: { targets?: Target[]; secret?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ sent: number; failed: number; baseline: number }> {
	const targets = opts.targets ?? parseTargets(config.WEBHOOK_URLS);
	const secret = opts.secret ?? config.WEBHOOK_SECRET;
	const fetchImpl = opts.fetchImpl ?? fetch;
	const out = { sent: 0, failed: 0, baseline: 0 };
	if (!targets.length) return out;
	// Keep a week of history; the per-target baseline marker stays.
	await query(
		`DELETE FROM webhook_deliveries
     WHERE updated_at < now() - interval '7 days' AND event_id <> '*'`,
	);
	const items = await candidates();
	for (const t of targets) {
		const seen = new Map(
			(
				await query<{ event_id: string; kind: string; status: string }>(
					`SELECT event_id, kind, status FROM webhook_deliveries WHERE target = $1`,
					[t.id],
				)
			).map((r) => [`${r.kind}|${r.event_id}`, r.status]),
		);
		// A target with no history starts from a baseline: what is live now is
		// recorded, not sent. The marker row makes an empty baseline count.
		const fresh = seen.size === 0;
		if (fresh)
			await query(
				`INSERT INTO webhook_deliveries (event_id, kind, target, status)
         VALUES ('*', 'baseline', $1, 'baseline') ON CONFLICT DO NOTHING`,
				[t.id],
			);
		let n = 0;
		for (const item of items) {
			const prior = seen.get(`${item.kind}|${item.event.id}`);
			if (prior && prior !== "retry") continue;
			if (fresh) {
				await record(item, t, "baseline", null, null);
				out.baseline++;
				continue;
			}
			if (n++ >= MAX_PER_PASS) break;
			const r = await deliver(item, t, secret, fetchImpl);
			await record(item, t, r.ok ? "sent" : "retry", r.status, r.error);
			if (r.ok) out.sent++;
			else out.failed++;
		}
	}
	return out;
}

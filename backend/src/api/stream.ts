import type { Request, Response } from "express";
import { getVersions } from "../db/queries.js";
import { log } from "../lib/logger.js";
import { VERSION } from "./shared.js";

// Server-Sent Events hub for GET /api/stream.
//
// One shared poller reads layer_versions every POLL_MS while at least one
// client is connected (previously every connection ran its own poll, so DB
// load grew linearly with open tabs). Each client keeps its own last-seen
// versions, so per-client diffs stay exact.
//
// Events (unchanged wire contract): connected → snapshot → layer_changed |
// heartbeat. Resume: ?known=<base64 JSON {layer:version}> or Last-Event-ID
// with the same payload; layers that moved since are replayed as one
// layer_changed right after the snapshot.

const POLL_MS = 5000;
const MAX_CLIENTS = Number(process.env.SSE_MAX_CLIENTS ?? 500);

type Version = { layer: string; version: string };
type Client = { res: Response; last: Map<string, string> };

const clients = new Set<Client>();
let timer: NodeJS.Timeout | null = null;

const frame = (event: string, data: unknown) =>
	`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function diff(last: Map<string, string>, v: Version[]): Version[] {
	return v.filter((r) => last.get(r.layer) !== r.version);
}

async function tick() {
	let v: Version[];
	try {
		v = await getVersions();
	} catch (e: unknown) {
		// Transient DB error: keep streams open, say nothing this round.
		log.warn("sse poll failed", { error: String(e) });
		return;
	}
	const ts = new Date().toISOString();
	for (const c of clients) {
		const changed = diff(c.last, v);
		for (const r of v) c.last.set(r.layer, r.version);
		c.res.write(
			changed.length
				? frame("layer_changed", {
						layers: changed.map((r) => r.layer),
						versions: changed,
						ts,
					})
				: frame("heartbeat", { ts }),
		);
	}
}

function ensurePolling() {
	if (!timer && clients.size) timer = setInterval(tick, POLL_MS);
	if (timer && !clients.size) {
		clearInterval(timer);
		timer = null;
	}
}

export function parseKnown(raw: string | undefined): Record<string, string> {
	if (!raw) return {};
	try {
		const txt = raw.startsWith("{")
			? raw
			: Buffer.from(raw, "base64").toString("utf8");
		const parsed = JSON.parse(txt) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		return Object.fromEntries(
			Object.entries(parsed as Record<string, unknown>)
				.filter(([, v]) => typeof v === "string" || typeof v === "number")
				.map(([k, v]) => [k, String(v)]),
		);
	} catch {
		return {}; // unknown resume state → client gets a full snapshot anyway
	}
}

export async function streamHandler(req: Request, res: Response) {
	if (clients.size >= MAX_CLIENTS) {
		res.setHeader("Retry-After", "30");
		res.status(503).json({ ok: false, error: "stream at capacity" });
		return;
	}
	const known = parseKnown(
		(req.query.known as string | undefined) ??
			(req.headers["last-event-id"] as string | undefined),
	);
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		// nginx and friends buffer responses by default, which stalls SSE.
		"X-Accel-Buffering": "no",
	});
	res.write(`retry: ${POLL_MS}\n`);
	res.write(
		frame("connected", { ts: new Date().toISOString(), version: VERSION }),
	);

	const client: Client = { res, last: new Map() };
	try {
		const v = await getVersions();
		res.write(frame("snapshot", { versions: v }));
		const moved = Object.keys(known).length
			? v.filter((r) => known[r.layer] !== r.version)
			: [];
		if (moved.length)
			res.write(
				frame("layer_changed", {
					layers: moved.map((r) => r.layer),
					versions: moved,
					ts: new Date().toISOString(),
				}),
			);
		for (const r of v) client.last.set(r.layer, r.version);
	} catch (e: unknown) {
		log.warn("sse snapshot failed", { error: String(e) });
	}
	if (res.writableEnded || req.destroyed) return;
	clients.add(client);
	ensurePolling();
	req.on("close", () => {
		clients.delete(client);
		ensurePolling();
	});
}

/** Close every open stream (graceful shutdown: server.close waits on them). */
export function closeAllStreams() {
	for (const c of clients) c.res.end();
	clients.clear();
	ensurePolling();
}

export const streamClientCount = () => clients.size;

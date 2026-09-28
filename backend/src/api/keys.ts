import { timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { Request, RequestHandler } from "express";
import { config } from "../config.js";
import { log } from "../lib/logger.js";

// Reader API keys: named keys for scripts and integrations that read the
// API, separate from the write key. A key identifies its caller (access
// log, rate-limit bucket) and may carry its own per-minute limit; without
// one, its callers are limited per client IP like anonymous traffic (the
// right choice for the app's own key, which fronts many users).
//
//   API_READ_KEYS       name:key[:perMin],name2:key2[:perMin]
//   API_READ_KEYS_FILE  JSON {"name": "key"} or {"name": {"key": "...", "perMin": 600}},
//                       re-read when it changes (add or revoke without a restart)
//   API_READ_REQUIRED   1 = GET /api needs a reader key (or the write key);
//                       probes (livez, readyz) stay open
//
// A presented key that matches nothing is refused (401), never ignored.

export type ReaderKey = { name: string; key: string; perMin?: number };
/** Who is calling, set on res.locals.client by identify(). */
export type Client = { name: string; perMin?: number };

const NAME = /^[A-Za-z0-9._-]{1,40}$/;
const MIN_KEY = 16;

function valid(k: ReaderKey): boolean {
	if (!NAME.test(k.name)) return false;
	if (k.key.length < MIN_KEY) return false;
	return (
		k.perMin === undefined || (Number.isInteger(k.perMin) && k.perMin >= 1)
	);
}

/** "name:key[:perMin],…" → keys; malformed or short entries are dropped. */
export function parseReaderKeys(raw: string): ReaderKey[] {
	const out: ReaderKey[] = [];
	for (const part of raw.split(",")) {
		const [name = "", key = "", per] = part.trim().split(":");
		const k: ReaderKey = {
			name,
			key,
			...(per ? { perMin: Number(per) } : {}),
		};
		if (valid(k)) out.push(k);
		else if (part.trim()) log.warn("API_READ_KEYS entry ignored", { name });
	}
	return out;
}

/** {"name": "key"} or {"name": {"key", "perMin"}} → keys. */
export function parseKeyFile(json: unknown): ReaderKey[] {
	if (!json || typeof json !== "object" || Array.isArray(json)) return [];
	const out: ReaderKey[] = [];
	for (const [name, v] of Object.entries(json as Record<string, unknown>)) {
		const o = v as { key?: unknown; perMin?: unknown } | string;
		const k: ReaderKey =
			typeof o === "string"
				? { name, key: o }
				: {
						name,
						key: String(o?.key ?? ""),
						...(o?.perMin !== undefined ? { perMin: Number(o.perMin) } : {}),
					};
		if (valid(k)) out.push(k);
		else log.warn("API_READ_KEYS_FILE entry ignored", { name });
	}
	return out;
}

let fileCache: { path: string; mtime: number; keys: ReaderKey[] } | null = null;

function fileKeys(path: string): ReaderKey[] {
	if (!path) return [];
	try {
		const mtime = statSync(path).mtimeMs;
		if (fileCache?.path !== path || fileCache.mtime !== mtime)
			fileCache = {
				path,
				mtime,
				keys: parseKeyFile(JSON.parse(readFileSync(path, "utf8"))),
			};
		return fileCache.keys;
	} catch (e: unknown) {
		// Unreadable or invalid file: no file keys (fail closed for them).
		log.warn("API_READ_KEYS_FILE unreadable", { error: String(e) });
		return [];
	}
}

export function presentedKey(req: Request): string {
	const auth = req.get("authorization") ?? "";
	if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
	return req.get("x-thoth-key") ?? "";
}

export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const PROBES = new Set(["/livez", "/readyz"]);

/**
 * Resolves the caller from its key, for the limiter and the access log.
 * Mount on /api before rateLimit. The write key identifies as "write";
 * whether a key may write is still decided by requireWriteKey.
 */
export function identify(
	opts: {
		readKeys?: () => ReaderKey[];
		writeKey?: string;
		required?: boolean;
	} = {},
): RequestHandler {
	const readKeys =
		opts.readKeys ??
		(() => [
			...parseReaderKeys(config.API_READ_KEYS),
			...fileKeys(config.API_READ_KEYS_FILE),
		]);
	const writeKey = opts.writeKey ?? config.API_WRITE_KEY;
	const required = opts.required ?? config.API_READ_REQUIRED;
	return (req, res, next) => {
		const presented = presentedKey(req);
		if (presented) {
			if (writeKey && safeEqual(presented, writeKey)) {
				res.locals.client = { name: "write" } satisfies Client;
				return next();
			}
			const hit = readKeys().find((k) => safeEqual(presented, k.key));
			if (hit) {
				res.locals.client = {
					name: hit.name,
					...(hit.perMin ? { perMin: hit.perMin } : {}),
				} satisfies Client;
				return next();
			}
			// A write with a wrong key gets the write gate's answer.
			if (req.method === "GET" || req.method === "HEAD") {
				res.setHeader("WWW-Authenticate", 'Bearer realm="thoth"');
				res.status(401).json({ ok: false, error: "unknown API key" });
				return;
			}
			return next();
		}
		if (
			required &&
			(req.method === "GET" || req.method === "HEAD") &&
			!PROBES.has(req.path)
		) {
			res.setHeader("WWW-Authenticate", 'Bearer realm="thoth"');
			res.status(401).json({ ok: false, error: "API key required" });
			return;
		}
		next();
	};
}

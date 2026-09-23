import { randomUUID, timingSafeEqual } from "node:crypto";
import type {
	ErrorRequestHandler,
	NextFunction,
	Request,
	RequestHandler,
	Response,
} from "express";
import { config, isProduction } from "../config.js";
import { log } from "../lib/logger.js";

// Cross-cutting HTTP concerns, in mount order (see app.ts). Each is small,
// dependency-free and individually testable.

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Full request path; req.path is relative to the mount point inside app.use("/api"). */
const fullPath = (req: Request) => req.originalUrl.split("?")[0] ?? req.path;

/** X-Request-Id in/out + one structured access-log line per request. */
export const requestLog: RequestHandler = (req, res, next) => {
	const inbound = req.get("x-request-id");
	const id = inbound && REQUEST_ID_RE.test(inbound) ? inbound : randomUUID();
	res.locals.requestId = id;
	res.setHeader("X-Request-Id", id);
	const t0 = process.hrtime.bigint();
	res.on("finish", () => {
		// Long-lived SSE and liveness probes would drown the log.
		const path = fullPath(req);
		if (path === "/api/stream" || path === "/api/livez") return;
		const ms = Number(process.hrtime.bigint() - t0) / 1e6;
		const fields = {
			req_id: id,
			method: req.method,
			path,
			status: res.statusCode,
			ms: Math.round(ms * 10) / 10,
			ip: req.ip,
		};
		if (res.statusCode >= 500) log.error("http", fields);
		else if (res.statusCode >= 400) log.warn("http", fields);
		else log.debug("http", fields);
	});
	next();
};

/**
 * Baseline security headers for a JSON API (helmet's API-relevant subset).
 * CSP is locked down on /api only — the legacy terminal in public/ ships
 * inline scripts and is scheduled for deletion.
 */
export const securityHeaders: RequestHandler = (req, res, next) => {
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Referrer-Policy", "no-referrer");
	res.setHeader("X-Frame-Options", "DENY");
	res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
	res.removeHeader("X-Powered-By");
	if (fullPath(req).startsWith("/api/"))
		res.setHeader(
			"Content-Security-Policy",
			"default-src 'none'; frame-ancestors 'none'",
		);
	if (isProduction && req.secure)
		res.setHeader(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains",
		);
	next();
};

/** CORS from CORS_ORIGIN: "*" or a comma-separated allowlist. */
export function cors(origins = config.CORS_ORIGIN): RequestHandler {
	const raw = origins.trim();
	const any = raw === "*";
	const allow = new Set(
		raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
	return (req, res, next) => {
		const origin = req.get("origin");
		if (any) res.setHeader("Access-Control-Allow-Origin", "*");
		else if (origin && allow.has(origin)) {
			res.setHeader("Access-Control-Allow-Origin", origin);
			res.setHeader("Vary", "Origin");
		}
		res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
		res.setHeader(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization, X-Thoth-Key, X-Request-Id, Last-Event-ID",
		);
		res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, Retry-After");
		res.setHeader("Access-Control-Max-Age", "600");
		if (req.method === "OPTIONS") {
			res.status(204).end();
			return;
		}
		next();
	};
}

/**
 * Fixed-window per-IP limiter (no deps). Keys on req.ip, which honours
 * TRUST_PROXY — without that every request behind the Next proxy shares one
 * bucket. Long-lived SSE and probes are exempt.
 */
export function rateLimit(perMin = config.REQUESTS_PER_MIN): RequestHandler {
	const WINDOW_MS = 60_000;
	const hits = new Map<string, { n: number; reset: number }>();
	setInterval(() => {
		const now = Date.now();
		for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
	}, WINDOW_MS).unref();
	return (req, res, next) => {
		if (
			req.path === "/stream" ||
			req.path === "/livez" ||
			req.path === "/readyz"
		)
			return next();
		const key = req.ip ?? "unknown";
		const now = Date.now();
		let slot = hits.get(key);
		if (!slot || now > slot.reset) {
			slot = { n: 0, reset: now + WINDOW_MS };
			hits.set(key, slot);
		}
		slot.n++;
		res.setHeader("RateLimit-Limit", String(perMin));
		res.setHeader("RateLimit-Remaining", String(Math.max(0, perMin - slot.n)));
		if (slot.n > perMin) {
			const retry = Math.ceil((slot.reset - now) / 1000);
			res.setHeader("Retry-After", String(retry));
			res
				.status(429)
				.json({ ok: false, error: `rate limited, retry in ${retry}s` });
			return;
		}
		next();
	};
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function presentedKey(req: Request): string {
	const auth = req.get("authorization") ?? "";
	if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
	return req.get("x-thoth-key") ?? "";
}

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Write gate for mutating /api routes. Key set → required (Bearer or
 * X-Thoth-Key). Key unset → open in dev, refused in production (fail closed:
 * a public tunnel must not accept anonymous deletes or Telegram pushes).
 */
export function requireWriteKey(key = config.API_WRITE_KEY): RequestHandler {
	return (req, res, next) => {
		if (!MUTATING.has(req.method)) return next();
		if (!key) {
			if (!isProduction) return next();
			res.status(403).json({
				ok: false,
				error: "writes disabled: API_WRITE_KEY is not configured",
			});
			return;
		}
		if (!safeEqual(presentedKey(req), key)) {
			res.setHeader("WWW-Authenticate", 'Bearer realm="thoth"');
			res.status(401).json({ ok: false, error: "write key required" });
			return;
		}
		next();
	};
}

/** JSON 404 for unknown /api paths (instead of Express's HTML page). */
export const notFound: RequestHandler = (req, res) => {
	res
		.status(404)
		.json({ ok: false, error: `no route: ${req.method} ${fullPath(req)}` });
};

/**
 * Last-resort handler: Express 5 forwards rejected async handlers here.
 * Logs the detail server-side, answers a generic JSON error with the
 * request id so an operator can correlate — never a stack trace.
 */
export const errorHandler: ErrorRequestHandler = (
	err: unknown,
	req: Request,
	res: Response,
	_next: NextFunction,
) => {
	const e = err as { status?: number; statusCode?: number; type?: string };
	const raw = e.status ?? e.statusCode;
	const status =
		Number.isInteger(raw) && (raw as number) >= 400 && (raw as number) < 600
			? (raw as number)
			: 500;
	const id = res.locals.requestId as string | undefined;
	if (status >= 500)
		log.error("unhandled route error", {
			req_id: id,
			method: req.method,
			path: fullPath(req),
			error: err instanceof Error ? err.message : String(err),
		});
	if (res.headersSent) {
		res.end();
		return;
	}
	// body-parser errors carry a 4xx status + a type; surface those honestly.
	const message =
		status < 500
			? e.type === "entity.too.large"
				? "request body too large"
				: e.type === "entity.parse.failed"
					? "malformed JSON body"
					: "bad request"
			: "internal error";
	res.status(status).json({ ok: false, error: message, request_id: id });
};

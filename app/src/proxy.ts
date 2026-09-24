import { type NextRequest, NextResponse } from "next/server";
import {
	authConfigured,
	isMutating,
	isPublicPath,
	isValidToken,
	mintSessionToken,
	presentedTokens,
	SESSION_COOKIE,
	sessionCookie,
} from "./lib/auth";

// Edge of the app (Next 16 "proxy", formerly middleware). Two jobs:
//
// 1. Access gate — Folio's token model (see lib/auth.ts). With APP_ACCESS_KEY
//    (or APP_TOKENS / APP_TOKENS_FILE) set, every page and /api call needs a
//    valid Bearer key, ?token=, or thoth_session cookie. A page opened with
//    ?token= gets a 30-day session cookie and a redirect to the same URL
//    without the token; the cookie then rides every fetch and EventSource.
//    Unauthenticated callers get a plain 401 — no WWW-Authenticate, so no
//    browser username/password popup. Unset = open (local dev, CI).
//
// 2. Backend write key: API_WRITE_KEY is attached server-side to mutating
//    /api requests before the rewrite to the backend, so the secret never
//    ships to the browser. It is attached only for authenticated callers —
//    passed the gate above, or APP_TRUST_UPSTREAM_AUTH=1 when an auth proxy
//    in front has already vetted them. Anyone else's writes reach the backend
//    without the key and are refused there (fail closed).

const UNAUTHORIZED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thoth — access token required</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0a;color:#e6e4dc;font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}.card{max-width:440px;margin:16px;padding:28px 32px;border:1px solid rgba(79,191,174,.45);border-radius:10px}h1{margin:0 0 12px;font-size:16px;letter-spacing:.08em;color:#4fbfae}p{margin:0 0 10px;color:#a8a69e}code{color:#f0a020}</style></head>
<body><div class="card"><h1>THOTH</h1><p>This terminal is protected by an access token. Open it once with the token appended to the URL:</p><p><code>?token=YOUR_TOKEN</code></p><p>The session is then remembered for 30 days — no username or password.</p></div></body></html>`;

function unauthorized(isApi: boolean): NextResponse {
	const headers = { "Cache-Control": "no-store" };
	return isApi
		? NextResponse.json(
				{ ok: false, error: "access token required" },
				{ status: 401, headers },
			)
		: new NextResponse(UNAUTHORIZED_HTML, {
				status: 401,
				headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
			});
}

export function proxy(req: NextRequest) {
	const { pathname, searchParams } = req.nextUrl;
	if (isPublicPath(pathname)) return NextResponse.next();

	const isApi = pathname.startsWith("/api/");
	const gated = authConfigured();
	const query = searchParams.get("token");
	const cookie = req.cookies.get(SESSION_COOKIE)?.value;
	const authed =
		gated &&
		presentedTokens(req.headers.get("authorization"), query, cookie).some((t) =>
			isValidToken(t),
		);
	if (gated && !authed) return unauthorized(isApi);

	if (isApi) {
		const headers = new Headers(req.headers);
		// Never forward a caller-supplied key, nor the app credential: the
		// backend reads a Bearer header as its write key.
		headers.delete("x-thoth-key");
		headers.delete("authorization");
		const key = process.env.API_WRITE_KEY;
		const vetted = authed || process.env.APP_TRUST_UPSTREAM_AUTH === "1";
		if (key && vetted && isMutating(req.method))
			headers.set("x-thoth-key", key);
		return NextResponse.next({ request: { headers } });
	}

	if (!gated || req.method !== "GET") return NextResponse.next();
	const secure =
		req.headers.get("x-forwarded-proto") === "https" ||
		req.nextUrl.protocol === "https:";
	const fresh = () => sessionCookie(mintSessionToken(), secure);

	// Swap ?token= for the cookie and drop it from the address bar. Can't
	// loop: the redirect target carries no token.
	if (query !== null) {
		const url = req.nextUrl.clone();
		url.searchParams.delete("token");
		const res = NextResponse.redirect(url, 302);
		res.headers.set("Set-Cookie", fresh());
		res.headers.set("Cache-Control", "no-store");
		return res;
	}

	// Sliding session: a page load on a live cookie renews its window, so
	// daily use never lapses. Bearer-only callers (scripts) get no cookie.
	const res = NextResponse.next();
	if (cookie && isValidToken(cookie)) res.headers.set("Set-Cookie", fresh());
	return res;
}

export const config = {
	// Everything except Next's immutable build assets.
	matcher: ["/((?!_next/static|_next/image).*)"],
};

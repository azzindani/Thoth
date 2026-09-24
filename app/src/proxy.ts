import { type NextRequest, NextResponse } from "next/server";
import { basicAuthOk, isMutating, isPublicPath } from "./lib/auth";

// Edge of the app (Next 16 "proxy", formerly middleware). Two jobs:
//
// 1. Optional operator gate: APP_BASIC_AUTH="user:pass" puts HTTP Basic auth
//    in front of every page and /api call (browsers resend it for fetch and
//    EventSource). Unset = open, e.g. behind Cloudflare Access or on a LAN.
//
// 2. Backend write key: API_WRITE_KEY is attached server-side to mutating
//    /api requests before the rewrite to the backend, so the secret never
//    ships to the browser. It is attached only for authenticated callers —
//    passed Basic auth, or APP_TRUST_UPSTREAM_AUTH=1 when an auth proxy in
//    front has already vetted them. Anyone else's writes reach the backend
//    without the key and are refused there (fail closed).

const REALM = 'Basic realm="thoth", charset="UTF-8"';

export function proxy(req: NextRequest) {
	const { pathname } = req.nextUrl;
	if (isPublicPath(pathname)) return NextResponse.next();

	const basic = process.env.APP_BASIC_AUTH;
	if (!basicAuthOk(req.headers.get("authorization"), basic)) {
		return new NextResponse("authentication required", {
			status: 401,
			headers: { "WWW-Authenticate": REALM },
		});
	}

	if (pathname.startsWith("/api/") && isMutating(req.method)) {
		const headers = new Headers(req.headers);
		// Never forward a caller-supplied key; only the server's own.
		headers.delete("x-thoth-key");
		const key = process.env.API_WRITE_KEY;
		const vetted = !!basic || process.env.APP_TRUST_UPSTREAM_AUTH === "1";
		if (key && vetted) headers.set("x-thoth-key", key);
		return NextResponse.next({ request: { headers } });
	}
	return NextResponse.next();
}

export const config = {
	// Everything except Next's immutable build assets.
	matcher: ["/((?!_next/static|_next/image).*)"],
};

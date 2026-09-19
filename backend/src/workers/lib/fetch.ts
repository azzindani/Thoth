const UA = "Thoth/0.1 (+https://github.com/thoth)";

export async function stealthFetch(
	url: string,
	init: RequestInit = {},
	timeoutMs = 15000,
): Promise<Response> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		return await fetch(url, {
			...init,
			signal: ctrl.signal,
			headers: { "User-Agent": UA, ...(init.headers ?? {}) },
		});
	} finally {
		clearTimeout(t);
	}
}

// SSRF guard: allow public http(s) only, block localhost / metadata IP
export function assertSafeUrl(url: string) {
	const u = new URL(url);
	if (!["http:", "https:"].includes(u.protocol))
		throw new Error("blocked protocol");
	const host = u.hostname.toLowerCase();
	if (
		host === "localhost" ||
		host === "127.0.0.1" ||
		host === "::1" ||
		host === "169.254.169.254"
	) {
		throw new Error("blocked host");
	}
}

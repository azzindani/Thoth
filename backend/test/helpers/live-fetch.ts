// fetch for live route tests: attaches API_WRITE_KEY to mutating requests
// when the API under test enforces one (it is optional in dev/CI).
const WRITE_KEY = process.env.API_WRITE_KEY ?? "";

export const liveFetch: typeof fetch = (input, init = {}) => {
	const method = (init.method ?? "GET").toUpperCase();
	if (!WRITE_KEY || method === "GET" || method === "HEAD")
		return fetch(input, init);
	const headers = new Headers(init.headers);
	headers.set("X-Thoth-Key", WRITE_KEY);
	return fetch(input, { ...init, headers });
};

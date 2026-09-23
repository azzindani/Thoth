// Empty string = same-origin (/api/* served by the Next rewrite proxy).
export const API = process.env.NEXT_PUBLIC_THOTH_API ?? "";

async function get<T>(path: string): Promise<T> {
	const r = await fetch(`${API}${path}`, { cache: "no-store" });
	if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
	return (await r.json()) as T;
}

/** Map camera for viewport-aware layer slices: zoom, and a bbox
 * [w, s, e, n] (w > e crosses the antimeridian) once zoomed in. */
export type CameraView = { z: number; bbox?: [number, number, number, number] };

export interface LayerItem {
	id: string;
	ts: string;
	source: string;
	layer: string;
	title?: string;
	body?: string;
	url?: string;
	severity?: string;
	meta?: Record<string, unknown>;
	geom?: { type: string; coordinates?: number[] } | null;
}

// ── monitor (ROADMAP P1) ──────────────────────────────────────────────────
export type SourceState = "ok" | "failing" | "frozen" | "stale" | "warming";
export interface MonSummary {
	worker: {
		alive: boolean;
		beat_at: string | null;
		started_at: string | null;
		collectors: number | null;
	};
	sources: Record<"total" | SourceState, number>;
	collectors: number;
	alerts: Record<string, number>;
	db: { size_bytes: number; events_est: number; raw_events_est: number };
	retention: { monitor_days: number; raw_days: number; events_days: number };
	alert_fail_streak: number;
}
export interface MonSource {
	source: string;
	collector: string | null;
	interval_sec: number | null;
	state: SourceState;
	last_ok: string | null;
	last_attempt: string | null;
	content_ts: string | null;
	first_ok_at: string | null;
	error: string | null;
	runs24: number;
	ok24: number;
	runs7: number;
	ok7: number;
	fail_streak: number;
	strip: string;
	next_due: string | null;
	running: boolean;
}
export interface MonCollector {
	collector: string;
	interval_sec: number;
	sources: string[];
	next_due: string | null;
	running: boolean;
	runs24: number;
	ok24: number;
	p50_ms: number | null;
	p95_ms: number | null;
	last_run_at: string | null;
	last_ok: boolean | null;
	last_ms: number | null;
	last_count: number | null;
	last_error: string | null;
	queued: boolean;
}
export interface MonEndpoint {
	host: string;
	calls: number;
	errors: number;
	p50_ms: number | null;
	p95_ms: number | null;
	last_ts: string;
	last_status: number | null;
	last_error: string | null;
	collectors: string[] | null;
}
export interface MonSourceDetail {
	source: string;
	row: MonSource | null;
	collector: { collector: string; intervalSec: number } | null;
	runs: { ts: string; ok: boolean; error: string | null }[];
	errors: { error: string; n: number; last: string }[];
	events: { id: string; ts: string; layer: string; title: string | null }[];
	hosts: {
		host: string;
		path: string;
		calls: number;
		errors: number;
		p95_ms: number | null;
		last_status: number | null;
	}[];
}

export const monitor = {
	summary: () => get<MonSummary>("/api/monitor/summary"),
	sources: () => get<{ items: MonSource[] }>("/api/monitor/sources"),
	source: (s: string) =>
		get<MonSourceDetail>(`/api/monitor/sources/${encodeURIComponent(s)}`),
	collectors: () => get<{ items: MonCollector[] }>("/api/monitor/collectors"),
	endpoints: () => get<{ items: MonEndpoint[] }>("/api/monitor/endpoints"),
	/** Queue a run (write key is injected server-side by the app proxy). */
	runNow: async (collector: string) => {
		const r = await fetch(
			`${API}/api/monitor/run/${encodeURIComponent(collector)}`,
			{ method: "POST" },
		);
		if (!r.ok && r.status !== 202) throw new Error(`HTTP ${r.status}`);
		return (await r.json()) as { queued: boolean; pending: boolean };
	},
};

export const api = {
	stats: () => get<{ items: { layer: string; count: string }[] }>("/api/stats"),
	health: () =>
		get<{
			feeds: {
				source: string;
				last_ok: string | null;
				last_attempt: string | null;
				error: string | null;
				content_ts: string | null;
				first_ok_at: string | null;
				frozen?: boolean;
				warming?: boolean;
				collector: string | null;
				intervalSec: number | null;
			}[];
		}>("/api/health"),
	versions: () =>
		get<{ versions: { layer: string; version: string }[] }>("/api/versions"),
	/** Without `view`: the newest 500 rows. With a camera view: a slice
	 * sampled across the view (see getLayerView on the API). */
	layer: (name: string, since?: string, view?: CameraView) => {
		const q = new URLSearchParams();
		if (since) q.set("since", since);
		if (view) {
			q.set("z", String(view.z));
			if (view.bbox) q.set("bbox", view.bbox.join(","));
		}
		const qs = q.toString();
		return get<{
			items: LayerItem[];
			total: number;
			matched?: number;
			truncated?: boolean;
		}>(`/api/layers/${name}${qs ? `?${qs}` : ""}`);
	},
	layerHistory: (name: string) =>
		get<{ buckets: { bucket: string; count: string; n?: number }[] }>(
			`/api/layers/${name}/history?bucket=day`,
		),
	dossier: (lat: string, lng: string, radius = 300) =>
		get<{
			counts: { layer: string; count: string }[];
			items: LayerItem[];
			threat?: { score: number; level: string };
		}>(`/api/dossier?lat=${lat}&lng=${lng}&radius_km=${radius}`),
	alerts: (limit = 50, hours = 24) =>
		get<{ items: LayerItem[] }>(`/api/alerts?limit=${limit}&hours=${hours}`),
	brief: () =>
		get<{
			generated_at: string;
			critical: LayerItem[];
			watch: LayerItem[];
			gaps: { source: string; error: string | null }[];
			counts: { layer: string; count: string }[];
		}>("/api/brief"),
	theaters: () =>
		get<{
			theaters: Record<
				string,
				{
					label: string;
					center: [number, number];
					zoom: number;
					cities: number;
				}
			>;
		}>("/api/theaters"),
	sdn: (q: string) =>
		get<{ items: Record<string, unknown>[] }>(
			`/api/osint/sanctions?query=${encodeURIComponent(q)}&limit=20`,
		),
	osint: (kind: string, arg: string) =>
		get<Record<string, unknown>>(
			`/api/osint/${kind}?${new URLSearchParams(
				kind === "aircraft"
					? { reg: arg }
					: kind === "airport"
						? { code: arg }
						: kind === "geo" || kind === "geocode"
							? (() => {
									const [la, ln] = arg.split(",");
									return { lat: (la ?? "").trim(), lng: (ln ?? "").trim() };
								})()
							: kind === "mitre" ||
									kind === "vessel" ||
									kind === "company" ||
									kind === "ror"
								? { query: arg, q: arg }
								: kind === "macro" || kind === "macro-imf"
									? { country: arg }
									: kind === "btc"
										? { address: arg }
										: kind === "cert"
											? { domain: arg }
											: kind === "asn"
												? { q: arg }
												: kind === "cve"
													? /^cve-/i.test(arg)
														? { id: arg }
														: { q: arg }
													: kind === "epss" ||
															kind === "osv" ||
															kind === "circl" ||
															kind === "mitre-cve" ||
															kind === "ghsa"
														? { id: arg, q: arg }
														: kind === "doh" ||
																kind === "doh-google" ||
																kind === "doh-cf"
															? (() => {
																	const [nm, ty] = arg.split(/\s+/);
																	return {
																		name: nm ?? "",
																		...(ty ? { type: ty } : {}),
																	};
																})()
															: kind === "token"
																? { addr: arg, address: arg }
																: kind === "deps"
																	? (() => {
																			const [eco, nver] = arg.split(/\s+/);
																			const [nm, ...vp] = (nver ?? "").split(
																				"@",
																			);
																			return nver
																				? {
																						eco,
																						name: nver.includes("@")
																							? nm
																							: nver,
																						version: vp.join("@") || nm,
																					}
																				: {
																						eco: "npm",
																						name: eco,
																						version: "",
																					};
																		})()
																	: kind === "planespotter"
																		? { hex: arg, reg: arg, q: arg }
																		: kind === "fdic" ||
																				kind === "wikidata" ||
																				kind === "wiki" ||
																				kind === "books" ||
																				kind === "stack" ||
																				kind === "nominatim" ||
																				kind === "omgeo" ||
																				kind === "maltiverse" ||
																				kind === "urlscan" ||
																				kind === "crfunder" ||
																				kind === "food" ||
																				kind === "music" ||
																				kind === "maltsearch" ||
																				kind === "fda-drug" ||
																				kind === "gene" ||
																				kind === "ontology" ||
																				kind === "protein" ||
																				kind === "transit" ||
																				kind === "name" ||
																				kind === "funder" ||
																				kind === "museum" ||
																				kind === "rxnorm" ||
																				kind === "chembl" ||
																				kind === "sbdb" ||
																				kind === "nasa-img" ||
																				kind === "dailymed" ||
																				kind === "holidays" ||
																				kind === "npm-dl"
																			? { query: arg, q: arg }
																			: kind === "package"
																				? (() => {
																						const [eco, ...rest] =
																							arg.split(/\s+/);
																						return rest.length
																							? { eco, name: rest.join(" ") }
																							: { eco: "npm", name: eco };
																					})()
																				: kind === "daylight"
																					? (() => {
																							const [la, ln] = arg.split(",");
																							return {
																								lat: (la ?? "").trim(),
																								lng: (ln ?? "").trim(),
																							};
																						})()
																					: kind === "zip"
																						? (() => {
																								const [cc, ...rest] =
																									arg.split(/\s+/);
																								return rest.length
																									? { cc, code: rest.join("") }
																									: { cc: "us", code: cc };
																							})()
																						: { host: arg },
			).toString()}`,
		),
	search: (q: string, layer?: string) =>
		get<{ ok: boolean; count: number; items: LayerItem[] }>(
			`/api/search?${new URLSearchParams({
				q,
				...(layer ? { layer } : {}),
			}).toString()}`,
		),
	watchList: () =>
		get<{
			ok: boolean;
			items: {
				id: string;
				kind: string;
				value: string;
				note: string;
				geom?: { type: string; coordinates: unknown } | null;
			}[];
		}>("/api/watch"),
	/** Area watch (P5): a circle; anything live that lands inside matches. */
	watchArea: (label: string, lat: number, lon: number, radius_km: number) =>
		fetch(`${API}/api/watch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "area", value: label, lat, lon, radius_km }),
		}).then((r) => r.json()) as Promise<{
			ok: boolean;
			id?: string;
			error?: string;
		}>,
	watchAdd: (kind: string, value: string) =>
		fetch(`${API}/api/watch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind, value }),
		}).then((r) => r.json()) as Promise<{
			ok: boolean;
			id?: string;
			error?: string;
		}>,
	watchDel: (id: string) =>
		fetch(`${API}/api/watch/${encodeURIComponent(id)}`, {
			method: "DELETE",
		}).then((r) => r.json()) as Promise<{ ok: boolean }>,
	watchMatches: () =>
		get<{ ok: boolean; count: number; items: LayerItem[] }>(
			"/api/watch/matches?limit=50",
		),
	portfolios: () =>
		get<{
			ok: boolean;
			items: {
				id: string;
				name: string;
				note: string;
				positions: {
					id: string;
					symbol: string;
					qty: string;
					avg_price: string | null;
					note: string;
				}[];
			}[];
		}>("/api/portfolios"),
	portfolioAdd: (name: string, note = "") =>
		fetch(`${API}/api/portfolios`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, note }),
		}).then((r) => r.json()) as Promise<{
			ok: boolean;
			id?: string;
			error?: string;
		}>,
	portfolioDel: (id: string) =>
		fetch(`${API}/api/portfolios/${encodeURIComponent(id)}`, {
			method: "DELETE",
		}).then((r) => r.json()) as Promise<{ ok: boolean }>,
	positionAdd: (pid: string, symbol: string, qty: number, avg_price?: number) =>
		fetch(`${API}/api/portfolios/${encodeURIComponent(pid)}/positions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ symbol, qty, avg_price }),
		}).then((r) => r.json()) as Promise<{
			ok: boolean;
			id?: string;
			error?: string;
		}>,
	positionDel: (pid: string, sym: string) =>
		fetch(
			`${API}/api/portfolios/${encodeURIComponent(pid)}/positions/${encodeURIComponent(sym)}`,
			{ method: "DELETE" },
		).then((r) => r.json()) as Promise<{ ok: boolean }>,
	notes: (q?: string) =>
		get<{
			ok: boolean;
			count: number;
			items: {
				id: string;
				title: string;
				body: string;
				category: string;
				tickers: string;
				sentiment: string;
				favorite: boolean;
			}[];
		}>(`/api/notes${q ? `?q=${encodeURIComponent(q)}` : ""}`),
	noteAdd: (note: {
		title: string;
		body?: string;
		category?: string;
		tickers?: string;
		sentiment?: string;
	}) =>
		fetch(`${API}/api/notes`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(note),
		}).then((r) => r.json()) as Promise<{
			ok: boolean;
			id?: string;
			error?: string;
		}>,
	noteDel: (id: string) =>
		fetch(`${API}/api/notes/${encodeURIComponent(id)}`, {
			method: "DELETE",
		}).then((r) => r.json()) as Promise<{ ok: boolean }>,
	screens: () =>
		get<{
			ok: boolean;
			items: { id: string; name: string; spec: unknown }[];
		}>("/api/screens"),
	screenAdd: (name: string, spec: Record<string, unknown>) =>
		fetch(`${API}/api/screens`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, spec }),
		}).then((r) => r.json()) as Promise<{
			ok: boolean;
			id?: string;
			error?: string;
		}>,
	screenDel: (id: string) =>
		fetch(`${API}/api/screens/${encodeURIComponent(id)}`, {
			method: "DELETE",
		}).then((r) => r.json()) as Promise<{ ok: boolean }>,
	sitrep: (save: boolean) =>
		save
			? fetch(`${API}/api/sitrep`, { method: "POST" }).then((r) => r.json())
			: get<{ ok: boolean; day: string | null; md: string }>("/api/sitrep"),
	notify: (text: string) =>
		fetch(`${API}/api/notify`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text }),
		}).then((r) => r.json()) as Promise<{
			ok: boolean;
			error?: string;
		}>,
	exportUrl: (layer: string, format: string) =>
		`${API}/api/layers/${encodeURIComponent(layer)}/export?format=${encodeURIComponent(format)}`,
	imagery: (lon: number, lat: number) =>
		get<{
			ok: boolean;
			scene: {
				id: string;
				datetime: string;
				cloud_cover: number | null;
				thumbnail: string;
				tci: string;
			} | null;
		}>(`/api/imagery?lon=${lon}&lat=${lat}`),
	trend: (layer: string, days: number) =>
		get<{
			ok: boolean;
			depth_days: string | null;
			series: { day: string; layer: string; n: string }[];
			sitreps: { day: string; critical_count: number; watch_count: number }[];
		}>(`/api/analytics/trend?layer=${encodeURIComponent(layer)}&days=${days}`),
};

export function esc(s: unknown): string {
	return String(s ?? "");
}

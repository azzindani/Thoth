import type express from "express";
import { z } from "zod";
import { searchSanctions } from "../db/queries.js";
import { log } from "../lib/logger.js";
import { fetchCircl, fetchEpss, fetchOsv } from "../workers/lib/vuln-enrich.js";

/** Keyless OSINT lookups. Registered on the shared app (see server.ts). */
export function registerOsint(app: express.Express): void {
	const SanctionsParams = z.object({
		query: z.string().trim().min(1).max(200),
		limit: z.coerce.number().int().min(1).max(100).default(20),
	});
	app.get("/api/osint/sanctions", async (req, res) => {
		const p = SanctionsParams.safeParse({
			query: req.query.query,
			limit: req.query.limit,
		});
		if (!p.success) {
			res
				.status(400)
				.json({ ok: false, error: "query required (max 200 chars)" });
			return;
		}
		try {
			res.json({
				query: p.data.query,
				items: await searchSanctions(p.data.query, p.data.limit),
			});
		} catch (e: unknown) {
			log.error("sanctions failed", { error: String(e) });
			res.status(500).json({ ok: false, error: "sanctions query failed" });
		}
	});

	// OSINT enrich (best-effort, keyless): Nominatim reverse label + ip-api lookup.
	// Failures return ok:false with reason — never fabricated data.
	const GeoParams = z.object({
		lat: z.coerce.number().min(-90).max(90),
		lng: z.coerce.number().min(-180).max(180),
	});
	app.get("/api/osint/geo", async (req, res) => {
		const p = GeoParams.safeParse({ lat: req.query.lat, lng: req.query.lng });
		if (!p.success) {
			res.status(400).json({ ok: false, error: "lat/lng required" });
			return;
		}
		try {
			const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.data.lat}&lon=${p.data.lng}&zoom=5`;
			const r = await fetch(url, {
				headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
				signal: AbortSignal.timeout(8000),
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				display_name?: string;
				address?: unknown;
			};
			res.json({
				ok: true,
				label: j.display_name ?? null,
				address: j.address ?? null,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `geocode unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	const IpParams = z.object({
		host: z
			.string()
			.trim()
			.min(1)
			.max(253)
			.regex(/^[a-zA-Z0-9.:-]+$/),
	});
	app.get("/api/osint/ip", async (req, res) => {
		const p = IpParams.safeParse({ host: req.query.host });
		if (!p.success) {
			res
				.status(400)
				.json({ ok: false, error: "host required (hostname, IPv4/IPv6)" });
			return;
		}
		try {
			const r = await fetch(
				`http://ip-api.com/json/${encodeURIComponent(p.data.host)}?fields=status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,query`,
				{ signal: AbortSignal.timeout(8000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as Record<string, unknown>;
			if (j.status !== "success")
				throw new Error(String(j.message ?? "lookup failed"));
			res.json({ ok: true, ...j });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `ip lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// MITRE ATT&CK technique lookup from vendored static map (CC BY-SA, see static/).
	let mitreCache:
		| { id: string; name: string; tactics: string[]; descr: string }[]
		| null = null;
	app.get("/api/osint/mitre", async (req, res) => {
		const q = String(req.query.query ?? "")
			.trim()
			.toLowerCase()
			.slice(0, 100);
		try {
			if (!mitreCache) {
				const fs = await import("node:fs");
				const raw = JSON.parse(
					fs.readFileSync(
						new URL("../../static/mitre-techniques.json", import.meta.url)
							.pathname,
						"utf8",
					),
				) as { items?: typeof mitreCache };
				mitreCache = raw.items ?? [];
			}
			const items = (
				q
					? mitreCache.filter(
							(t) =>
								t.id.toLowerCase().includes(q) ||
								t.name.toLowerCase().includes(q),
						)
					: mitreCache
			).slice(0, 20);
			res.json({ ok: true, query: q || null, total: mitreCache.length, items });
		} catch {
			res.status(503).json({
				ok: false,
				error: "mitre map not built (run build-mitre-map)",
			});
		}
	});

	// Static registry lookups (vendored PORT-*.md intel, in-memory lazy maps).
	const staticCache = new Map<string, unknown>();
	async function loadStatic<T>(file: string): Promise<T | null> {
		if (!staticCache.has(file)) {
			try {
				const fs = await import("node:fs");
				staticCache.set(
					file,
					JSON.parse(
						fs.readFileSync(
							new URL(`../../static/${file}`, import.meta.url).pathname,
							"utf8",
						),
					) as T,
				);
			} catch {
				return null;
			}
		}
		return (staticCache.get(file) ?? null) as T | null;
	}
	// Watchlist: aircraft registration → operator/category (16k shadowbroker alert DB).
	app.get("/api/osint/aircraft", async (req, res) => {
		const reg = String(req.query.reg ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 20);
		if (!reg) {
			res
				.status(400)
				.json({ ok: false, error: "reg required (e.g. ?reg=FAC1282)" });
			return;
		}
		const db = await loadStatic<{
			items: Record<
				string,
				{ registration?: string } & Record<string, unknown>
			>;
		}>("plane_alert_db.json");
		if (!db) {
			res.status(503).json({ ok: false, error: "watchlist not vendored" });
			return;
		}
		const hit = Object.entries(db.items).find(
			([k, v]) =>
				k.toUpperCase() === reg || (v.registration ?? "").toUpperCase() === reg,
		);
		res.json({ ok: true, reg, hit: hit ? { key: hit[0], ...hit[1] } : null });
	});
	// Airport by IATA/ICAO code (375 osiris registry).
	app.get("/api/osint/airport", async (req, res) => {
		const code = String(req.query.code ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 8);
		if (!code) {
			res
				.status(400)
				.json({ ok: false, error: "code required (e.g. ?code=SIN)" });
			return;
		}
		const db = await loadStatic<{ items: { iata?: string; icao?: string }[] }>(
			"airports.json",
		);
		if (!db) {
			res.status(503).json({ ok: false, error: "registry not vendored" });
			return;
		}
		const hit = db.items.find((a) => a.iata === code || a.icao === code);
		res.json({ ok: true, code, hit: hit ?? null });
	});
	// Listed symbol master (nasdaqtrader SymDir static, batch62/fincept-2:
	// 12.5k symbols — security-master lookup for the terminal pillar).
	app.get("/api/osint/symbol", async (req, res) => {
		const q = String(req.query.q ?? req.query.sym ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 12);
		if (!q) {
			res.status(400).json({ ok: false, error: "q required (ticker)" });
			return;
		}
		const db = await loadStatic<{
			items: { sym?: string; name?: string; exch?: string; etf?: boolean }[];
		}>("symdir.json");
		if (!db) {
			res.status(503).json({ ok: false, error: "registry not vendored" });
			return;
		}
		const hits = db.items
			.filter((a) => (a.sym ?? "").startsWith(q))
			.slice(0, 10);
		res.json({ ok: true, q, hits });
	});
	// Naval watch: PLAN/CCG hulls (MMSI) + notable yachts by name/MMSI.
	app.get("/api/osint/vessel", async (req, res) => {
		const q = String(req.query.q ?? "")
			.trim()
			.toLowerCase()
			.slice(0, 60);
		if (!q) {
			res.status(400).json({ ok: false, error: "q required (MMSI or name)" });
			return;
		}
		const db = await loadStatic<{
			vessels: Record<string, Record<string, unknown>>;
			yachts: Record<string, Record<string, unknown>>;
		}>("naval_watch.json");
		if (!db) {
			res.status(503).json({ ok: false, error: "watchlist not vendored" });
			return;
		}
		const hits: unknown[] = [];
		for (const [mmsi, v] of Object.entries(db.vessels))
			if (
				mmsi.includes(q) ||
				String(v.name ?? "")
					.toLowerCase()
					.includes(q)
			)
				hits.push({ mmsi, ...v });
		for (const [mmsi, y] of Object.entries(db.yachts))
			if (
				mmsi.includes(q) ||
				String(y.name ?? "")
					.toLowerCase()
					.includes(q)
			)
				hits.push({ mmsi, kind: "yacht", ...y });
		res.json({ ok: true, q, hits: hits.slice(0, 20) });
	});

	// unreachable from some networks — mempool verified 2026-09-09).
	app.get("/api/osint/btc", async (req, res) => {
		const addr = String(req.query.address ?? "")
			.trim()
			.slice(0, 80);
		if (!/^[a-zA-Z0-9]{25,80}$/.test(addr)) {
			res
				.status(400)
				.json({ ok: false, error: "address required (base58/bech32)" });
			return;
		}
		try {
			const r = await fetch(
				`https://mempool.space/api/address/${encodeURIComponent(addr)}`,
				{
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				chain_stats?: {
					funded_txo_sum?: number;
					spent_txo_sum?: number;
					tx_count?: number;
				};
			};
			const funded = Number(j.chain_stats?.funded_txo_sum ?? 0);
			const spent = Number(j.chain_stats?.spent_txo_sum ?? 0);
			res.json({
				ok: true,
				address: addr,
				balance_btc: (funded - spent) / 1e8,
				tx_count: j.chain_stats?.tx_count ?? 0,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `btc lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Certificate-transparency subdomain enumeration via crt.sh (keyless).
	app.get("/api/osint/cert", async (req, res) => {
		const domain = String(req.query.domain ?? "")
			.trim()
			.toLowerCase()
			.replace(/^https?:\/\//, "")
			.split("/")[0]
			.slice(0, 253);
		if (!/^(?!-)[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
			res
				.status(400)
				.json({ ok: false, error: "domain required (e.g. example.com)" });
			return;
		}
		try {
			// crt.sh 502/429s transiently under load — one polite retry (5s) on
			// rate/server errors only; fail fast on anything else.
			let r: Response | null = null;
			let lastErr = "";
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					const res = await fetch(
						`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`,
						{ signal: AbortSignal.timeout(35000) },
					);
					if (res.ok) {
						r = res;
						break;
					}
					lastErr = `HTTP ${res.status}`;
					if (![429, 502, 503].includes(res.status)) break;
				} catch (e: unknown) {
					lastErr = String(e).slice(0, 60);
				}
				await new Promise((ok) => setTimeout(ok, 5000));
			}
			if (!r) throw new Error(lastErr || "crt.sh unavailable");
			const rows = (await r.json()) as {
				common_name?: string;
				name_value?: string;
				not_after?: string;
				issuer_name?: string;
			}[];
			const seen = new Map<string, { expiry: string; issuer: string }>();
			for (const c of Array.isArray(rows) ? rows : []) {
				for (const n of String(c.name_value ?? "").split("\n")) {
					const s = n.trim().toLowerCase();
					if (!s || s.includes("@") || seen.has(s)) continue;
					seen.set(s, {
						expiry: String(c.not_after ?? "").slice(0, 10),
						issuer: String(c.issuer_name ?? "")
							.split(",")[0]
							.slice(0, 60),
					});
				}
			}
			res.json({
				ok: true,
				domain,
				count: seen.size,
				subdomains: [...seen.entries()]
					.slice(0, 200)
					.map(([name, m]) => ({ name, ...m })),
				truncated: seen.size > 200,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `cert lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// ASN / routing context via RIPEstat (keyless). Accepts AS number or IP/prefix.
	app.get("/api/osint/asn", async (req, res) => {
		const q = String(req.query.q ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 64);
		const asMatch = q.match(/^(?:AS)?(\d{1,10})$/);
		const ipMatch = q.match(/^[0-9A-Fa-f:.]+\/\d{1,3}$|^[0-9A-Fa-f:.]+$/);
		if (!asMatch && !ipMatch) {
			res
				.status(400)
				.json({ ok: false, error: "q required (AS number or IP/prefix)" });
			return;
		}
		try {
			if (asMatch) {
				const [ov, pf] = await Promise.all([
					fetch(
						`https://stat.ripe.net/data/as-overview/data.json?resource=AS${asMatch[1]}`,
						{
							signal: AbortSignal.timeout(15000),
						},
					).then((r) => {
						if (!r.ok) throw new Error(`HTTP ${r.status}`);
						return r.json();
					}),
					fetch(
						`https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${asMatch[1]}&min_peers_seeing=5`,
						{ signal: AbortSignal.timeout(15000) },
					).then((r) => {
						if (!r.ok) throw new Error(`HTTP ${r.status}`);
						return r.json();
					}),
				]);
				const d = (ov as { data?: Record<string, unknown> }).data ?? {};
				const p =
					(pf as { data?: { prefixes?: { prefix?: string }[] } }).data ?? {};
				res.json({
					ok: true,
					as: `AS${asMatch[1]}`,
					holder: d.holder ?? null,
					announced: d.announced ?? null,
					blocklisted: (d.blocklists ?? []) as unknown[],
					prefixes: (p.prefixes ?? []).slice(0, 50).map((x) => x.prefix),
				});
			} else {
				const r = await fetch(
					`https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(q)}`,
					{ signal: AbortSignal.timeout(15000) },
				);
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				const j = (await r.json()) as { data?: Record<string, unknown> };
				res.json({ ok: true, query: q, ...(j.data ?? {}) });
			}
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `asn lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// CVE lookup via NVD 2.0 API (keyless at low rate). id=CVE-YYYY-NNNN or q=keyword.
	app.get("/api/osint/cve", async (req, res) => {
		const id = String(req.query.id ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 20);
		const q = String(req.query.q ?? "")
			.trim()
			.slice(0, 100);
		if (!/^CVE-\d{4}-\d{4,}$/.test(id) && q.length < 3) {
			res.status(400).json({
				ok: false,
				error: "id=CVE-YYYY-NNNN or q=keyword (min 3 chars)",
			});
			return;
		}
		try {
			const url = /^CVE-\d{4}-\d{4,}$/.test(id)
				? `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${id}`
				: `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(q)}&resultsPerPage=10`;
			const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				totalResults?: number;
				vulnerabilities?: { cve?: Record<string, unknown> }[];
			};
			const out = (j.vulnerabilities ?? []).slice(0, 10).map((v) => {
				const c = (v.cve ?? {}) as Record<string, unknown>;
				const m = c.metrics as
					| {
							cvssMetricV31?: {
								cvssData?: { baseScore?: number; baseSeverity?: string };
							}[];
					  }
					| undefined;
				const cvss = m?.cvssMetricV31?.[0]?.cvssData;
				const desc = c.descriptions as
					| { lang?: string; value?: string }[]
					| undefined;
				return {
					id: c.id,
					status: c.vulnStatus,
					published: String(c.published ?? "").slice(0, 10),
					score: cvss?.baseScore ?? null,
					severity: cvss?.baseSeverity ?? null,
					summary: String(
						desc?.find((d) => d.lang === "en")?.value ?? "",
					).slice(0, 300),
				};
			});
			res.json({ ok: true, total: j.totalResults ?? out.length, items: out });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `cve lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// EPSS exploit-probability (FIRST.org, keyless): the prioritize-this
	// number next to NVD severity. Fails honestly when FIRST is down.
	app.get("/api/osint/epss", async (req, res) => {
		const id = String(req.query.id ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 20);
		if (!/^CVE-\d{4}-\d{4,}$/.test(id)) {
			res.status(400).json({ ok: false, error: "id=CVE-YYYY-NNNN required" });
			return;
		}
		try {
			res.json({ ok: true, ...(await fetchEpss(id)) });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `epss lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// OSV record (Google, keyless): affected packages + fix ranges the NVD
	// entry lacks. Failover of choice when NVD rate-limits.
	app.get("/api/osint/osv", async (req, res) => {
		const id = String(req.query.id ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 20);
		if (!/^CVE-\d{4}-\d{4,}$/.test(id)) {
			res.status(400).json({ ok: false, error: "id=CVE-YYYY-NNNN required" });
			return;
		}
		try {
			res.json({ ok: true, ...(await fetchOsv(id)) });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `osv lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// CIRCL CVE record (keyless aggregator): second-opinion summary when
	// NVD/crt.sh flake. Honest 502, never synthesized.
	app.get("/api/osint/circl", async (req, res) => {
		const id = String(req.query.id ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 20);
		if (!/^CVE-\d{4}-\d{4,}$/.test(id)) {
			res.status(400).json({ ok: false, error: "id=CVE-YYYY-NNNN required" });
			return;
		}
		try {
			res.json({ ok: true, ...(await fetchCircl(id)) });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `circl lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// MITRE CVE record (authoritative, keyless): upstream of CIRCL — the
	// failover chain is NVD → CIRCL → MITRE. Honest 502, never synthesized.
	app.get("/api/osint/mitre-cve", async (req, res) => {
		const id = String(req.query.id ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 20);
		if (!/^CVE-\d{4}-\d{4,}$/.test(id)) {
			res.status(400).json({ ok: false, error: "id=CVE-YYYY-NNNN required" });
			return;
		}
		try {
			const r = await fetch(`https://cveawg.mitre.org/api/cve/${id}`, {
				signal: AbortSignal.timeout(15000),
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				cveMetadata?: {
					cveId?: string;
					state?: string;
					assignerShortName?: string;
					datePublished?: string;
				};
				containers?: {
					cna?: { title?: string; descriptions?: { value?: string }[] };
				};
			};
			const cna = j.containers?.cna;
			res.json({
				ok: true,
				id: j.cveMetadata?.cveId ?? id,
				title: cna?.title ?? null,
				state: j.cveMetadata?.state ?? null,
				assigner: j.cveMetadata?.assignerShortName ?? null,
				published:
					String(j.cveMetadata?.datePublished ?? "").slice(0, 10) || null,
				summary: String(cna?.descriptions?.[0]?.value ?? "").slice(0, 400),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `mitre-cve lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Photon reverse-geocode (Komoot, keyless OSM): second opinion next to
	// Nominatim — richer POI detail (street/locality/postcode).
	app.get("/api/osint/geocode", async (req, res) => {
		const lat = Number(req.query.lat);
		const lng = Number(req.query.lng ?? req.query.lon);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
			res.status(400).json({ ok: false, error: "lat + lng required" });
			return;
		}
		try {
			const r = await fetch(
				`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				features?: { properties?: Record<string, unknown> }[];
			};
			const p = j.features?.[0]?.properties;
			res.json({
				ok: true,
				label: p
					? [p.name, p.street, p.city, p.country].filter(Boolean).join(", ")
					: null,
				props: p ?? null,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `geocode lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// IMF DataMapper (keyless): GDP growth / inflation / unemployment, latest
	// year per country — forecast-vintage second opinion next to World Bank.
	const IMF_INDS = [
		["NGDP_RPCH", "GDP_GROWTH"],
		["PCPIPCH", "INFLATION"],
		["LUR", "UNEMPLOYMENT"],
	] as const;
	app.get("/api/osint/macro-imf", async (req, res) => {
		const code = String(req.query.country ?? req.query.q ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 3);
		if (!/^[A-Z]{2,3}$/.test(code)) {
			res
				.status(400)
				.json({ ok: false, error: "country required (ISO2/ISO3, e.g. DEU)" });
			return;
		}
		try {
			const items = await Promise.all(
				IMF_INDS.map(async ([ind, key]) => {
					const r = await fetch(
						`https://www.imf.org/external/datamapper/api/v1/${ind}/${encodeURIComponent(code)}`,
						{ signal: AbortSignal.timeout(15000) },
					);
					if (!r.ok) throw new Error(`HTTP ${r.status} for ${ind}`);
					const j = (await r.json()) as {
						values?: Record<
							string,
							Record<string, Record<string, number | null>>
						>;
					};
					const series: Record<string, number | null> =
						j.values?.[ind]?.[code] ?? {};
					const years = Object.keys(series)
						.map(Number)
						.filter((y) => Number.isFinite(y) && series[String(y)] !== null);
					const year = years.length ? Math.max(...years) : null;
					return {
						key,
						date: year ? String(year) : "?",
						value: year !== null ? (series[String(year)] ?? null) : null,
					};
				}),
			);
			res.json({ ok: true, country: code, items });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `macro-imf lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Sitrep: deterministic markdown snapshot of the brief, archived by day.
	// The archive IS the history clock future analytics (market HUD etc.) read from.
	// treemap still needs a company dataset (docs/roadmap.md).
	app.get("/api/osint/company", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required (legal name)" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(q)}&page[size]=5`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				data?: {
					id?: string;
					attributes?: {
						lei?: string;
						entity?: {
							legalName?: { name?: string };
							jurisdiction?: string;
							status?: string;
							headquartersAddress?: { country?: string; city?: string };
						};
						registration?: { status?: string };
					};
				}[];
			};
			const items = (Array.isArray(j.data) ? j.data : [])
				.slice(0, 5)
				.map((d) => ({
					lei: d.attributes?.lei ?? d.id ?? "?",
					name: d.attributes?.entity?.legalName?.name ?? "?",
					country: d.attributes?.entity?.headquartersAddress?.country ?? "?",
					city: d.attributes?.entity?.headquartersAddress?.city ?? "",
					jurisdiction: d.attributes?.entity?.jurisdiction ?? "?",
					status: d.attributes?.entity?.status ?? "?",
					regStatus: d.attributes?.registration?.status ?? "?",
				}));
			res.json({ ok: true, count: items.length, items });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `company lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Wikidata entity search (keyless): person/org/concept → QID + label.
	app.get("/api/osint/wikidata", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required" });
			return;
		}
		try {
			const r = await fetch(
				`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&format=json&limit=8`,
				{
					headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				search?: {
					id?: string;
					label?: string;
					description?: string;
					url?: string;
				}[];
			};
			res.json({
				ok: true,
				items: (j.search ?? []).slice(0, 8).map((s) => ({
					qid: s.id,
					label: s.label,
					desc: s.description ?? null,
					url: s.url ?? `https://www.wikidata.org/wiki/${s.id}`,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `wikidata lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Wikipedia summary (keyless REST): entity brief sidebar for the dossier.
	app.get("/api/osint/wiki", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required" });
			return;
		}
		try {
			const r = await fetch(
				`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`,
				{
					headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				title?: string;
				description?: string;
				extract?: string;
				content_urls?: { desktop?: { page?: string } };
				thumbnail?: { source?: string };
			};
			res.json({
				ok: true,
				title: j.title ?? q,
				desc: j.description ?? null,
				extract: (j.extract ?? "").slice(0, 600),
				url: j.content_urls?.desktop?.page ?? null,
				thumb: j.thumbnail?.source ?? null,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `wiki lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// OpenLibrary works (keyless): book/edition search for the research desk.
	app.get("/api/osint/books", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required" });
			return;
		}
		try {
			const r = await fetch(
				`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=8`,
				{
					headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				numFound?: number;
				docs?: {
					title?: string;
					author_name?: string[];
					first_publish_year?: number;
					key?: string;
				}[];
			};
			res.json({
				ok: true,
				total: j.numFound ?? 0,
				items: (j.docs ?? []).slice(0, 8).map((d) => ({
					title: d.title,
					author: d.author_name?.[0] ?? null,
					year: d.first_publish_year ?? null,
					url: d.key ? `https://openlibrary.org${d.key}` : null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `books lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// StackExchange search (keyless): tech-signal Q&A for the research desk.
	app.get("/api/osint/stack", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.stackexchange.com/2.3/search?order=desc&sort=votes&intitle=${encodeURIComponent(q)}&site=stackoverflow&pagesize=8`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				items?: {
					title?: string;
					link?: string;
					score?: number;
					answer_count?: number;
					creation_date?: number;
				}[];
			};
			res.json({
				ok: true,
				items: (j.items ?? []).slice(0, 8).map((x) => ({
					title: x.title,
					url: x.link,
					score: x.score ?? 0,
					answers: x.answer_count ?? 0,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `stack lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Nominatim forward search (keyless, 1 req/s — on-demand only): place →
	// lat/lon bbox + OSM class. Second opinion next to Photon reverse route.
	app.get("/api/osint/nominatim", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required (place name)" });
			return;
		}
		try {
			const r = await fetch(
				`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
				{
					headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				display_name?: string;
				lat?: string;
				lon?: string;
				type?: string;
				class?: string;
			}[];
			res.json({
				ok: true,
				items: (Array.isArray(j) ? j : []).slice(0, 5).map((x) => ({
					label: x.display_name,
					lat: Number(x.lat),
					lon: Number(x.lon),
					type: x.type,
					class: x.class,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `nominatim lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// OM geocoding forward search (keyless): place → lat/lon + country +
	// population — second opinion next to Nominatim (no 1req/s limit).
	app.get("/api/osint/omgeo", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required (place name)" });
			return;
		}
		try {
			const r = await fetch(
				`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				results?: {
					name?: string;
					latitude?: number;
					longitude?: number;
					country?: string;
					country_code?: string;
					population?: number;
					timezone?: string;
				}[];
			};
			res.json({
				ok: true,
				items: (j.results ?? []).slice(0, 5).map((x) => ({
					label: [x.name, x.country].filter(Boolean).join(", "),
					lat: x.latitude,
					lon: x.longitude,
					country: x.country,
					population: x.population ?? null,
					timezone: x.timezone ?? null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `omgeo lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Maltiverse hostname reputation (keyless): blacklist hits + flags
	// (cnc/phishing/malware/proxy/tor) + resolved IP — second opinion next
	// to OTX/robtex for domain triage.
	app.get("/api/osint/maltiverse", async (req, res) => {
		const q = String(
			req.query.host ?? req.query.q ?? req.query.query ?? req.query.ip ?? "",
		)
			.trim()
			.toLowerCase()
			.slice(0, 120);
		if (!/^[a-z0-9.:-]{3,120}$/.test(q)) {
			res
				.status(400)
				.json({ ok: false, error: "host required (hostname or IPv4)" });
			return;
		}
		const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(q);
		try {
			const r = await fetch(
				`https://api.maltiverse.com/${isIp ? "ip" : "hostname"}/${encodeURIComponent(q)}`,
				{
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				classification?: string;
				is_cnc?: boolean;
				is_phishing?: boolean;
				is_distributing_malware?: boolean;
				is_open_proxy?: boolean;
				is_tor_node?: boolean;
				resolved_ip?: { ip_addr?: string }[];
				blacklist?: { description?: string; source?: string }[];
			};
			res.json({
				ok: true,
				host: q,
				classification: j.classification ?? null,
				asn: (j as { as_name?: string }).as_name ?? null,
				city: (j as { city?: string }).city ?? null,
				flags: {
					cnc: !!j.is_cnc,
					phishing: !!j.is_phishing,
					malware: !!j.is_distributing_malware,
					proxy: !!j.is_open_proxy,
					tor: !!j.is_tor_node,
				},
				resolved_ip: (j.resolved_ip ?? []).slice(0, 5).map((x) => x.ip_addr),
				blacklist: (j.blacklist ?? []).slice(0, 10).map((x) => ({
					desc: x.description,
					src: x.source,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `maltiverse lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// urlscan search (keyless GET): recent scans for a domain — the
	// screenshot/scan leg next to Maltiverse reputation.
	app.get("/api/osint/urlscan", async (req, res) => {
		const q = String(req.query.host ?? req.query.q ?? req.query.query ?? "")
			.trim()
			.toLowerCase()
			.slice(0, 120);
		if (!/^[a-z0-9.-]{3,120}$/.test(q)) {
			res.status(400).json({ ok: false, error: "host required (domain)" });
			return;
		}
		try {
			const r = await fetch(
				`https://urlscan.io/api/v1/search/?q=domain%3A${encodeURIComponent(q)}&size=5`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				total?: number;
				results?: {
					task?: { url?: string; time?: string };
					page?: { url?: string; country?: string; ip?: string };
				}[];
			};
			res.json({
				ok: true,
				host: q,
				total: j.total ?? null,
				scans: (j.results ?? []).slice(0, 5).map((x) => ({
					url: x.page?.url ?? x.task?.url ?? null,
					country: x.page?.country ?? null,
					ip: x.page?.ip ?? null,
					time: x.task?.time ?? null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `urlscan lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// openFDA drug labels (keyless): brand/generic → purpose + warnings.
	app.get("/api/osint/fda-drug", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required (drug name)" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.fda.gov/drug/label.json?search=openfda.brand_name:${encodeURIComponent(`"${q}"`)}&limit=3`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				results?: {
					openfda?: { brand_name?: string[]; generic_name?: string[] };
					purpose?: string[];
					warnings?: string[];
				}[];
			};
			res.json({
				ok: true,
				items: (j.results ?? []).slice(0, 3).map((x) => ({
					brand: x.openfda?.brand_name?.[0] ?? q,
					generic: x.openfda?.generic_name?.[0] ?? null,
					purpose: (x.purpose?.[0] ?? "").slice(0, 300),
					warnings: (x.warnings?.[0] ?? "").slice(0, 300),
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `fda-drug lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// DailyMed drug names (keyless NLM): brand/generic name variants.
	app.get("/api/osint/dailymed", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required (drug name)" });
			return;
		}
		try {
			const r = await fetch(
				`https://dailymed.nlm.nih.gov/dailymed/services/v2/drugnames.json?drug_name=${encodeURIComponent(q)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				data?: { name_type?: string; drug_name?: string }[];
			};
			res.json({
				ok: true,
				items: (j.data ?? []).slice(0, 8).map((x) => ({
					name: x.drug_name,
					type: x.name_type === "B" ? "brand" : "generic",
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `dailymed lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Nager public holidays (keyless): country/year → holiday calendar.
	app.get("/api/osint/holidays", async (req, res) => {
		const cc = String(req.query.cc ?? req.query.country ?? "US")
			.trim()
			.toUpperCase()
			.slice(0, 2);
		const year = Number(req.query.year ?? 2026);
		if (!/^[A-Z]{2}$/.test(cc) || !Number.isFinite(year)) {
			res.status(400).json({ ok: false, error: "cc required (ISO2)" });
			return;
		}
		try {
			const r = await fetch(
				`https://date.nager.at/api/v3/publicholidays/${year}/${encodeURIComponent(cc)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				date?: string;
				localName?: string;
				name?: string;
				global?: boolean;
			}[];
			res.json({
				ok: true,
				cc,
				year,
				items: (Array.isArray(j) ? j : []).slice(0, 20).map((x) => ({
					date: x.date,
					name: x.name,
					local: x.localName,
					global: x.global ?? null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `holidays lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// npm weekly downloads (keyless): package → last-week DL count.
	app.get("/api/osint/npm-dl", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? req.query.name ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 1) {
			res.status(400).json({ ok: false, error: "query required (package)" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(q)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as Record<
				string,
				{ downloads?: number; start?: string; end?: string }
			>;
			const row = j[q] ?? Object.values(j)[0];
			res.json({
				ok: true,
				package: q,
				downloads: row?.downloads ?? null,
				week: row ? `${row.start}→${row.end}` : null,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `npm-dl lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// RxNorm drug products (keyless NLM): name → SBD/SCD dose forms.
	app.get("/api/osint/rxnorm", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required (drug name)" });
			return;
		}
		try {
			const r = await fetch(
				`https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(q)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				drugGroup?: {
					conceptGroup?: {
						tty?: string;
						conceptProperties?: { name?: string; rxcui?: string }[];
					}[];
				};
			};
			const groups = (j.drugGroup?.conceptGroup ?? []).filter((g) =>
				["SBD", "SCD"].includes(g.tty ?? ""),
			);
			res.json({
				ok: true,
				drug: q,
				forms: groups.flatMap((g) =>
					(g.conceptProperties ?? []).slice(0, 5).map((c) => ({
						tty: g.tty,
						name: (c.name ?? "").slice(0, 160),
						rxcui: c.rxcui ?? null,
					})),
				),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `rxnorm lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// ChemBL molecule (keyless EBI, .json suffix): name → ChEMBL id + phase.
	app.get("/api/osint/chembl", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required (compound)" });
			return;
		}
		try {
			const r = await fetch(
				`https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?q=${encodeURIComponent(q)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				molecules?: {
					molecule_chembl_id?: string;
					pref_name?: string;
					molecule_type?: string;
					max_phase?: number;
				}[];
			};
			res.json({
				ok: true,
				items: (j.molecules ?? []).slice(0, 5).map((m) => ({
					id: m.molecule_chembl_id,
					name: m.pref_name ?? q,
					type: m.molecule_type ?? null,
					maxPhase: m.max_phase ?? null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `chembl lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// JPL SBDB small-body lookup (keyless): designation → orbit class + PHA flag.
	app.get("/api/osint/sbdb", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 60);
		if (!q) {
			res
				.status(400)
				.json({ ok: false, error: "query required (designation)" });
			return;
		}
		try {
			const r = await fetch(
				`https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(q)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				object?: {
					fullname?: string;
					pha?: boolean;
					neo?: boolean;
					orbit_class?: { name?: string; code?: string };
					orbit?: never;
				};
				orbit?: {
					first_obs?: string;
					last_obs?: string;
					moid?: string;
					condition_code?: string;
				};
			};
			const o = j.object;
			res.json({
				ok: true,
				name: o?.fullname ?? q,
				pha: o?.pha ?? null,
				neo: o?.neo ?? null,
				orbitClass: o?.orbit_class?.name ?? null,
				moidAU: o
					? Number((j as { orbit?: { moid?: string } }).orbit?.moid ?? NaN) ||
						null
					: null,
				firstObs: j.orbit?.first_obs ?? null,
				lastObs: j.orbit?.last_obs ?? null,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `sbdb lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// deps.dev direct + transitive deps (keyless Google OSV): eco+name@version.
	app.get("/api/osint/deps", async (req, res) => {
		const eco = String(req.query.eco ?? "npm")
			.trim()
			.toUpperCase()
			.slice(0, 10);
		const name = String(req.query.name ?? "")
			.trim()
			.slice(0, 120);
		const ver = String(req.query.version ?? "")
			.trim()
			.slice(0, 40);
		if (!name || !ver) {
			res.status(400).json({ ok: false, error: "name + version required" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.deps.dev/v3/systems/${encodeURIComponent(eco)}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(ver)}:dependencies`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				nodes?: {
					versionKey?: { name?: string; version?: string };
					relation?: string;
				}[];
			};
			const nodes = j.nodes ?? [];
			res.json({
				ok: true,
				eco,
				name,
				version: ver,
				direct: nodes.filter((x) => x.relation === "DIRECT").length,
				total: nodes.length,
				deps: nodes
					.filter((x) => x.relation === "DIRECT")
					.slice(0, 15)
					.map((x) => `${x.versionKey?.name}@${x.versionKey?.version}`),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `deps lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// NASA image search (keyless): keyword → thumbnails + center links.
	app.get("/api/osint/nasa-img", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required" });
			return;
		}
		try {
			const r = await fetch(
				`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image&page_size=5`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				collection?: {
					items?: {
						data?: {
							title?: string;
							date_created?: string;
							nasa_id?: string;
						}[];
						href?: string;
					}[];
				};
			};
			res.json({
				ok: true,
				items: (j.collection?.items ?? []).slice(0, 5).map((x) => ({
					title: x.data?.[0]?.title ?? "?",
					date: x.data?.[0]?.date_created?.slice(0, 10) ?? null,
					nasaId: x.data?.[0]?.nasa_id ?? null,
					href: x.href ?? null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `nasa-img lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// NCBI gene search (keyless E-utilities): symbol → gene count + top ID.
	app.get("/api/osint/gene", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 60);
		if (q.length < 2) {
			res
				.status(400)
				.json({ ok: false, error: "query required (gene symbol)" });
			return;
		}
		try {
			const r = await fetch(
				`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gene&term=${encodeURIComponent(q)}&retmax=3&retmode=json`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				esearchresult?: { count?: string; idlist?: string[] };
			};
			res.json({
				ok: true,
				gene: q.toUpperCase(),
				count: Number(j.esearchresult?.count ?? 0),
				ids: (j.esearchresult?.idlist ?? []).slice(0, 3),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `gene lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// OLS ontology search (keyless EBI): term → ontology concepts.
	app.get("/api/osint/ontology", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required" });
			return;
		}
		try {
			const r = await fetch(
				`https://www.ebi.ac.uk/ols4/api/search?q=${encodeURIComponent(q)}&rows=5`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				response?: {
					docs?: {
						label?: string;
						obo_id?: string;
						description?: string[];
						ontology_name?: string;
					}[];
				};
			};
			res.json({
				ok: true,
				items: (j.response?.docs ?? []).slice(0, 5).map((d) => ({
					label: d.label,
					id: d.obo_id,
					desc: (d.description?.[0] ?? "").slice(0, 200),
					ontology: d.ontology_name,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `ontology lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// UniProt protein search (keyless): gene → accession + organism + length.
	app.get("/api/osint/protein", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 60);
		if (q.length < 2) {
			res
				.status(400)
				.json({ ok: false, error: "query required (gene/protein)" });
			return;
		}
		try {
			const r = await fetch(
				`https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(`gene:${q}`)}&format=json&size=3`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				results?: {
					primaryAccession?: string;
					uniProtkbId?: string;
					organism?: { scientificName?: string };
					sequence?: { length?: number };
				}[];
			};
			res.json({
				ok: true,
				items: (j.results ?? []).slice(0, 3).map((x) => ({
					acc: x.primaryAccession,
					id: x.uniProtkbId,
					organism: x.organism?.scientificName ?? null,
					length: x.sequence?.length ?? null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `protein lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Package registries (keyless): npm + PyPI + crates + gems metadata.
	app.get("/api/osint/package", async (req, res) => {
		const eco = String(req.query.eco ?? "npm")
			.trim()
			.toLowerCase()
			.slice(0, 10);
		const name = String(req.query.name ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (!name) {
			res.status(400).json({ ok: false, error: "name required (package)" });
			return;
		}
		try {
			const urls: Record<string, string> = {
				npm: `https://registry.npmjs.org/${encodeURIComponent(name)}`,
				pypi: `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
				crates: `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
				gems: `https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`,
			};
			const url = urls[eco] ?? urls.npm;
			const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as Record<string, unknown>;
			const latest =
				eco === "npm"
					? ((j["dist-tags"] as Record<string, string> | undefined)?.latest ??
						null)
					: eco === "pypi"
						? String(
								j.info
									? ((j.info as Record<string, unknown>).version ?? "")
									: "",
							)
						: eco === "crates"
							? (((j.crate as Record<string, unknown> | undefined)
									?.newest_version as string | undefined) ?? null)
							: String(j.version ?? "");
			res.json({
				ok: true,
				eco,
				name,
				latest: latest || null,
				desc: String(
					(eco === "npm"
						? j.description
						: eco === "pypi"
							? (j.info as Record<string, unknown> | undefined)?.summary
							: eco === "crates"
								? (j.crate as Record<string, unknown> | undefined)?.description
								: j.info) ?? "",
				).slice(0, 300),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `package lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Sunrise-sunset (keyless): daylight bounds for any lat/lon.
	app.get("/api/osint/daylight", async (req, res) => {
		const lat = Number(req.query.lat);
		const lng = Number(req.query.lng ?? req.query.lon);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
			res.status(400).json({ ok: false, error: "lat + lng required" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&formatted=0`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				results?: { sunrise?: string; sunset?: string; day_length?: number };
			};
			res.json({
				ok: true,
				sunrise: j.results?.sunrise ?? null,
				sunset: j.results?.sunset ?? null,
				dayLengthSec: j.results?.day_length ?? null,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `daylight lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Zippopotam (keyless): postal code → place + lat/lon, worldwide paths.
	app.get("/api/osint/zip", async (req, res) => {
		const cc = String(req.query.cc ?? req.query.country ?? "us")
			.trim()
			.toLowerCase()
			.slice(0, 2);
		const code = String(req.query.code ?? req.query.q ?? "")
			.trim()
			.slice(0, 20);
		if (!code) {
			res.status(400).json({ ok: false, error: "code required (postal code)" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.zippopotam.us/${encodeURIComponent(cc)}/${encodeURIComponent(code)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				places?: {
					"place name"?: string;
					latitude?: string;
					longitude?: string;
					state?: string;
				}[];
			};
			res.json({
				ok: true,
				places: (j.places ?? []).slice(0, 5).map((p) => ({
					name: p["place name"],
					state: p.state,
					lat: Number(p.latitude),
					lon: Number(p.longitude),
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `zip lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Macro snapshot via World Bank (keyless): GDP, GDP per capita, inflation,
	// population — latest available values. Markets depth without a Finnhub key.
	app.get("/api/osint/macro", async (req, res) => {
		const code = String(req.query.country ?? req.query.q ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 3);
		if (!/^[A-Z]{2,3}$/.test(code)) {
			res
				.status(400)
				.json({ ok: false, error: "country required (ISO2/ISO3, e.g. DEU)" });
			return;
		}
		try {
			const INDS = [
				["NY.GDP.MKTP.CD", "GDP_USD"],
				["NY.GDP.PCAP.CD", "GDP_PC_USD"],
				["FP.CPI.TOTL.ZG", "INFL_PCT"],
				["SP.POP.TOTL", "POP"],
			] as const;
			const items = await Promise.all(
				INDS.map(async ([ind, key]) => {
					const r = await fetch(
						`https://api.worldbank.org/v2/country/${encodeURIComponent(code)}/indicator/${ind}?format=json&per_page=10`,
						{ signal: AbortSignal.timeout(15000) },
					);
					if (!r.ok) throw new Error(`HTTP ${r.status} for ${ind}`);
					const j = (await r.json()) as [
						unknown,
						{ date?: string; value?: number | null }[]?,
					];
					const row = (Array.isArray(j[1]) ? j[1] : []).find(
						(x) => x?.value !== null && x?.value !== undefined,
					);
					return {
						key,
						date: row?.date ?? "?",
						value: row?.value ?? null,
					};
				}),
			);
			res.json({ ok: true, country: code, items });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `macro lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});
	app.get("/api/osint/sirene", async (req, res) => {
		// French business registry (recherche-entreprises.api.gouv.fr,
		// keyless, INSEE Sirene). Company name → SIREN + HQ + activity.
		// Sourced from flowsint digest 2026-09-17 (SireneTool, same host).
		const q = String(req.query.q ?? req.query.name ?? "")
			.trim()
			.slice(0, 120);
		if (!q) {
			res.status(400).json({ ok: false, error: "q required (company name)" });
			return;
		}
		try {
			const r = await fetch(
				`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=5`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				results?: {
					siren?: string;
					nom_complet?: string;
					nombre_etablissements?: number;
					siege?: {
						adresse?: string;
						latitude?: number;
						longitude?: number;
						activite_principale?: string;
					};
				}[];
			};
			const items = (j.results ?? []).slice(0, 5).map((c) => ({
				siren: c.siren ?? "?",
				name: c.nom_complet ?? "?",
				establishments: c.nombre_etablissements ?? null,
				address: c.siege?.adresse ?? null,
				lat: c.siege?.latitude ?? null,
				lon: c.siege?.longitude ?? null,
				activity: c.siege?.activite_principale ?? null,
			}));
			res.json({ ok: true, q, items });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `sirene lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});
	app.get("/api/osint/stealers", async (req, res) => {
		// HudsonRock info-stealer lookup (cavalier.hudsonrock.com, keyless
		// free tier). Email or username → infected? + stealer list.
		// Sourced from flowsint digest 2026-09-17 (to_hudsonrock enrichers);
		// probed: unknown emails return 200 with empty stealers[].
		const email = String(req.query.email ?? "")
			.trim()
			.slice(0, 120);
		const username = String(req.query.username ?? "")
			.trim()
			.slice(0, 60);
		if (!email && !username) {
			res.status(400).json({ ok: false, error: "email or username required" });
			return;
		}
		try {
			const url = email
				? `https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email=${encodeURIComponent(email)}`
				: `https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-username?username=${encodeURIComponent(username)}`;
			const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				message?: string;
				stealers?: { stealer_name?: string; date_compromised?: string }[];
				total_corporate_services?: number;
				total_user_services?: number;
			};
			const stealers = j.stealers ?? [];
			res.json({
				ok: true,
				q: email || username,
				infected: stealers.length > 0,
				stealers: stealers.slice(0, 10),
				corporate_services: j.total_corporate_services ?? 0,
				user_services: j.total_user_services ?? 0,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `stealer lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});
	app.get("/api/osint/gravatar", async (req, res) => {
		// Gravatar existence + profile (keyless, md5-of-email addressing).
		// Sourced from flowsint digest 2026-09-17 (email_to_gravatar:
		// HEAD avatar with d=404 → 200 means an account exists).
		const email = String(req.query.email ?? "")
			.trim()
			.toLowerCase()
			.slice(0, 120);
		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
			res.status(400).json({ ok: false, error: "valid email required" });
			return;
		}
		try {
			const { createHash } = await import("node:crypto");
			const hash = createHash("md5").update(email).digest("hex");
			const head = await fetch(
				`https://www.gravatar.com/avatar/${hash}?d=404`,
				{
					signal: AbortSignal.timeout(15000),
				},
			);
			if (head.status === 404)
				return res.json({ ok: true, email, hash, exists: false });
			if (!head.ok) throw new Error(`HTTP ${head.status}`);
			let profile: unknown = null;
			try {
				const pr = await fetch(`https://www.gravatar.com/${hash}.json`, {
					signal: AbortSignal.timeout(15000),
				});
				if (pr.ok) profile = await pr.json();
			} catch {
				profile = null; // avatar exists, profile fetch optional
			}
			res.json({ ok: true, email, hash, exists: true, profile });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `gravatar lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});
}

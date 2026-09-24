import type express from "express";
import { z } from "zod";

/**
 * Keyless recon lookups, on-demand only (never polled).
 * - RDAP: IETF registration data via IANA bootstrap (replaces WHOIS, no key).
 * - DNS: HackerTarget dnslookup + geoip + aslookup (free tier 50/day/IP —
 *   single-lookup OSINT only, never a collector).
 * Failures return ok:false with reason — never fabricated data.
 */
const RDAP_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";
const HACKERTARGET = "https://api.hackertarget.com";

let rdapBootstrap: { services?: [string[], string[]][] } | null = null;
async function rdapServerForTld(tld: string): Promise<string | null> {
	try {
		if (!rdapBootstrap) {
			const r = await fetch(RDAP_BOOTSTRAP, {
				signal: AbortSignal.timeout(10000),
			});
			if (!r.ok) return null;
			rdapBootstrap = (await r.json()) as typeof rdapBootstrap;
		}
		for (const [tlds, urls] of rdapBootstrap?.services ?? []) {
			if (tlds.some((t) => t.toLowerCase() === tld.toLowerCase()))
				return urls[0] ?? null;
		}
		return null;
	} catch {
		return null;
	}
}

export function registerRecon(app: express.Express): void {
	// RDAP domain lookup: registrar, creation/expiry, status, nameservers.
	app.get("/api/osint/rdap", async (req, res) => {
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
			const tld = domain.split(".").pop() ?? "";
			const base =
				(await rdapServerForTld(tld)) ?? "https://rdap.verisign.com/com/v1/";
			const r = await fetch(
				`${base.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				ldhName?: string;
				status?: string[];
				events?: { eventAction?: string; eventDate?: string }[];
				entities?: { handle?: string; vcardArray?: unknown }[];
				nameservers?: { ldhName?: string }[];
			};
			const event = (a?: string) =>
				j.events?.find((e) => e.eventAction === a)?.eventDate?.slice(0, 10) ??
				null;
			res.json({
				ok: true,
				domain: j.ldhName ?? domain,
				status: j.status ?? [],
				created: event("registration"),
				updated: event("last changed"),
				expires: event("expiration"),
				nameservers: (j.nameservers ?? []).map((n) => n.ldhName).slice(0, 10),
				registrar: j.entities?.[0]?.handle ?? null,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `rdap lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	const DnsParams = z.object({
		q: z.string().trim().min(1).max(253),
	});
	// DNS records via HackerTarget free tier (A/AAAA/MX/NS/TXT/SOA).
	app.get("/api/osint/dns", async (req, res) => {
		const p = DnsParams.safeParse({ q: req.query.q });
		if (!p.success) {
			res.status(400).json({ ok: false, error: "q required (domain)" });
			return;
		}
		try {
			const r = await fetch(
				`${HACKERTARGET}/dnslookup/?q=${encodeURIComponent(p.data.q)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			res.json({
				ok: true,
				q: p.data.q,
				records: (await r.text()).slice(0, 2000),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `dns lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Reverse IP: hosts sharing an IP (HackerTarget free tier).
	app.get("/api/osint/reverse", async (req, res) => {
		const p = DnsParams.safeParse({ q: req.query.q });
		if (!p.success) {
			res.status(400).json({ ok: false, error: "q required (IP or domain)" });
			return;
		}
		try {
			const r = await fetch(
				`${HACKERTARGET}/reverseiplookup/?q=${encodeURIComponent(p.data.q)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			res.json({
				ok: true,
				q: p.data.q,
				hosts: (await r.text()).slice(0, 2000),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `reverse lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// SEC EDGAR full-text filing search (keyless, UA required): what US-listed
	// companies tell regulators — 8-Ks, 10-K risk factors, S-1s.
	app.get("/api/osint/edgar", async (req, res) => {
		const q = String(req.query.q ?? "")
			.trim()
			.slice(0, 200);
		if (q.length < 3) {
			res.status(400).json({ ok: false, error: "q required (min 3 chars)" });
			return;
		}
		try {
			const r = await fetch(
				`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}`,
				{
					headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
					signal: AbortSignal.timeout(20000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				hits?: {
					total?: { value?: number };
					hits?: { _source?: Record<string, unknown> }[];
				};
			};
			const items = (j.hits?.hits ?? []).slice(0, 10).map((h) => {
				const s = (h._source ?? {}) as Record<string, unknown>;
				return {
					company: s.display_names,
					form: s.form,
					filed: s.file_date,
					cik: (s.ciks as string[] | undefined)?.[0] ?? null,
					place: s.biz_locations,
				};
			});
			res.json({
				ok: true,
				q,
				total: j.hits?.total?.value ?? items.length,
				items,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `edgar lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// DNS-over-HTTPS via Cloudflare (keyless, no quota pain): independent
	// second opinion next to HackerTarget's 50/day tier.
	app.get("/api/osint/doh", async (req, res) => {
		const name = String(req.query.name ?? "")
			.trim()
			.toLowerCase()
			.slice(0, 253);
		const type = String(req.query.type ?? "A")
			.toUpperCase()
			.slice(0, 10);
		if (!/^(?!-)[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) {
			res.status(400).json({ ok: false, error: "name required (domain)" });
			return;
		}
		try {
			const r = await fetch(
				`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
				{
					headers: { accept: "application/dns-json" },
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				Status?: number;
				Answer?: {
					name?: string;
					type?: number;
					TTL?: number;
					data?: string;
				}[];
			};
			res.json({
				ok: true,
				name,
				type,
				status: j.Status,
				answers: (j.Answer ?? []).slice(0, 20),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `doh lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// DNS-over-HTTPS via Google (keyless, no quota): second opinion next to
	// Cloudflare DoH — when one resolver flakes the other still answers.
	app.get("/api/osint/doh-google", async (req, res) => {
		const name = String(req.query.name ?? "")
			.trim()
			.toLowerCase()
			.slice(0, 253);
		const type = String(req.query.type ?? "A")
			.toUpperCase()
			.slice(0, 10);
		if (!/^(?!-)[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) {
			res.status(400).json({ ok: false, error: "name required (domain)" });
			return;
		}
		try {
			const r = await fetch(
				`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				Status?: number;
				Answer?: {
					name?: string;
					type?: number;
					TTL?: number;
					data?: string;
				}[];
			};
			res.json({
				ok: true,
				name,
				type,
				status: j.Status,
				answers: (j.Answer ?? []).slice(0, 20),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `doh-google lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// ipwhois.app (keyless 10k/month): lat/lon + ASN + ISP in one call —
	// second source next to ip-api.com when it rate-limits (HTTP 429 holds).
	app.get("/api/osint/ipwhois", async (req, res) => {
		const host = String(req.query.host ?? "")
			.trim()
			.slice(0, 253);
		if (!/^[a-zA-Z0-9.:-]+$/.test(host) || !host) {
			res
				.status(400)
				.json({ ok: false, error: "host required (hostname, IPv4/IPv6)" });
			return;
		}
		try {
			const r = await fetch(
				`https://ipwhois.app/json/${encodeURIComponent(host)}`,
				{
					headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as Record<string, unknown>;
			if (j.success === false)
				throw new Error(String(j.message ?? "lookup failed"));
			res.json({ ok: true, ...j });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `ipwhois lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Shodan internetdb (keyless, no signup): open ports, hostnames, vulns
	// for an IP — the highest-signal recon find of the hunt. On-demand only.
	app.get("/api/osint/ports", async (req, res) => {
		const host = String(req.query.host ?? "")
			.trim()
			.slice(0, 253);
		if (!/^[a-zA-Z0-9.:-]+$/.test(host) || !host) {
			res
				.status(400)
				.json({ ok: false, error: "host required (hostname, IPv4/IPv6)" });
			return;
		}
		try {
			const r = await fetch(
				`https://internetdb.shodan.io/${encodeURIComponent(host)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				ip?: string;
				ports?: number[];
				hostnames?: string[];
				cpes?: string[];
				vulns?: string[];
				tags?: string[];
			};
			res.json({
				ok: true,
				ip: j.ip ?? host,
				ports: j.ports ?? [],
				hostnames: (j.hostnames ?? []).slice(0, 10),
				cpes: (j.cpes ?? []).slice(0, 10),
				vulns: (j.vulns ?? []).slice(0, 20),
				tags: j.tags ?? [],
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `ports lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Robtex free IP query (keyless): reverse-IP hosts on shared infra +
	// ASN/route/whois context. Highest-density recon graph of the hunt.
	app.get("/api/osint/robtex", async (req, res) => {
		const host = String(req.query.host ?? "")
			.trim()
			.slice(0, 253);
		if (!/^[a-zA-Z0-9.:-]+$/.test(host) || !host) {
			res
				.status(400)
				.json({ ok: false, error: "host required (hostname, IPv4/IPv6)" });
			return;
		}
		try {
			const r = await fetch(
				`https://freeapi.robtex.com/ipquery/${encodeURIComponent(host)}`,
				{
					headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				status?: string;
				as?: number;
				asname?: string;
				whoisdesc?: string;
				bgproute?: string;
				city?: string;
				country?: string;
				pas?: { o?: string; t?: number }[];
			};
			res.json({
				ok: true,
				ip: host,
				asn: j.as ?? null,
				asname: j.asname ?? null,
				whois: j.whoisdesc ?? null,
				route: j.bgproute ?? null,
				geo: [j.city, j.country].filter(Boolean).join(", ") || null,
				hosts: (j.pas ?? []).slice(0, 30).map((p) => p.o),
				hostCount: (j.pas ?? []).length,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `robtex lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// FDIC bank search (keyless, US-gov): name/CERT → bank identity records.
	app.get("/api/osint/fdic", async (req, res) => {
		const q = String(req.query.q ?? req.query.query ?? "")
			.trim()
			.slice(0, 100);
		if (!q) {
			res.status(400).json({ ok: false, error: "q required (bank name)" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.fdic.gov/banks/financials?filters=NAME%3A${encodeURIComponent(q.toUpperCase())}&fields=NAME%2CCERT%2CACTIVE&limit=10&format=json`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				meta?: { total?: number };
				data?: { data?: { CERT?: number; NAME?: string; ACTIVE?: number } }[];
			};
			res.json({
				ok: true,
				total: j.meta?.total ?? 0,
				banks: (j.data ?? []).slice(0, 10).map((x) => x.data),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `fdic lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Cloudflare DoH third opinion (dns.google + CF doh exist): same shape.
	app.get("/api/osint/doh-cf", async (req, res) => {
		const name = String(req.query.name ?? "")
			.trim()
			.toLowerCase()
			.slice(0, 253);
		const type = String(req.query.type ?? "A")
			.toUpperCase()
			.slice(0, 10);
		if (!/^(?!-)[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) {
			res.status(400).json({ ok: false, error: "name required (domain)" });
			return;
		}
		try {
			const r = await fetch(
				`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
				{
					headers: { accept: "application/dns-json" },
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				Status?: number;
				Answer?: {
					name?: string;
					type?: number;
					TTL?: number;
					data?: string;
				}[];
			};
			res.json({
				ok: true,
				name,
				type,
				status: j.Status,
				answers: (j.Answer ?? []).slice(0, 20),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `doh-cf lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// DexScreener token (keyless): DEX pairs for a token mint/address.
	app.get("/api/osint/token", async (req, res) => {
		const addr = String(req.query.addr ?? req.query.address ?? "")
			.trim()
			.slice(0, 100);
		if (!/^0x[a-fA-F0-9]{20,}$/.test(addr) && addr.length < 32) {
			res
				.status(400)
				.json({ ok: false, error: "addr required (token address)" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(addr)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				pairs?: {
					chainId?: string;
					dexId?: string;
					baseToken?: { symbol?: string; name?: string };
					priceUsd?: string;
					liquidity?: { usd?: number };
				}[];
			};
			res.json({
				ok: true,
				pairs: (j.pairs ?? []).slice(0, 10).map((p) => ({
					chain: p.chainId,
					dex: p.dexId,
					symbol: p.baseToken?.symbol,
					name: p.baseToken?.name,
					priceUsd: p.priceUsd,
					liquidityUsd: p.liquidity?.usd ?? null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `token lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// GitHub Security Advisories (keyless): GHSA→CVE mapping with severity —
	// the `ghsa` collector's on-demand twin for a single advisory or CVE.
	app.get("/api/osint/ghsa", async (req, res) => {
		const q = String(req.query.q ?? req.query.id ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 40);
		if (q.length < 4) {
			res.status(400).json({ ok: false, error: "q required (GHSA-id or CVE)" });
			return;
		}
		try {
			const url = /^GHSA-[A-Z0-9-]+$/.test(q)
				? `https://api.github.com/advisories/${encodeURIComponent(q)}`
				: `https://api.github.com/advisories?cve_id=${encodeURIComponent(q)}&per_page=5`;
			const r = await fetch(url, {
				headers: {
					"User-Agent": "Thoth/0.1 (+https://github.com/thoth)",
					Accept: "application/vnd.github+json",
				},
				signal: AbortSignal.timeout(15000),
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as
				| {
						ghsa_id?: string;
						cve_id?: string | null;
						summary?: string;
						severity?: string;
						published_at?: string;
				  }
				| {
						ghsa_id?: string;
						cve_id?: string | null;
						summary?: string;
						severity?: string;
						published_at?: string;
				  }[];
			const items = (Array.isArray(j) ? j : [j]).slice(0, 5).map((a) => ({
				ghsa: a.ghsa_id,
				cve: a.cve_id,
				severity: a.severity,
				published: String(a.published_at ?? "").slice(0, 10),
				summary: String(a.summary ?? "").slice(0, 300),
			}));
			res.json({ ok: true, q, items });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `ghsa lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// ROR research-org identity (keyless): grid/wikidata links, location —
	// the company command's research-world twin.
	app.get("/api/osint/ror", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 200);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.ror.org/organizations?query=${encodeURIComponent(q)}`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				items?: {
					id?: string;
					name?: string;
					established?: number;
					links?: { type?: string; value?: string }[];
					locations?: {
						geonames_details?: {
							country_name?: string;
							lat?: number;
							lng?: number;
						};
					}[];
					external_ids?: {
						type?: string;
						preferred?: string;
						all?: string[];
					}[];
				}[];
			};
			const items = (j.items ?? []).slice(0, 5).map((o) => ({
				ror: o.id,
				name: o.name,
				established: o.established ?? null,
				country: o.locations?.[0]?.geonames_details?.country_name ?? null,
				wikidata:
					o.external_ids?.find((x) => x.type === "wikidata")?.preferred ?? null,
				website: o.links?.find((x) => x.type === "website")?.value ?? null,
			}));
			res.json({ ok: true, q, items });
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `ror lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// GitHub code-ownership recon (unauthenticated 60/hr + 10 search/min):
	// who owns a repo, stars, language — company tech-footprint context.
	app.get("/api/osint/github", async (req, res) => {
		const q = String(req.query.q ?? "")
			.trim()
			.slice(0, 200);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "q required" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5`,
				{
					headers: {
						"User-Agent": "Thoth/0.1 (+https://github.com/thoth)",
						Accept: "application/vnd.github+json",
					},
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				total_count?: number;
				items?: {
					full_name?: string;
					description?: string | null;
					stargazers_count?: number;
					language?: string | null;
					html_url?: string;
				}[];
			};
			res.json({
				ok: true,
				q,
				total: j.total_count ?? 0,
				items: (j.items ?? []).map((x) => ({
					repo: x.full_name,
					stars: x.stargazers_count,
					language: x.language,
					url: x.html_url,
					about: String(x.description ?? "").slice(0, 200),
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `github lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Swiss transit departures (keyless opendata.ch): stationboard for a
	// station name — live European rail pulse.
	app.get("/api/osint/transit", async (req, res) => {
		const q = String(req.query.q ?? req.query.station ?? "")
			.trim()
			.slice(0, 80);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "q required (station name)" });
			return;
		}
		try {
			const r = await fetch(
				`https://transport.opendata.ch/v1/stationboard?station=${encodeURIComponent(q)}&limit=8`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				station?: { name?: string };
				stationboard?: {
					name?: string;
					to?: string;
					stop?: { departure?: string; delay?: number };
				}[];
			};
			res.json({
				ok: true,
				station: j.station?.name ?? q,
				departures: (j.stationboard ?? []).slice(0, 8).map((d) => ({
					line: d.name,
					to: d.to,
					departure: d.stop?.departure ?? null,
					delayMin: d.stop?.delay ?? 0,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `transit lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Name demographics (keyless agify/genderize/nationalize): name → age,
	// gender, nationality probabilities. Identity-desk enrichment.
	app.get("/api/osint/name", async (req, res) => {
		const q = String(req.query.q ?? req.query.name ?? "")
			.trim()
			.slice(0, 60);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "q required (name)" });
			return;
		}
		try {
			const [ag, ge, na] = await Promise.all(
				[
					`https://api.agify.io?name=${encodeURIComponent(q)}`,
					`https://api.genderize.io?name=${encodeURIComponent(q)}`,
					`https://api.nationalize.io?name=${encodeURIComponent(q)}`,
				].map(async (u) => {
					const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
					if (!r.ok) throw new Error(`HTTP ${r.status}`);
					return (await r.json()) as Record<string, unknown>;
				}),
			);
			res.json({
				ok: true,
				name: q,
				age: (ag as { age?: number }).age ?? null,
				ageCount: (ag as { count?: number }).count ?? 0,
				gender: (ge as { gender?: string }).gender ?? null,
				genderProb: (ge as { probability?: number }).probability ?? null,
				nationalities: (
					(na as { country?: { country_id?: string; probability?: number }[] })
						.country ?? []
				)
					.slice(0, 3)
					.map((c) => ({ cc: c.country_id, p: c.probability })),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `name lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// PlaneSpotters photos by hex/reg (keyless, needs contact UA):
	// aircraft-eye view for the dossier. Empty photos[] = honest-empty.
	app.get("/api/osint/planespotter", async (req, res) => {
		const hex = String(req.query.hex ?? req.query.reg ?? req.query.q ?? "")
			.trim()
			.toUpperCase()
			.slice(0, 20);
		if (!/^[A-Z0-9-]{2,20}$/.test(hex)) {
			res.status(400).json({ ok: false, error: "hex required (e.g. 4840D6)" });
			return;
		}
		try {
			const kind = /^[0-9A-F]{6}$/.test(hex) ? "hex" : "reg";
			const r = await fetch(
				`https://api.planespotters.net/pub/photos/${kind}/${encodeURIComponent(hex)}`,
				{
					headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
					signal: AbortSignal.timeout(15000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				photos?: {
					thumbnail?: string;
					photographer?: string;
					registration?: string;
					aircraft?: string;
				}[];
			};
			res.json({
				ok: true,
				hex,
				count: (j.photos ?? []).length,
				photos: (j.photos ?? []).slice(0, 5).map((p) => ({
					thumb: p.thumbnail ?? null,
					by: p.photographer ?? null,
					reg: p.registration ?? null,
					type: p.aircraft ?? null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `planespotter lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Research funder search (keyless OpenAlex): funder → works count.
	app.get("/api/osint/funder", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.openalex.org/funders?search=${encodeURIComponent(q)}&per-page=5`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				results?: {
					id?: string;
					display_name?: string;
					works_count?: number;
					description?: string | null;
				}[];
			};
			res.json({
				ok: true,
				items: (j.results ?? []).slice(0, 5).map((f) => ({
					id: f.id,
					name: f.display_name,
					works: f.works_count ?? 0,
					desc: (f.description ?? "").slice(0, 200),
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `funder lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Crossref funder lookup (keyless): funder registry id + location —
	// the grant-id leg next to the OpenAlex funder route above.
	app.get("/api/osint/crfunder", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.crossref.org/funders?query=${encodeURIComponent(q)}&rows=5`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				message?: {
					items?: { id?: string; name?: string; location?: string }[];
				};
			};
			res.json({
				ok: true,
				items: (j.message?.items ?? []).slice(0, 5).map((f) => ({
					id: f.id,
					name: f.name,
					location: f.location ?? null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `crfunder lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// OFF product search (keyless): food products by keyword with
	// nutriscore + nova — the on-demand leg next to the Nutella heartbeat.
	app.get("/api/osint/food", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required (food)" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.openfoodfacts.org/api/v2/search?query=${encodeURIComponent(q)}&page_size=5`,
				{ signal: AbortSignal.timeout(20000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				products?: {
					code?: string;
					product_name?: string;
					brands?: string;
					nutriscore_grade?: string;
					nova_group?: number;
				}[];
			};
			res.json({
				ok: true,
				items: (j.products ?? []).slice(0, 5).map((x) => ({
					code: x.code,
					name: x.product_name,
					brands: x.brands ?? null,
					nutriscore: x.nutriscore_grade ?? null,
					nova: x.nova_group ?? null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `food lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// MusicBrainz release search (keyless): releases by title with MBID —
	// the on-demand leg next to the Nevermind heartbeat.
	app.get("/api/osint/music", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required (release)" });
			return;
		}
		try {
			const r = await fetch(
				`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(`release:${q}`)}&fmt=json&limit=5`,
				{
					headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
					signal: AbortSignal.timeout(20000),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				count?: number;
				releases?: {
					id?: string;
					title?: string;
					date?: string;
					status?: string;
				}[];
			};
			res.json({
				ok: true,
				count: j.count ?? null,
				items: (j.releases ?? []).slice(0, 5).map((x) => ({
					id: x.id,
					title: x.title,
					date: x.date ?? null,
					url: x.id ? `https://musicbrainz.org/release/${x.id}` : null,
				})),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `music lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Maltiverse IOC search (keyless): malware-family IOCs with
	// classification + blacklist hits — the threat-intel search leg next to
	// the hostname/ip reputation routes.
	app.get("/api/osint/maltsearch", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res
				.status(400)
				.json({ ok: false, error: "query required (malware/IOC)" });
			return;
		}
		try {
			const r = await fetch(
				`https://api.maltiverse.com/search?query=${encodeURIComponent(q)}&limit=5`,
				{ signal: AbortSignal.timeout(20000) },
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				hits?: {
					hits?: { _source?: Record<string, unknown> }[];
				};
			};
			res.json({
				ok: true,
				items: (j.hits?.hits ?? []).slice(0, 5).map((h) => {
					const x = h._source ?? {};
					const bl = x.blacklist as { description?: string }[] | undefined;
					return {
						classification: x.classification ?? null,
						hostname: x.hostname ?? null,
						filename: x.filename ?? null,
						filetype: x.filetype ?? null,
						hits: Array.isArray(bl) ? bl.length : 0,
						first: Array.isArray(bl) ? (bl[0]?.description ?? null) : null,
					};
				}),
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `maltsearch lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Museum search (keyless trio): AIC Chicago + the Met + Europeana.
	app.get("/api/osint/museum", async (req, res) => {
		const q = String(req.query.query ?? req.query.q ?? "")
			.trim()
			.slice(0, 120);
		if (q.length < 2) {
			res.status(400).json({ ok: false, error: "query required" });
			return;
		}
		try {
			const [aic, met] = await Promise.all([
				fetch(
					`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&limit=5&fields=id,title,artist_title,date_display`,
					{ signal: AbortSignal.timeout(15000) },
				).then(async (r) => {
					if (!r.ok) throw new Error(`AIC ${r.status}`);
					return (await r.json()) as {
						data?: {
							id?: number;
							title?: string;
							artist_title?: string;
							date_display?: string;
						}[];
					};
				}),
				fetch(
					`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(q)}`,
					{ signal: AbortSignal.timeout(15000) },
				).then(async (r) => {
					if (!r.ok) throw new Error(`Met ${r.status}`);
					return (await r.json()) as { total?: number; objectIDs?: number[] };
				}),
			]);
			res.json({
				ok: true,
				aic: (aic.data ?? []).slice(0, 5).map((a) => ({
					title: a.title,
					artist: a.artist_title,
					date: a.date_display,
					url: a.id ? `https://www.artic.edu/artworks/${a.id}` : null,
				})),
				met: {
					total: met.total ?? 0,
					sample: (met.objectIDs ?? []).slice(0, 5).map((id) => ({
						id,
						url: `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
					})),
				},
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `museum lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});

	// Drone airspace context (FAA UAS Facility Map, keyless ArcGIS): LAANC
	// grids intersecting a bbox — 0ft grids are the no-fly tells around
	// airports, bases, and city centers. Dossier-grade, on demand.
	app.get("/api/osint/airspace", async (req, res) => {
		const parts = String(req.query.bbox ?? "")
			.split(",")
			.map(Number);
		if (
			parts.length !== 4 ||
			parts.some((x) => !Number.isFinite(x)) ||
			parts[0] >= parts[2] ||
			parts[1] >= parts[3]
		) {
			res.status(400).json({
				ok: false,
				error: "bbox required (minLon,minLat,maxLon,maxLat)",
			});
			return;
		}
		try {
			const [x0, y0, x1, y1] = parts;
			const url =
				"https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/" +
				`FAA_UAS_FacilityMap_Data_Primary/FeatureServer/0/query?where=1%3D1&geometry=${x0}%2C${y0}%2C${x1}%2C${y1}` +
				`&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
				`&outFields=APT1_NAME%2CAPT1_LAANC&returnGeometry=false&f=json&resultRecordCount=50`;
			const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as {
				features?: { attributes?: Record<string, unknown> }[];
			};
			const grids = (j.features ?? []).map((f) => ({
				airport: f.attributes?.APT1_NAME ?? null,
				maxFt: f.attributes?.APT1_LAANC ?? null,
			}));
			const alts = grids
				.map((g) => Number(g.maxFt))
				.filter((x) => Number.isFinite(x));
			res.json({
				ok: true,
				grids: grids.slice(0, 50),
				total: grids.length,
				minFt: alts.length ? Math.min(...alts) : null,
			});
		} catch (e: unknown) {
			res.status(502).json({
				ok: false,
				error: `airspace lookup unavailable: ${String(e).slice(0, 120)}`,
			});
		}
	});
}

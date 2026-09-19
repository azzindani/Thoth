import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// Free cyber-threat layer, fully keyless:
// - urlhaus text_recent: latest malicious URLs (abuse.ch, no key)
// - CISA KEV catalog: known exploited vulnerabilities (no key)
// - SANS ISC infocon: internet-wide threat level (green/yellow/orange/red)
// - security press RSS: THN/Krebs/Bleeping/Schneier/Threatpost via parseRSS
import { parseRSS } from "./news.js";

const URLHAUS_URL = "https://urlhaus.abuse.ch/downloads/text_recent/";
const KEV_URL =
	"https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const INFOCON_URL = "https://isc.sans.edu/api/infocon?json";

export function infoconSeverity(
	status?: string,
): "critical" | "watch" | "info" {
	const s = (status ?? "").toLowerCase();
	if (s === "red" || s === "orange") return "critical";
	if (s === "yellow") return "watch";
	return "info";
}

export function parseUrlhaus(text: string, cap = 50): string[] {
	const out: string[] = [];
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		if (!/^https?:\/\//.test(t)) continue;
		out.push(t);
		if (out.length >= cap) break;
	}
	return out;
}

const KevItem = z.object({
	cveID: z.string().optional(),
	vendorProject: z.string().optional(),
	product: z.string().optional(),
	vulnerabilityName: z.string().optional(),
	dateAdded: z.string().optional(),
	dueDate: z.string().optional(),
	knownRansomwareCampaignUse: z.string().optional(),
});

export function kevSeverity(dateAdded?: string): "critical" | "watch" {
	// Added in last 30d → critical, else watch
	const t = Date.parse(dateAdded ?? "");
	if (!Number.isNaN(t) && Date.now() - t < 30 * 864e5) return "critical";
	return "watch";
}

export async function collect() {
	const layer = "cyber";
	let n = 0;
	const errors: string[] = [];

	try {
		assertSafeUrl(URLHAUS_URL);
		const res = await stealthFetch(URLHAUS_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const urls = parseUrlhaus(await res.text());
		await storeRaw("urlhaus", layer, res.status, { n: urls.length });
		for (const u of urls) {
			let host = "";
			try {
				host = new URL(u).hostname;
			} catch {
				host = u.slice(0, 60);
			}
			await storeNormalized({
				id: `urlhaus:${createHash("md5").update(u).digest("hex")}`,
				ts: new Date().toISOString(),
				source: "urlhaus",
				layer,
				title: `malicious URL — ${host}`,
				body: u.slice(0, 300),
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: { host },
			});
			n++;
		}
		await markHealth("urlhaus", true);
	} catch (e: unknown) {
		errors.push(`urlhaus: ${errMsg(e)}`);
		await markHealth("urlhaus", false, errors[errors.length - 1]);
	}

	try {
		assertSafeUrl(KEV_URL);
		const res = await stealthFetch(KEV_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { vulnerabilities?: unknown };
		const vulns = z.array(KevItem).parse(json.vulnerabilities ?? []);
		await storeRaw("cisa-kev", layer, res.status, { n: vulns.length });
		// Most recent first: sort by dateAdded desc, take 30
		vulns.sort(
			(a, b) => Date.parse(b.dateAdded ?? "") - Date.parse(a.dateAdded ?? ""),
		);
		for (const v of vulns.slice(0, 30)) {
			if (!v.cveID) continue;
			const ts = Date.parse(v.dateAdded ?? "");
			await storeNormalized({
				id: `kev:${v.cveID}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "cisa-kev",
				layer,
				title: `${v.cveID} — ${v.vulnerabilityName ?? v.product ?? "exploited in the wild"}`,
				body: `${v.vendorProject ?? ""} ${v.product ?? ""}`
					.trim()
					.slice(0, 300),
				url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${encodeURIComponent(v.cveID)}`,
				severity: kevSeverity(v.dateAdded),
				confidence: 0.95,
				entities: {},
				meta: {
					cve: v.cveID,
					vendor: v.vendorProject,
					dueDate: v.dueDate,
					ransomware: v.knownRansomwareCampaignUse,
				},
			});
			n++;
		}
		await markHealth("cisa-kev", true);
	} catch (e: unknown) {
		errors.push(`cisa-kev: ${errMsg(e)}`);
		await markHealth("cisa-kev", false, errors[errors.length - 1]);
	}

	try {
		assertSafeUrl(INFOCON_URL);
		const res = await stealthFetch(INFOCON_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as { status?: string };
		const status = String(j.status ?? "green").toLowerCase();
		await storeRaw("sans-isc", layer, res.status, { status });
		const day = new Date().toISOString().slice(0, 10);
		await storeNormalized({
			id: `sans:infocon:${day}`,
			ts: new Date().toISOString(),
			source: "sans-isc",
			layer,
			title: `SANS Infocon ${status}`,
			severity: infoconSeverity(status),
			confidence: 0.95,
			entities: {},
			meta: { status },
		});
		await markHealth("sans-isc", true);
		n++;
	} catch (e: unknown) {
		// Best-effort third upstream: batch2 stubs urlhaus+KEV only (500
		// default) and asserts their count — a SANS outage must not move it.
		errors.push(`sans-isc: ${errMsg(e)}`);
		await markHealth("sans-isc", false, errors[errors.length - 1]);
	}

	try {
		assertSafeUrl("https://api.github.com/advisories?per_page=10");
		const res = await stealthFetch(
			"https://api.github.com/advisories?per_page=10",
			{ headers: { Accept: "application/vnd.github+json" } },
		);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const items = (await res.json()) as {
			ghsa_id?: string;
			cve_id?: string | null;
			summary?: string;
			severity?: string;
			published_at?: string;
		}[];
		await storeRaw("ghsa", layer, res.status, { n: items.length });
		for (const a of items) {
			if (!a.ghsa_id) continue;
			const ts = Date.parse(a.published_at ?? "");
			await storeNormalized({
				id: `ghsa:${a.ghsa_id}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "ghsa",
				layer,
				title: `${a.cve_id ?? a.ghsa_id} — ${(a.summary ?? "").slice(0, 200)}`,
				url: `https://github.com/advisories/${a.ghsa_id}`,
				severity:
					(a.severity ?? "").toLowerCase() === "critical"
						? "critical"
						: "watch",
				confidence: 0.85,
				entities: {},
				meta: { ghsa: a.ghsa_id, cve: a.cve_id, severity: a.severity },
			});
			n++;
		}
		await markHealth("ghsa", true);
	} catch (e: unknown) {
		errors.push(`ghsa: ${errMsg(e)}`);
		await markHealth("ghsa", false, errors[errors.length - 1]);
	}

	// Security press RSS (keyless): HackerNews-Feedburner + Krebs +
	// BleepingComputer + Schneier + Threatpost. Same parseRSS as news.
	const SECRSS: { source: string; url: string }[] = [
		{ source: "thn", url: "https://feeds.feedburner.com/TheHackersNews" },
		{ source: "krebs", url: "https://krebsonsecurity.com/feed/" },
		{ source: "bleep", url: "https://www.bleepingcomputer.com/feed/" },
		{ source: "schneier", url: "https://www.schneier.com/feed/atom/" },
		{ source: "threatpost", url: "https://threatpost.com/feed/" },
	];
	for (const f of SECRSS) {
		try {
			assertSafeUrl(f.url);
			const res = await stealthFetch(f.url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const items = parseRSS(await res.text(), 8);
			await storeRaw(f.source, layer, res.status, { n: items.length });
			for (const a of items) {
				const ts = Date.parse(a.pubDate);
				await storeNormalized({
					id: `${f.source}:${createHash("md5").update(a.link).digest("hex")}`,
					ts: Number.isNaN(ts)
						? new Date().toISOString()
						: new Date(ts).toISOString(),
					source: f.source,
					layer,
					title: a.title.slice(0, 300),
					url: a.link,
					severity:
						/0-day|zero-day|ransomware|breach|exploit.*wild|critical/i.test(
							a.title,
						)
							? "watch"
							: "info",
					confidence: 0.8,
					entities: {},
					meta: {},
				});
				n++;
			}
			await markHealth(f.source, true);
		} catch (e: unknown) {
			errors.push(`${f.source}: ${errMsg(e)}`);
			await markHealth(f.source, false, errors[errors.length - 1]);
		}
	}

	// OpenPhish public feed (keyless, GitHub mirror): live phishing URLs —
	// the phishing leg next to urlhaus malware URLs.
	try {
		const url = "https://openphish.com/feed.txt";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const urls = parseUrlhaus(await res.text(), 40);
		await storeRaw("openphish", layer, res.status, { n: urls.length });
		for (const u of urls) {
			let host = "";
			try {
				host = new URL(u).hostname;
			} catch {
				host = u.slice(0, 60);
			}
			await storeNormalized({
				id: `openphish:${createHash("md5").update(u).digest("hex")}`,
				ts: new Date().toISOString(),
				source: "openphish",
				layer,
				title: `phishing URL — ${host}`,
				body: u.slice(0, 300),
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: { host },
			});
			n++;
		}
		await markHealth("openphish", true);
	} catch (e: unknown) {
		errors.push(`openphish: ${errMsg(e)}`);
		await markHealth("openphish", false, errors[errors.length - 1]);
	}

	// Spamhaus DROP (keyless text, ~hourly refresh): hijacked/malicious
	// netblocks — the network-layer blocklist leg next to urlhaus URLs.
	try {
		const url = "https://www.spamhaus.org/drop/drop.txt";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const nets: { cidr: string; ref: string }[] = [];
		for (const line of (await res.text()).split("\n")) {
			const t = line.trim();
			if (!t || t.startsWith(";")) continue;
			const m = t.match(/^([\d./]+)\s*;\s*(\S+)/);
			if (!m?.[1] || !m[2]) continue;
			nets.push({ cidr: m[1], ref: m[2] });
			if (nets.length >= 60) break;
		}
		await storeRaw("spamdrop", layer, res.status, { n: nets.length });
		for (const x of nets) {
			await storeNormalized({
				id: `spamdrop:${x.cidr.replace(/[^0-9./]+/g, "-")}`,
				ts: new Date().toISOString(),
				source: "spamdrop",
				layer,
				title: `DROP-listed netblock ${x.cidr} (${x.ref})`,
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: { cidr: x.cidr, ref: x.ref },
			});
			n++;
		}
		await markHealth("spamdrop", true);
	} catch (e: unknown) {
		errors.push(`spamdrop: ${errMsg(e)}`);
		await markHealth("spamdrop", false, errors[errors.length - 1]);
	}

	// Feodo C2 IP blocklist (abuse.ch, keyless quoted-CSV): botnet C2
	// infrastructure leg — IPs, not URLs or netblocks. (SSLBL's CSV was
	// deprecated 2025-01-03 and carries zero data rows — not shipped.)
	try {
		const url = "https://feodotracker.abuse.ch/downloads/ipblocklist.csv";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows: { ip: string; port: string; malware: string }[] = [];
		for (const line of (await res.text()).split("\n")) {
			const t = line.trim();
			if (!t || t.startsWith("#")) continue;
			const cells = [...t.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
			const ip = cells[1] ?? "";
			if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue;
			rows.push({ ip, port: cells[2] ?? "", malware: cells[5] ?? "" });
			if (rows.length >= 25) break;
		}
		await storeRaw("feodo", layer, res.status, { n: rows.length });
		for (const r of rows) {
			await storeNormalized({
				id: `feodo:${r.ip.replace(/\./g, "-")}`,
				ts: new Date().toISOString(),
				source: "feodo",
				layer,
				title: `Feodo botnet C2 ${r.ip}${r.port ? `:${r.port}` : ""}${r.malware ? ` (${r.malware})` : ""}`,
				severity: "watch",
				confidence: 0.9,
				entities: {},
				meta: { ip: r.ip, port: r.port || null, malware: r.malware || null },
			});
			n++;
		}
		await markHealth("feodo", true);
	} catch (e: unknown) {
		errors.push(`feodo: ${errMsg(e)}`);
		await markHealth("feodo", false, errors[errors.length - 1]);
	}

	// DShield recommended block list (SANS, keyless TSV): top attacking
	// /24s — startIP endIP prefix attacks owner country contact.
	try {
		const url = "https://feeds.dshield.org/block.txt";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows: { net: string; attacks: number; owner: string }[] = [];
		for (const line of (await res.text()).split("\n")) {
			const t = line.trim();
			if (!t || t.startsWith("#")) continue;
			const cells = t.split(/\t+/);
			const m = cells[0]?.match(/^(\d{1,3}(\.\d{1,3}){3})$/);
			const prefix = Number(cells[2] ?? NaN);
			const attacks = Number(cells[3] ?? NaN);
			if (!m?.[1] || prefix !== 24 || !Number.isFinite(attacks)) continue;
			rows.push({ net: `${m[1]}/24`, attacks, owner: cells[4] ?? "" });
			if (rows.length >= 20) break;
		}
		await storeRaw("dshield", layer, res.status, { n: rows.length });
		for (const r of rows) {
			await storeNormalized({
				id: `dshield:${r.net.replace(/[^0-9./]+/g, "-")}`,
				ts: new Date().toISOString(),
				source: "dshield",
				layer,
				title: `DShield block ${r.net} (${r.attacks} reports${r.owner && r.owner !== "-" ? `, ${r.owner.slice(0, 40)}` : ""})`,
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: { net: r.net, attacks: r.attacks, owner: r.owner || null },
			});
			n++;
		}
		await markHealth("dshield", true);
	} catch (e: unknown) {
		errors.push(`dshield: ${errMsg(e)}`);
		await markHealth("dshield", false, errors[errors.length - 1]);
	}

	// ThreatFox recent IOCs (abuse.ch, keyless 5.5MB JSON): botnet C2 /
	// webshell domains + URLs with malware family + confidence — the IOC
	// intel leg next to feodo IPs and urlhaus URLs.
	try {
		const url = "https://threatfox.abuse.ch/export/json/recent/";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as Record<
			string,
			{
				ioc_value?: string;
				ioc_type?: string;
				threat_type?: string;
				malware_printable?: string;
				confidence_level?: number;
				first_seen_utc?: string;
			}[]
		>;
		const rows: {
			ioc: string;
			type: string;
			threat: string;
			malware: string;
			conf: number;
		}[] = [];
		for (const v of Object.values(j)) {
			const r = v[0];
			if (!r?.ioc_value) continue;
			if (r.confidence_level !== undefined && r.confidence_level < 50)
				continue;
			rows.push({
				ioc: r.ioc_value,
				type: r.ioc_type ?? "?",
				threat: r.threat_type ?? "?",
				malware: r.malware_printable ?? "?",
				conf: r.confidence_level ?? 0,
			});
			if (rows.length >= 25) break;
		}
		await storeRaw("threatfox", layer, res.status, { n: rows.length });
		for (const r of rows) {
			await storeNormalized({
				id: `threatfox:${createHash("md5").update(r.ioc).digest("hex").slice(0, 16)}`,
				ts: new Date().toISOString(),
				source: "threatfox",
				layer,
				title: `${r.malware} ${r.type} ${r.ioc.slice(0, 80)} (${r.threat}, conf ${r.conf})`,
				severity: r.conf >= 75 ? "watch" : "info",
				confidence: 0.85,
				entities: {},
				meta: { ioc: r.ioc.slice(0, 200), type: r.type, malware: r.malware },
			});
			n++;
		}
		await markHealth("threatfox", true);
	} catch (e: unknown) {
		errors.push(`threatfox: ${errMsg(e)}`);
		await markHealth("threatfox", false, errors[errors.length - 1]);
	}

	// MalwareBazaar recent samples (abuse.ch, keyless CSV): fresh malware
	// hashes with family + filetype — the sample-hash leg.
	try {
		const url = "https://bazaar.abuse.ch/export/csv/recent/";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows: { hash: string; family: string; ftype: string }[] = [];
		for (const line of (await res.text()).split("\n")) {
			const t = line.trim();
			if (!t || t.startsWith("#")) continue;
			const cells = [...t.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
			const hash = cells[1] ?? "";
			if (!/^[0-9a-f]{32,64}$/i.test(hash)) continue;
			rows.push({ hash, family: cells[9] ?? "?", ftype: cells[7] ?? "?" });
			if (rows.length >= 20) break;
		}
		await storeRaw("bazaar", layer, res.status, { n: rows.length });
		for (const r of rows) {
			await storeNormalized({
				id: `bazaar:${r.hash.slice(0, 32)}`,
				ts: new Date().toISOString(),
				source: "bazaar",
				layer,
				title: `${r.family} sample ${r.hash.slice(0, 16)}… (${r.ftype})`,
				severity: "info",
				confidence: 0.8,
				entities: {},
				meta: { hash: r.hash, family: r.family, filetype: r.ftype },
			});
			n++;
		}
		await markHealth("bazaar", true);
	} catch (e: unknown) {
		errors.push(`bazaar: ${errMsg(e)}`);
		await markHealth("bazaar", false, errors[errors.length - 1]);
	}

	// DShield top attackers (keyless TSV): worst scanning IPs with rDNS —
	// the attacker-IP leg next to DShield's /24 block list.
	try {
		const url = "https://feeds.dshield.org/top10-2.txt";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const cells = (await res.text()).split(/\s+/).filter(Boolean);
		const rows: { ip: string; host: string }[] = [];
		for (let i = 0; i + 1 < cells.length && rows.length < 10; i += 2) {
			const ip = cells[i] ?? "";
			if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue;
			rows.push({ ip, host: cells[i + 1] ?? "" });
		}
		await storeRaw("dshield-top", layer, res.status, { n: rows.length });
		for (const r of rows) {
			await storeNormalized({
				id: `dshieldtop:${r.ip.replace(/\./g, "-")}`,
				ts: new Date().toISOString(),
				source: "dshield-top",
				layer,
				title: `Top scanner ${r.ip}${r.host && r.host !== "." ? ` (${r.host.slice(0, 50)})` : ""}`,
				severity: "watch",
				confidence: 0.85,
				entities: {},
				meta: { ip: r.ip, rdns: r.host || null },
			});
			n++;
		}
		await markHealth("dshield-top", true);
	} catch (e: unknown) {
		errors.push(`dshield-top: ${errMsg(e)}`);
		await markHealth("dshield-top", false, errors[errors.length - 1]);
	}

	// CINS badguys (keyless pipe-list): army-listed malicious IPs —
	// the third-party-reputation leg next to abuse.ch + DShield.
	try {
		const url = "https://cinsscore.com/list/ci-badguys.txt";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const ips = (await res.text())
			.split(/[|,\s]+/)
			.map((t) => t.trim())
			.filter((t) => /^\d{1,3}(\.\d{1,3}){3}$/.test(t))
			.slice(0, 25);
		await storeRaw("cins", layer, res.status, { n: ips.length });
		for (const ip of ips) {
			await storeNormalized({
				id: `cins:${ip.replace(/\./g, "-")}`,
				ts: new Date().toISOString(),
				source: "cins",
				layer,
				title: `CINS-flagged hostile ${ip}`,
				severity: "watch",
				confidence: 0.75,
				entities: {},
				meta: { ip },
			});
			n++;
		}
		await markHealth("cins", true);
	} catch (e: unknown) {
		errors.push(`cins: ${errMsg(e)}`);
		await markHealth("cins", false, errors[errors.length - 1]);
	}

	// ransomware.live recent victims (keyless): claimed victims with
	// group + country + sector + attack date — the RaaS-impact leg.
	try {
		const url = "https://api.ransomware.live/v2/recentvictims";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			victim?: string;
			group?: string;
			group_name?: string;
			country?: string;
			activity?: string;
			attackdate?: string;
			description?: string;
		}[];
		await storeRaw("ransomware", layer, res.status, { n: rows.length });
		for (const v of rows.slice(0, 20)) {
			if (!v.victim) continue;
			await storeNormalized({
				id: `ransom:${v.victim.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 60)}:${(v.attackdate ?? "").slice(0, 10)}`,
				ts: v.attackdate
					? new Date(v.attackdate.replace(" ", "T")).toISOString()
					: new Date().toISOString(),
				source: "ransomware",
				layer,
				title:
					`${v.group_name ?? v.group ?? "?"} → ${v.victim} (${v.country ?? "?"}, ${v.activity ?? "?"})`.slice(
						0,
						280,
					),
				severity: "watch",
				confidence: 0.75,
				entities: { country: v.country ?? undefined },
				meta: {
					victim: v.victim,
					group: v.group_name ?? v.group ?? null,
					sector: v.activity ?? null,
				},
			});
			n++;
		}
		await markHealth("ransomware", true);
	} catch (e: unknown) {
		errors.push(`ransomware: ${errMsg(e)}`);
		await markHealth("ransomware", false, errors[errors.length - 1]);
	}

	// MSRC security updates (keyless OData): monthly Patch-Tuesday
	// releases — the vendor-patch leg next to CISA KEV.
	try {
		const url = "https://api.msrc.microsoft.com/cvrf/v3.0/Updates";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			value?: {
				ID?: string;
				DocumentTitle?: string;
				Severity?: string | null;
				CurrentReleaseDate?: string;
			}[];
		};
		const items = j.value ?? [];
		await storeRaw("msrc", layer, res.status, { n: items.length });
		for (const u of items.slice(-3)) {
			if (!u.ID) continue;
			await storeNormalized({
				id: `msrc:${u.ID}`,
				ts: u.CurrentReleaseDate ?? new Date().toISOString(),
				source: "msrc",
				layer,
				title: `${u.ID}: ${(u.DocumentTitle ?? "").slice(0, 180)}`,
				severity: "info",
				confidence: 0.9,
				entities: {},
				meta: { release: u.ID },
			});
			n++;
		}
		await markHealth("msrc", true);
	} catch (e: unknown) {
		errors.push(`msrc: ${errMsg(e)}`);
		await markHealth("msrc", false, errors[errors.length - 1]);
	}

	// blocklist.de all (keyless pipe-list, 26k attacker IPs): the
	// German-community reputation leg next to CINS + DShield.
	try {
		const url = "https://lists.blocklist.de/lists/all.txt";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {}, 30000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const ips = (await res.text())
			.split(/[|,\s]+/)
			.map((t) => t.trim())
			.filter((t) => /^\d{1,3}(\.\d{1,3}){3}$/.test(t))
			.slice(0, 25);
		await storeRaw("blocklistde", layer, res.status, { n: ips.length });
		for (const ip of ips) {
			await storeNormalized({
				id: `blocklistde:${ip.replace(/\./g, "-")}`,
				ts: new Date().toISOString(),
				source: "blocklistde",
				layer,
				title: `blocklist.de-flagged ${ip}`,
				severity: "info",
				confidence: 0.7,
				entities: {},
				meta: { ip },
			});
			n++;
		}
		await markHealth("blocklistde", true);
	} catch (e: unknown) {
		errors.push(`blocklistde: ${errMsg(e)}`);
		await markHealth("blocklistde", false, errors[errors.length - 1]);
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

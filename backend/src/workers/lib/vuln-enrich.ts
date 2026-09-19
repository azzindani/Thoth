// On-demand vuln enrichment (keyless, never polled): EPSS score, OSV record,
// CIRCL CVE record. Shared by routes-osint.ts so routes stay thin. All three
// fail honestly — callers translate to 502, never fabricate.
import { assertSafeUrl } from "./fetch.js";

const CVE_RE = /^CVE-\d{4}-\d{4,}$/;

export async function fetchEpss(id: string): Promise<{
	cve: string;
	epss: string | null;
	percentile: string | null;
	date: string | null;
}> {
	const cve = id.trim().toUpperCase();
	if (!CVE_RE.test(cve)) throw new Error("id=CVE-YYYY-NNNN required");
	const url = `https://api.first.org/data/v1/epss?cve=${cve}`;
	assertSafeUrl(url);
	const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	const j = (await r.json()) as {
		data?: {
			cve?: string;
			epss?: string;
			percentile?: string;
			date?: string;
		}[];
	};
	const d = j.data?.[0];
	if (!d) throw new Error("no EPSS record");
	return {
		cve: d.cve ?? cve,
		epss: d.epss ?? null,
		percentile: d.percentile ?? null,
		date: d.date ?? null,
	};
}

export async function fetchOsv(id: string): Promise<{
	id: string;
	summary: string;
	severity: string | null;
	published: string | null;
	affected: { package: string; versions: string }[];
	refs: string[];
}> {
	const cve = id.trim().toUpperCase();
	if (!CVE_RE.test(cve)) throw new Error("id=CVE-YYYY-NNNN required");
	const url = `https://api.osv.dev/v1/vulns/${cve}`;
	assertSafeUrl(url);
	const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	const j = (await r.json()) as {
		id?: string;
		summary?: string;
		details?: string;
		published?: string;
		severity?: { type?: string; score?: string }[];
		affected?: {
			package?: { name?: string; ecosystem?: string };
			ranges?: { events?: Record<string, string>[] }[];
		}[];
		references?: { url?: string }[];
	};
	const sev = j.severity?.[0];
	return {
		id: j.id ?? cve,
		summary: String(j.summary ?? j.details ?? "").slice(0, 400),
		severity: sev ? `${sev.type ?? ""} ${sev.score ?? ""}`.trim() : null,
		published: String(j.published ?? "").slice(0, 10) || null,
		affected: (j.affected ?? []).slice(0, 10).map((a) => ({
			package: `${a.package?.ecosystem ?? ""}:${a.package?.name ?? "?"}`,
			versions: (a.ranges ?? [])
				.flatMap((x) => x.events ?? [])
				.map((e) =>
					Object.entries(e)
						.map(([k, v]) => `${k} ${v}`)
						.join(", "),
				)
				.join("; ")
				.slice(0, 120),
		})),
		refs: (j.references ?? [])
			.slice(0, 10)
			.map((x) => x.url ?? "")
			.filter(Boolean),
	};
}

export async function fetchCircl(id: string): Promise<{
	id: string;
	title: string | null;
	state: string | null;
	published: string | null;
	summary: string;
}> {
	const cve = id.trim().toUpperCase();
	if (!CVE_RE.test(cve)) throw new Error("id=CVE-YYYY-NNNN required");
	const url = `https://cve.circl.lu/api/cve/${cve}`;
	assertSafeUrl(url);
	const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	const j = (await r.json()) as {
		cveMetadata?: { cveId?: string; state?: string; datePublished?: string };
		containers?: {
			cna?: { title?: string; descriptions?: { value?: string }[] };
		};
	};
	const cna = j.containers?.cna;
	return {
		id: j.cveMetadata?.cveId ?? cve,
		title: cna?.title ?? null,
		state: j.cveMetadata?.state ?? null,
		published: String(j.cveMetadata?.datePublished ?? "").slice(0, 10) || null,
		summary: String(cna?.descriptions?.[0]?.value ?? "").slice(0, 400),
	};
}

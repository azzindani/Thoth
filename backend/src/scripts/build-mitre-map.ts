import { writeFileSync } from "node:fs";

// One-time build: MITRE ATT&CK enterprise bundle → compact id/name/tactic map.
// Source: https://github.com/mitre/cti (CC BY-SA, attributed in DATA-ATTRIBUTION).
// Run: npx tsx src/scripts/build-mitre-map.ts
const BUNDLE_URL =
	"https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json";

const res = await fetch(BUNDLE_URL, { signal: AbortSignal.timeout(120000) });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const bundle = (await res.json()) as {
	objects?: {
		type?: string;
		id?: string;
		name?: string;
		revoked?: boolean;
		deprecated?: boolean;
		external_references?: { source_name?: string; external_id?: string }[];
		kill_chain_phases?: { phase_name?: string }[];
		description?: string;
	}[];
};

const out: { id: string; name: string; tactics: string[]; descr: string }[] =
	[];
for (const o of bundle.objects ?? []) {
	if (o.type !== "attack-pattern" || o.revoked || o.deprecated) continue;
	const ext = (o.external_references ?? []).find((r) =>
		r.external_id?.startsWith("T"),
	);
	if (!ext?.external_id || !o.name) continue;
	out.push({
		id: ext.external_id,
		name: o.name,
		tactics: [
			...new Set((o.kill_chain_phases ?? []).map((k) => k.phase_name ?? "")),
		].filter(Boolean),
		descr: (o.description ?? "").slice(0, 280),
	});
}
out.sort((a, b) => (a.id < b.id ? -1 : 1));
writeFileSync(
	new URL("../../static/mitre-techniques.json", import.meta.url).pathname,
	JSON.stringify({
		provenance: "mitre/cti enterprise-attack (CC BY-SA)",
		n: out.length,
		items: out,
	}),
);
console.log(`mitre techniques: ${out.length}`);

import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// IODA (Georgia Tech / CAIDA), keyless: macroscopic internet outages —
// country/region/ASN blackouts from BGP + active probing + telescope.
// Fills the cyber→physical gap: censorship, cable cuts, war blackouts.
// API: https://api.ioda.inetintel.cc.gatech.edu/v2 (no key, attribution).
const IODA_ALERTS =
	"https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts";

const Alert = z.object({
	datasource: z.string().optional(),
	time: z.number().optional(),
	level: z.string().optional(),
	condition: z.string().optional(),
	entity: z
		.object({
			code: z.string().optional(),
			name: z.string().optional(),
			type: z.string().optional(),
			attrs: z.record(z.string()).optional(),
		})
		.optional(),
});

export function iodaSeverity(level?: string): "critical" | "watch" | null {
	// Only non-normal levels become dots; normal baseline rows are skipped.
	if (!level || level === "normal") return null;
	if (/critical|severe|major/i.test(level)) return "critical";
	return "watch";
}

export async function collect() {
	const source = "ioda";
	const layer = "cyber";
	try {
		const until = Math.floor(Date.now() / 1000);
		const from = until - 24 * 3600;
		const url = `${IODA_ALERTS}?from=${from}&until=${until}&limit=100`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { data?: unknown };
		const alerts = z.array(Alert).parse(json.data ?? []);
		await storeRaw(source, layer, res.status, { n: alerts.length });
		let n = 0;
		for (const a of alerts.slice(0, 100)) {
			const sev = iodaSeverity(a.level);
			if (!sev) continue;
			const name = a.entity?.name ?? a.entity?.code ?? "unknown";
			const kind = a.entity?.type ?? "entity";
			const cc =
				a.entity?.attrs?.country_code ?? a.entity?.attrs?.country_name ?? "";
			const ts = typeof a.time === "number" ? a.time * 1000 : Date.now();
			await storeNormalized({
				id: `ioda:${a.datasource ?? "outage"}:${a.entity?.type ?? "?"}:${a.entity?.code ?? "?"}:${Math.floor(ts / 3600e3)}`,
				ts: new Date(ts).toISOString(),
				source,
				layer,
				title: `internet outage — ${name} (${kind}${cc ? ` · ${cc}` : ""})`,
				body: `${a.datasource ?? "ioda"} · level ${a.level ?? "?"} · condition ${a.condition ?? "?"}`,
				severity: sev,
				confidence: 0.85,
				entities: {},
				meta: {
					entityType: a.entity?.type,
					entityCode: a.entity?.code,
					datasource: a.datasource,
					level: a.level,
					condition: a.condition,
				},
			});
			n++;
			if (n >= 50) break;
		}
		await markHealth(source, true);
		return { ok: true, count: n };
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

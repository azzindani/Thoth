import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// OONI (Open Observatory of Network Interference), keyless: confirmed
// censorship measurements (blockpages, middleboxes, IM-app blocking).
// The application-layer complement to IODA's network-layer outages:
// IODA sees the pipe go dark, OONI sees the content get filtered.
// Modest rate per OONI docs (hourly poll, small pages).
const OONI_URL = "https://api.ooni.io/api/v1/measurements";

const Msmt = z.object({
	measurement_uid: z.string().optional(),
	input: z.string().nullable().optional(),
	probe_cc: z.string().optional(),
	probe_asn: z.union([z.string(), z.number()]).optional(),
	test_name: z.string().optional(),
	measurement_start_time: z.string().optional(),
	anomaly: z.boolean().optional(),
	confirmed: z.boolean().optional(),
});

export async function collect() {
	const source = "ooni";
	const layer = "cyber";
	try {
		const since = new Date(Date.now() - 24 * 3600e3).toISOString().slice(0, 10);
		const url = `${OONI_URL}?confirmed=true&since=${since}&limit=50`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { results?: unknown };
		const rows = z.array(Msmt).parse(json.results ?? []);
		await storeRaw(source, layer, res.status, { n: rows.length });
		let n = 0;
		for (const m of rows.slice(0, 30)) {
			const ts = Date.parse(m.measurement_start_time ?? "");
			const target = String(m.input ?? m.test_name ?? "unknown").slice(0, 160);
			await storeNormalized({
				id: `ooni:${m.measurement_uid ?? `${m.probe_cc}-${m.probe_asn}-${target}`.slice(0, 120)}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source,
				layer,
				title: `censorship confirmed — ${target} (${m.probe_cc ?? "?"})`,
				body: `${m.test_name ?? "ooni"} · AS${m.probe_asn ?? "?"}`,
				severity: "critical",
				confidence: 0.9,
				entities: {},
				meta: {
					cc: m.probe_cc,
					asn: String(m.probe_asn ?? ""),
					test: m.test_name,
				},
			});
			n++;
		}
		await markHealth(source, true);
		return { ok: true, count: n };
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

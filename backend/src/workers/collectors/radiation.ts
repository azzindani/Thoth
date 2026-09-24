import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// Safecast citizen radiation network, keyless. Rolling 7-day window so the layer
// reflects live sensors, not the 2020 backfill the unfiltered endpoint returns.
// NOTE 2026-09-15: the API now ignores order/captured_after (serves 2013 rows),
// so Safecast is a frozen-honest fallback; Ireland EPA carries the live pulse.
// EPA Ireland radmon open API (keyless, validated lab + monitor data):
// latest page = newest measurement_ids (auto-increment).
const EPA_COUNT_URL =
	"https://data.epa.ie/radmon/api/v1/measurements?page=1&per_page=1";
const EPA_PAGE_URL = (page: number) =>
	`https://data.epa.ie/radmon/api/v1/measurements?page=${page}&per_page=100`;
// The newest page is the deepest offset (~9.4M rows): it takes ~28 s to
// serve, and the API ignores every ordering parameter (2026-09-24), so the
// default 15 s fetch timeout aborted it on every run.
const EPA_PAGE_TIMEOUT_MS = 60_000;

const EPA = z.object({
	measurement_id: z.union([z.string(), z.number()]).optional(),
	value: z.union([z.string(), z.number()]).nullable().optional(),
	value_unit_code: z.string().nullable().optional(),
	nuclide_code: z.string().nullable().optional(),
	sample_type_description: z.string().nullable().optional(),
	latitude_dec: z.union([z.string(), z.number()]).nullable().optional(),
	longitude_dec: z.union([z.string(), z.number()]).nullable().optional(),
	end_meas: z.string().nullable().optional(),
	is_approved: z.boolean().nullable().optional(),
});

const M = z.object({
	id: z.union([z.string(), z.number()]).optional(),
	value: z.union([z.string(), z.number()]).nullable().optional(),
	unit: z.string().nullable().optional(),
	latitude: z.union([z.string(), z.number()]).nullable().optional(),
	longitude: z.union([z.string(), z.number()]).nullable().optional(),
	captured_at: z.string().nullable().optional(),
	location_name: z.string().nullable().optional(),
});

export async function collect() {
	const layer = "radiation";
	let n = 0;
	const errors: string[] = [];
	try {
		const url =
			"https://api.safecast.org/measurements.json?limit=100&order=captured_at+desc&captured_after=" +
			encodeURIComponent(
				new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10),
			);
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const items = z.array(M).parse(await res.json());
		await storeRaw("safecast", layer, res.status, { n: items.length });
		for (const m of items.slice(0, 150)) {
			const lat = Number(m.latitude);
			const lon = Number(m.longitude);
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
			const cpm = Number(m.value);
			const ts = Date.parse(m.captured_at ?? "");
			await storeNormalized({
				id: `safecast:${String(m.id)}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "safecast",
				layer,
				title: `${Number.isFinite(cpm) ? cpm : "?"} ${m.unit ?? "cpm"} — ${m.location_name ?? `${lat.toFixed(2)},${lon.toFixed(2)}`}`,
				severity: Number.isFinite(cpm) && cpm > 100 ? "watch" : "info",
				confidence: 0.8,
				lon,
				lat,
				entities: {},
				meta: { value: m.value, unit: m.unit },
			});
			n++;
		}
		await markHealth("safecast", true);
	} catch (e: unknown) {
		errors.push(`safecast: ${errMsg(e)}`);
		await markHealth("safecast", false, errors[errors.length - 1]);
	}
	try {
		assertSafeUrl(EPA_COUNT_URL);
		const cRes = await stealthFetch(EPA_COUNT_URL);
		if (!cRes.ok) throw new Error(`HTTP ${cRes.status}`);
		const cJson = (await cRes.json()) as { count?: number };
		const total = Number(cJson.count ?? 0);
		if (!Number.isFinite(total) || total < 1) throw new Error("no count");
		const lastPage = Math.max(1, Math.ceil(total / 100));
		const pRes = await stealthFetch(
			EPA_PAGE_URL(lastPage),
			{},
			EPA_PAGE_TIMEOUT_MS,
		);
		if (!pRes.ok) throw new Error(`HTTP ${pRes.status}`);
		const pJson = (await pRes.json()) as { list?: unknown };
		const rows = z.array(EPA).parse(pJson.list ?? []);
		await storeRaw("epa-ie", layer, pRes.status, { n: rows.length });
		for (const r of rows.slice(0, 100)) {
			const lat = Number(r.latitude_dec);
			const lon = Number(r.longitude_dec);
			const v = Number(r.value);
			const ts = Date.parse(r.end_meas ?? "");
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
			if (!Number.isFinite(v) || Number.isNaN(ts)) continue;
			await storeNormalized({
				id: `epaire:${String(r.measurement_id)}`,
				ts: new Date(ts).toISOString(),
				source: "epa-ie",
				layer,
				title:
					`${r.nuclide_code ?? "?"} ${v} ${r.value_unit_code ?? ""} — ${r.sample_type_description ?? "sample"}`.slice(
						0,
						300,
					),
				severity: "info",
				confidence: 0.85,
				lon,
				lat,
				entities: {},
				meta: {
					value: r.value,
					unit: r.value_unit_code,
					nuclide: r.nuclide_code,
					approved: r.is_approved,
				},
			});
			n++;
		}
		await markHealth("epa-ie", true);
	} catch (e: unknown) {
		errors.push(`epa-ie: ${errMsg(e)}`);
		await markHealth("epa-ie", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

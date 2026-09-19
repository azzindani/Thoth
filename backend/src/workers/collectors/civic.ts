// US civic 311/crime via Socrata (keyless, app_token-less reads):
// NYC 311 service requests (crm 311 dataset) + Chicago crimes (7d backfill)
// + Austin traffic incidents + LA crimes + SF 311 cases (data.sf.gov —
// sfgov.org 301-redirects there). Geo rows → `disasters` layer
// (street-level disruption/crime pulse); row caps keep polls small.
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const NycRow = z.object({
	unique_key: z.string().optional(),
	created_date: z.string().optional(),
	agency: z.string().nullable().optional(),
	complaint_type: z.string().nullable().optional(),
	descriptor: z.string().nullable().optional(),
	incident_address: z.string().nullable().optional(),
	city: z.string().nullable().optional(),
	status: z.string().nullable().optional(),
});

const ChiRow = z.object({
	id: z.string().optional(),
	date: z.string().optional(),
	primary_type: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	block: z.string().nullable().optional(),
	latitude: z.string().nullable().optional(),
	longitude: z.string().nullable().optional(),
	arrest: z.boolean().nullable().optional(),
});

const LaRow = z.object({
	dr_no: z.string().optional(),
	date_occ: z.string().optional(),
	crm_cd_desc: z.string().nullable().optional(),
	area_name: z.string().nullable().optional(),
	lat: z.string().nullable().optional(),
	lon: z.string().nullable().optional(),
	status_desc: z.string().nullable().optional(),
});

export async function collect() {
	const layer = "disasters";
	let n = 0;
	const errors: string[] = [];

	// NYC 311: newest 20 service requests (potholes, outages, noise...).
	try {
		const url =
			"https://data.cityofnewyork.us/resource/erm2-nwe9.json?$limit=20&$order=created_date%20DESC";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z.array(NycRow).parse(await res.json());
		await storeRaw("nyc311", layer, res.status, { n: rows.length });
		for (const r of rows) {
			if (!r.unique_key) continue;
			const ts = Date.parse(r.created_date ?? "");
			await storeNormalized({
				id: `nyc311:${r.unique_key}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "nyc311",
				layer,
				title:
					`NYC 311: ${r.complaint_type ?? "?"} — ${r.descriptor ?? ""} @ ${r.incident_address ?? r.city ?? "?"}`.slice(
						0,
						300,
					),
				severity: /outage|fire|gas|water|sewer|collapse/i.test(
					`${r.complaint_type} ${r.descriptor}`,
				)
					? "watch"
					: "info",
				confidence: 0.85,
				entities: {},
				meta: { agency: r.agency, status: r.status, city: r.city },
			});
			n++;
		}
		await markHealth("nyc311", true);
	} catch (e: unknown) {
		errors.push(`nyc311: ${errMsg(e)}`);
		await markHealth("nyc311", false, errors[errors.length - 1]);
	}

	// Chicago crimes: last 7d, cap 30.
	try {
		const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
		const url = `https://data.cityofchicago.org/resource/ijzp-q8t2.json?$limit=30&$order=date%20DESC&$where=date%20%3E%20%27${since}%27`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z.array(ChiRow).parse(await res.json());
		await storeRaw("chicrime", layer, res.status, { n: rows.length });
		for (const r of rows) {
			if (!r.id) continue;
			const ts = Date.parse(r.date ?? "");
			const lat = Number(r.latitude ?? NaN);
			const lon = Number(r.longitude ?? NaN);
			await storeNormalized({
				id: `chicrime:${r.id}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "chicrime",
				layer,
				title:
					`Chicago: ${r.primary_type ?? "?"} — ${r.description ?? ""} @ ${r.block ?? "?"}`.slice(
						0,
						300,
					),
				severity: /homicide|shooting|arson|robbery|assault/i.test(
					r.primary_type ?? "",
				)
					? "watch"
					: "info",
				confidence: 0.85,
				lon: Number.isFinite(lon) ? lon : undefined,
				lat: Number.isFinite(lat) ? lat : undefined,
				entities: {},
				meta: { type: r.primary_type, arrest: r.arrest },
			});
			n++;
		}
		await markHealth("chicrime", true);
	} catch (e: unknown) {
		errors.push(`chicrime: ${errMsg(e)}`);
		await markHealth("chicrime", false, errors[errors.length - 1]);
	}

	// LA crimes YTD sample: newest 20.
	try {
		const url =
			"https://data.lacity.org/resource/2nrs-mtv8.json?$limit=20&$order=date_occ%20DESC";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z.array(LaRow).parse(await res.json());
		await storeRaw("lacrime", layer, res.status, { n: rows.length });
		for (const r of rows) {
			if (!r.dr_no) continue;
			const ts = Date.parse(r.date_occ ?? "");
			const lat = Number(r.lat ?? NaN);
			const lon = Number(r.lon ?? NaN);
			await storeNormalized({
				id: `lacrime:${r.dr_no}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "lacrime",
				layer,
				title:
					`LA: ${r.crm_cd_desc ?? "?"} — ${r.area_name ?? "?"} (${r.status_desc ?? "?"})`.slice(
						0,
						300,
					),
				severity: /homicide|rape|robbery|assault|arson/i.test(
					r.crm_cd_desc ?? "",
				)
					? "watch"
					: "info",
				confidence: 0.8,
				lon: Number.isFinite(lon) && lon !== 0 ? lon : undefined,
				lat: Number.isFinite(lat) && lat !== 0 ? lat : undefined,
				entities: {},
				meta: { area: r.area_name, status: r.status_desc },
			});
			n++;
		}
		await markHealth("lacrime", true);
	} catch (e: unknown) {
		errors.push(`lacrime: ${errMsg(e)}`);
		await markHealth("lacrime", false, errors[errors.length - 1]);
	}

	// SF 311 cases (Socrata on data.sf.gov): newest 15, geo rows.
	try {
		const url =
			"https://data.sf.gov/resource/vw6y-z8j6.json?$limit=15&$order=requested_datetime%20DESC";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z
			.array(
				z.object({
					service_request_id: z.string().optional(),
					requested_datetime: z.string().optional(),
					service_name: z.string().nullable().optional(),
					status_description: z.string().nullable().optional(),
					address: z.string().nullable().optional(),
					lat: z.string().nullable().optional(),
					long: z.string().nullable().optional(),
				}),
			)
			.parse(await res.json());
		await storeRaw("sf311", layer, res.status, { n: rows.length });
		for (const r of rows) {
			if (!r.service_request_id) continue;
			const ts = Date.parse(r.requested_datetime ?? "");
			const lat = Number(r.lat ?? NaN);
			const lon = Number(r.long ?? NaN);
			await storeNormalized({
				id: `sf311:${r.service_request_id}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "sf311",
				layer,
				title:
					`SF 311: ${r.service_name ?? "?"} @ ${(r.address ?? "?").slice(0, 80)} (${r.status_description ?? "?"})`.slice(
						0,
						300,
					),
				severity: /fire|gas|sewer|flood|hazard|urgent/i.test(
					r.service_name ?? "",
				)
					? "watch"
					: "info",
				confidence: 0.85,
				lon: Number.isFinite(lon) ? lon : undefined,
				lat: Number.isFinite(lat) ? lat : undefined,
				entities: {},
				meta: { service: r.service_name, status: r.status_description },
			});
			n++;
		}
		await markHealth("sf311", true);
	} catch (e: unknown) {
		errors.push(`sf311: ${errMsg(e)}`);
		await markHealth("sf311", false, errors[errors.length - 1]);
	}

	// Austin traffic incidents (Socrata): newest 15, geo rows.
	try {
		const url =
			"https://data.austintexas.gov/resource/r3af-2r8x.json?$limit=15&$order=published_date%20DESC";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z
			.array(
				z.object({
					traffic_report_id: z.string().optional(),
					published_date: z.string().optional(),
					issue_reported: z.string().nullable().optional(),
					traffic_report_status: z.string().nullable().optional(),
					address: z.string().nullable().optional(),
					latitude: z.string().nullable().optional(),
					longitude: z.string().nullable().optional(),
				}),
			)
			.parse(await res.json());
		await storeRaw("austintraffic", layer, res.status, { n: rows.length });
		for (const r of rows) {
			if (!r.traffic_report_id) continue;
			const ts = Date.parse(r.published_date ?? "");
			const lat = Number(r.latitude ?? NaN);
			const lon = Number(r.longitude ?? NaN);
			await storeNormalized({
				id: `austint:${createHash("md5").update(r.traffic_report_id).digest("hex").slice(0, 16)}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "austintraffic",
				layer,
				title:
					`Austin: ${r.issue_reported ?? "?"} @ ${(r.address ?? "?").slice(0, 80)} (${r.traffic_report_status ?? "?"})`.slice(
						0,
						300,
					),
				severity: /crash|fatality|closure|hazmat/i.test(r.issue_reported ?? "")
					? "watch"
					: "info",
				confidence: 0.8,
				lon: Number.isFinite(lon) ? lon : undefined,
				lat: Number.isFinite(lat) ? lat : undefined,
				entities: {},
				meta: { issue: r.issue_reported, status: r.traffic_report_status },
			});
			n++;
		}
		await markHealth("austintraffic", true);
	} catch (e: unknown) {
		errors.push(`austintraffic: ${errMsg(e)}`);
		await markHealth("austintraffic", false, errors[errors.length - 1]);
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

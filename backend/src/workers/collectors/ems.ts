// Copernicus Emergency Management Service — rapid mapping activations
// (keyless). Neither API is formally documented, so parsing is tolerant
// (code/name/category/time/centroid under a few spellings). The rapid-mapping
// dashboard list is primary; the EMS portal's activation list (a separate
// service, same fields) is the fallback — the legacy RSS feed was retired
// (404 since 2026-09). Open activations are watch, closed info; on the
// disasters layer at the activation centroid.

import { locateCountry } from "../lib/countries.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// `public-activations/` now demands an activation code (2026-09-24); the
// list moved to `public-activations-info/`.
const URL_API =
	"https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=50";
const URL_FALLBACK =
	"https://mapping.emergency.copernicus.eu/activations/api/activations/?limit=50";
const SOURCE = "copernicus-ems";

export type Activation = {
	code: string;
	name: string;
	category: string;
	ts: string | null;
	closed: boolean;
	countries: string[];
	lat: number | null;
	lon: number | null;
};

type J = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** "POINT (12.3 45.6)", GeoJSON Point, or {lat, lon}. */
export function parseCentroid(v: unknown): [number, number] | null {
	if (typeof v === "string") {
		const m = v.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
		return m ? [Number(m[1]), Number(m[2])] : null;
	}
	if (v && typeof v === "object") {
		const o = v as J;
		const c = o.coordinates;
		if (Array.isArray(c) && typeof c[0] === "number")
			return [c[0] as number, c[1] as number];
		const lat = Number(o.lat ?? o.latitude);
		const lon = Number(o.lon ?? o.lng ?? o.longitude);
		if (Number.isFinite(lat) && Number.isFinite(lon)) return [lon, lat];
	}
	return null;
}

function countriesOf(v: unknown): string[] {
	if (typeof v === "string")
		return v
			.split(/[,;]/)
			.map((s) => s.trim())
			.filter(Boolean);
	if (Array.isArray(v))
		return v
			.map((x) =>
				typeof x === "string"
					? x
					: str((x as J)?.name) || str((x as J)?.short_name),
			)
			.filter(Boolean);
	return [];
}

export function parseEmsApi(j: unknown): Activation[] {
	const o = (j ?? {}) as J;
	const arr = (Array.isArray(j) ? j : (o.results ?? o.items ?? o.data)) as
		| J[]
		| undefined;
	const out: Activation[] = [];
	for (const a of arr ?? []) {
		const code = str(a.code ?? a.activationCode ?? a.emsr).toUpperCase();
		if (!/^EMSR\d+$/.test(code)) continue;
		const c =
			parseCentroid(a.centroid) ??
			parseCentroid(a.geometry) ??
			parseCentroid(a);
		const cat = a.category ?? a.eventType ?? a.hazard;
		out.push({
			code,
			name: str(a.name ?? a.title) || code,
			category: typeof cat === "string" ? cat : str((cat as J | null)?.name),
			ts:
				str(
					a.activationTime ?? a.eventTime ?? a.activation_time ?? a.created,
				) || null,
			closed: Boolean(a.closed ?? a.isClosed ?? str(a.status) === "closed"),
			countries: countriesOf(a.countries ?? a.country),
			lon: c?.[0] ?? null,
			lat: c?.[1] ?? null,
		});
	}
	return out;
}

async function fetchActivations(): Promise<{
	via: string;
	rows: Activation[];
}> {
	const errors: string[] = [];
	for (const [via, url] of [
		["api", URL_API],
		["portal", URL_FALLBACK],
	] as const) {
		try {
			assertSafeUrl(url);
			const res = await stealthFetch(url, {}, 30000);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const rows = parseEmsApi(await res.json());
			await storeRaw(SOURCE, "disasters", res.status, { via, n: rows.length });
			if (rows.length) return { via, rows };
			throw new Error("no activations parsed");
		} catch (e: unknown) {
			errors.push(`${via}: ${errMsg(e)}`);
		}
	}
	throw new Error(errors.join("; "));
}

export async function collect() {
	const layer = "disasters";
	try {
		const { via, rows } = await fetchActivations();
		for (const a of rows) {
			// No centroid → fall back to the first named country's capital.
			const where =
				a.lat == null
					? a.countries[0]
						? locateCountry(a.countries[0])
						: null
					: null;
			const ts = Date.parse(a.ts ?? "");
			await storeNormalized({
				id: `ems:${a.code}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: SOURCE,
				layer,
				title:
					`Copernicus EMS ${a.code} · ${a.name}${a.closed ? " (closed)" : ""}`.slice(
						0,
						280,
					),
				body:
					[a.category, a.countries.join(", ")].filter(Boolean).join(" · ") ||
					undefined,
				url: `https://rapidmapping.emergency.copernicus.eu/${a.code}/`,
				severity: a.closed ? "info" : "watch",
				confidence: 0.95,
				lat: a.lat ?? where?.lat,
				lon: a.lon ?? where?.lon,
				entities: { countries: a.countries, code: a.code },
				meta: { category: a.category, closed: a.closed, via },
			});
		}
		const ok = rows.length > 0;
		await markHealth(SOURCE, ok, ok ? undefined : "no activations parsed");
		return { ok, count: rows.length, via };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

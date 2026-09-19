import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// NASA EONET v3, keyless: open natural events (wildfires, storms, volcanoes, quakes...).
const URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50";

const Geometry = z.object({
	type: z.string(),
	coordinates: z.unknown(),
	date: z.string().optional(),
});
const Ev = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().nullable().optional(),
	link: z.string().nullable().optional(),
	categories: z
		.array(z.object({ id: z.string(), title: z.string() }))
		.optional(),
	geometry: z.array(Geometry).optional(),
});

function pointOf(
	g: z.infer<typeof Geometry>,
): { lon: number; lat: number } | null {
	try {
		if (g.type === "Point" && Array.isArray(g.coordinates)) {
			const [lon, lat] = g.coordinates as number[];
			if (typeof lon === "number" && typeof lat === "number")
				return { lon, lat };
		}
		// Polygon: centroid of outer ring (rough, v0)
		if (
			(g.type === "Polygon" || g.type === "MultiPolygon") &&
			Array.isArray(g.coordinates)
		) {
			const coords = g.coordinates as unknown[][][];
			const ring: unknown = g.type === "Polygon" ? coords[0] : coords[0]?.[0];
			if (Array.isArray(ring) && ring.length) {
				let x = 0;
				let y = 0;
				let m = 0;
				for (const pt of ring) {
					const [lon, lat] = pt as number[];
					if (typeof lon !== "number" || typeof lat !== "number") continue;
					x += lon;
					y += lat;
					m++;
				}
				if (m) return { lon: x / m, lat: y / m };
			}
		}
	} catch {
		/* fall through */
	}
	return null;
}

// JPL CNEOS close-approach (keyless, no quota pain): next-2-day Earth
// flybys — des, date, miss AU, velocity. Replaces the NASA NEO feed, whose
// shared DEMO_KEY 429s for hours under load (probed 2026-09-16).
const NEO_URL = "https://ssd-api.jpl.nasa.gov/cad.api?date-min=";

const CadResp = z.object({
	count: z.union([z.string(), z.number()]).optional(),
	fields: z.array(z.string()).optional(),
	data: z.array(z.array(z.string())).optional(),
});

export async function collect() {
	const source = "eonet";
	const layer = "disasters";
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { events?: unknown };
		const events = z.array(Ev).parse(json.events ?? []);
		await storeRaw(source, layer, res.status, { n: events.length });
		let n = 0;
		for (const e of events) {
			const g = (e.geometry ?? []).map(pointOf).find(Boolean) as
				| { lon: number; lat: number }
				| undefined;
			const cats = (e.categories ?? []).map((c) => c.title).join(",");
			await storeNormalized({
				id: `eonet:${e.id}`,
				ts: new Date().toISOString(),
				source,
				layer,
				title: e.title,
				body: e.description ?? undefined,
				url: e.link ?? undefined,
				severity: /wildfire|volcano|hurricane|typhoon|cyclone/i.test(cats)
					? "watch"
					: "info",
				confidence: 0.9,
				lon: g?.lon,
				lat: g?.lat,
				entities: {},
				meta: { categories: cats },
			});
			n++;
		}
		await markHealth(source, true);
		return collectNeo(layer, n);
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		return collectNeo(layer, 0, `eonet: ${errMsg(e)}`);
	}
}

async function collectNeo(
	layer: string,
	eonetN: number,
	eonetErr?: string,
): Promise<{ ok: boolean; count?: number; error?: string }> {
	let n = eonetN;
	const errors: string[] = eonetErr ? [eonetErr] : [];
	try {
		const today = new Date().toISOString().slice(0, 10);
		const day2 = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
		const url = `${NEO_URL}${today}&date-max=${day2}&body=Earth&dist-max=0.2`;
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = CadResp.parse(await res.json());
		const fields = j.fields ?? [];
		const rows = j.data ?? [];
		const fi = (name: string) => fields.indexOf(name);
		const iDes = fi("des");
		const iCd = fi("cd");
		const iDist = fi("dist");
		const iVrel = fi("v_rel");
		const iH = fi("h");
		await storeRaw("neo", layer, res.status, { n: rows.length });
		let m = 0;
		for (const r of rows.slice(0, 30)) {
			const des = iDes >= 0 ? (r[iDes] ?? "").trim() : "";
			if (!des) continue;
			const au = Number(iDist >= 0 ? r[iDist] : NaN);
			const lunar = Number.isFinite(au) ? au * 389.17 : NaN;
			const vel = Number(iVrel >= 0 ? r[iVrel] : NaN);
			const h = Number(iH >= 0 ? r[iH] : NaN);
			// H < 22 ≈ >140m — the hazardous-size band (no PHA flag in CAD).
			const big = Number.isFinite(h) && h < 22;
			const date = iCd >= 0 ? (r[iCd] ?? "") : "";
			await storeNormalized({
				id: `neo:${des.replace(/[^A-Za-z0-9]+/g, "-")}:${date.slice(0, 10)}`,
				ts: new Date().toISOString(),
				source: "neo",
				layer,
				title:
					`${des} — miss ${Number.isFinite(lunar) ? `${lunar.toFixed(1)} LD` : "?"}${big ? " · LARGE" : ""}`.slice(
						0,
						300,
					),
				severity:
					big && Number.isFinite(lunar) && lunar < 10 ? "watch" : "info",
				confidence: 0.85,
				entities: {},
				meta: {
					missAU: Number.isFinite(au) ? au : null,
					missLunar: Number.isFinite(lunar)
						? Math.round(lunar * 10) / 10
						: null,
					velKps: Number.isFinite(vel) ? vel : null,
					absMagH: Number.isFinite(h) ? h : null,
					approach: date || null,
				},
			});
			m++;
		}
		n += m;
		await markHealth("neo", true);
	} catch (e: unknown) {
		errors.push(`neo: ${errMsg(e)}`);
		await markHealth("neo", false, errors[errors.length - 1]);
	}
	// JPL Sentry impact-risk table (keyless, 2204 rows): top cumulative
	// Palermo-scale objects → watch rows. Sorted by ps_cum desc, cap 10.
	try {
		const url = "https://ssd-api.jpl.nasa.gov/sentry.api";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status} sentry`);
		const j = (await res.json()) as {
			data?: {
				des?: string;
				fullname?: string;
				ps_cum?: string;
				ip?: string;
				range?: string;
				diameter?: string;
				h?: string;
			}[];
		};
		const rows = [...(j.data ?? [])].sort(
			(a, b) => Number(b.ps_cum ?? -99) - Number(a.ps_cum ?? -99),
		);
		await storeRaw("sentry", layer, res.status, { n: rows.length });
		for (const r of rows.slice(0, 10)) {
			if (!r.des) continue;
			const ps = Number(r.ps_cum ?? NaN);
			const dia = Number(r.diameter ?? NaN);
			await storeNormalized({
				id: `sentry:${r.des.replace(/[^A-Za-z0-9]+/g, "-")}`,
				ts: new Date().toISOString(),
				source: "sentry",
				layer,
				title:
					`${r.fullname ?? r.des} — Palermo ${Number.isFinite(ps) ? ps.toFixed(2) : "?"}${Number.isFinite(dia) ? ` · ~${Math.round(dia * 1000)}m` : ""} (${r.range ?? "?"})`.slice(
						0,
						300,
					),
				severity: Number.isFinite(ps) && ps > -2 ? "watch" : "info",
				confidence: 0.85,
				entities: {},
				meta: {
					psCum: Number.isFinite(ps) ? ps : null,
					diameterKm: Number.isFinite(dia) ? dia : null,
					range: r.range ?? null,
					absMagH: Number(r.h ?? NaN) || null,
				},
			});
			n++;
		}
		await markHealth("sentry", true);
	} catch (e: unknown) {
		errors.push(`sentry: ${errMsg(e)}`);
		await markHealth("sentry", false, errors[errors.length - 1]);
	}
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

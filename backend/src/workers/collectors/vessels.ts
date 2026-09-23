// Live vessel positions from Fintraffic Digitraffic (keyless AIS, Baltic
// and Finnish waters). Positions reported in the last 20 minutes, joined
// with vessel metadata (name, type, destination). The current picture:
// vessels that stop reporting leave the map (pruneStale).
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import {
	dbClock,
	errMsg,
	markHealth,
	pruneStale,
	storeNormalized,
	storeRaw,
} from "../lib/store.js";

const BASE = "https://meri.digitraffic.fi/api/ais/v1";
const SOURCE = "digitraffic-ais";
const WINDOW_MS = 20 * 60e3;
const MAX = 4000;
// Digitraffic asks clients to identify themselves.
const HEADERS = {
	"Digitraffic-User": "Thoth/OSINT",
	"Accept-Encoding": "gzip",
	Accept: "application/json",
};

const Loc = z
	.object({
		mmsi: z.number(),
		geometry: z.object({ coordinates: z.array(z.number()).min(2) }),
		properties: z
			.object({
				sog: z.number().nullish(),
				cog: z.number().nullish(),
				heading: z.number().nullish(),
				navStat: z.number().nullish(),
				timestampExternal: z.number().nullish(),
			})
			.passthrough(),
	})
	.passthrough();
const Meta = z
	.object({
		mmsi: z.number(),
		name: z.string().nullish(),
		shipType: z.number().nullish(),
		destination: z.string().nullish(),
		callSign: z.string().nullish(),
		imo: z.number().nullish(),
	})
	.passthrough();

export type Vessel = {
	mmsi: number;
	lon: number;
	lat: number;
	sog: number | null;
	cog: number | null;
	heading: number | null;
	navStat: number | null;
	ts: number;
};

export function parseLocations(j: unknown, since: number): Vessel[] {
	const feats = (j as { features?: unknown[] } | null)?.features ?? [];
	const out: Vessel[] = [];
	for (const f of feats) {
		const r = Loc.safeParse(f);
		if (!r.success) continue;
		const [lon, lat] = r.data.geometry.coordinates;
		const ts = r.data.properties.timestampExternal ?? 0;
		// AIS "not available" sentinels: lon 181 / lat 91.
		if (ts < since || Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
		const p = r.data.properties;
		out.push({
			mmsi: r.data.mmsi,
			lon,
			lat,
			sog: p.sog != null && p.sog < 102.3 ? p.sog : null,
			cog: p.cog != null && p.cog < 360 ? p.cog : null,
			heading: p.heading != null && p.heading < 360 ? p.heading : null,
			navStat: p.navStat ?? null,
			ts,
		});
	}
	return out.sort((a, b) => b.ts - a.ts).slice(0, MAX);
}

/** ITU ship type code → short label. */
export function shipTypeLabel(t?: number | null): string {
	if (t == null) return "vessel";
	if (t === 30) return "fishing";
	if (t === 31 || t === 32 || t === 52) return "tug";
	if (t === 35) return "military";
	if (t === 36) return "sailing";
	if (t === 37) return "pleasure craft";
	if (t >= 40 && t <= 49) return "high-speed craft";
	if (t === 50) return "pilot";
	if (t === 51) return "search and rescue";
	if (t === 55) return "law enforcement";
	if (t >= 60 && t <= 69) return "passenger";
	if (t >= 70 && t <= 79) return "cargo";
	if (t >= 80 && t <= 89) return "tanker";
	return "vessel";
}

const NAV: Record<number, string> = {
	0: "under way",
	1: "at anchor",
	2: "not under command",
	3: "restricted manoeuvrability",
	5: "moored",
	6: "aground",
	7: "fishing",
	8: "sailing",
};

export async function collect() {
	const layer = "vessels";
	try {
		const runStart = await dbClock();
		const since = Date.now() - WINDOW_MS;
		const locUrl = `${BASE}/locations?from=${since}`;
		assertSafeUrl(locUrl);
		const res = await stealthFetch(locUrl, { headers: HEADERS }, 45000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const vessels = parseLocations(await res.json(), since);
		await storeRaw(SOURCE, layer, res.status, { n: vessels.length });
		if (!vessels.length) throw new Error("no recent positions");
		// Metadata is best-effort: positions alone still map.
		const meta = new Map<number, z.infer<typeof Meta>>();
		try {
			const mUrl = `${BASE}/vessels?from=${Date.now() - 24 * 3600e3}`;
			assertSafeUrl(mUrl);
			const m = await stealthFetch(mUrl, { headers: HEADERS }, 45000);
			if (m.ok)
				for (const x of (await m.json()) as unknown[]) {
					const r = Meta.safeParse(x);
					if (r.success) meta.set(r.data.mmsi, r.data);
				}
		} catch {
			/* names are optional */
		}
		for (const v of vessels) {
			const m = meta.get(v.mmsi);
			const kind = shipTypeLabel(m?.shipType);
			const name = m?.name?.trim() || `MMSI ${v.mmsi}`;
			const dest = m?.destination?.trim();
			await storeNormalized({
				id: `ais:fi:${v.mmsi}`,
				ts: new Date(v.ts).toISOString(),
				source: SOURCE,
				layer,
				title: [
					`${name} · ${kind}`,
					v.sog != null ? `${v.sog.toFixed(1)} kn` : "",
					dest ? `→ ${dest}` : "",
				]
					.filter(Boolean)
					.join(" · ")
					.slice(0, 280),
				url: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${v.mmsi}`,
				severity: "info",
				confidence: 0.9,
				lat: v.lat,
				lon: v.lon,
				entities: {
					mmsi: String(v.mmsi),
					imo: m?.imo ? String(m.imo) : undefined,
				},
				meta: {
					kind,
					shipType: m?.shipType ?? null,
					sog: v.sog,
					track: v.heading ?? v.cog ?? 0,
					status: v.navStat != null ? (NAV[v.navStat] ?? null) : null,
					destination: dest ?? null,
					callSign: m?.callSign ?? null,
				},
			});
		}
		await pruneStale(SOURCE, runStart);
		await markHealth(SOURCE, true);
		return { ok: true, count: vessels.length, named: meta.size };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

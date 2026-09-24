// GNSS interference map, derived (gpsjam.org method) from keyless ADS-B:
// every transponder reports its navigation accuracy (NACp). Aircraft that
// suddenly report NACp < 8, or that readsb flags with gpsOkBefore (GPS was
// fine, now lost), are flying through jamming or spoofing. Share of bad
// aircraft per 1° cell → severity. Polls a fixed set of known hotspots
// (the flights layer only covers central Europe) at adsb.lol, falling back
// to adsb.fi per region; both serve the readsb schema.
// A current picture: cells that clear leave the map via pruneStale.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { sleep } from "../lib/sleep.js";
import {
	dbClock,
	errMsg,
	markHealth,
	pruneStale,
	storeNormalized,
	storeRaw,
} from "../lib/store.js";

const SOURCE = "gpsjam";
const RADIUS_NM = 250; // both providers cap point queries at 250 nm

export const REGIONS: [string, number, number][] = [
	["baltic", 56.5, 20.5],
	["gulf-of-finland", 60.0, 27.5],
	["black-sea", 44.5, 33.5],
	["levant", 33.5, 34.5],
	["persian-gulf", 26.5, 52.0],
	["caucasus", 41.0, 45.5],
];

const Ac = z
	.object({
		hex: z.string(),
		lat: z.number().nullish(),
		lon: z.number().nullish(),
		alt_baro: z.union([z.number(), z.string()]).nullish(),
		nac_p: z.number().nullish(),
		gpsOkBefore: z.number().nullish(),
	})
	.passthrough();
type Aircraft = z.infer<typeof Ac>;

export type Cell = {
	key: string;
	lat0: number;
	lon0: number;
	total: number;
	bad: number;
};

/** An aircraft whose navigation accuracy says its GNSS fix is degraded. */
export function isDegraded(a: Aircraft): boolean {
	return (a.nac_p != null && a.nac_p < 8) || a.gpsOkBefore != null;
}

/** Airborne aircraft with an accuracy report → 1° cells. */
export function binCells(ac: Aircraft[]): Cell[] {
	const cells = new Map<string, Cell>();
	for (const a of ac) {
		if (a.lat == null || a.lon == null) continue;
		if (a.alt_baro === "ground") continue;
		if (a.nac_p == null && a.gpsOkBefore == null) continue;
		const lat0 = Math.floor(a.lat);
		const lon0 = Math.floor(a.lon);
		const key = `${lat0}:${lon0}`;
		const c = cells.get(key) ?? { key, lat0, lon0, total: 0, bad: 0 };
		c.total++;
		if (isDegraded(a)) c.bad++;
		cells.set(key, c);
	}
	return [...cells.values()];
}

/** gpsjam.org bands: <2% normal, 2–10% elevated, >10% heavy. Sparse cells
 * need ≥3 reporting aircraft; one bad transponder is not jamming. */
export function cellSeverity(c: Cell): "critical" | "watch" | null {
	if (c.total < 3 || c.bad === 0) return null;
	const r = c.bad / c.total;
	if (r > 0.1 && c.bad >= 2) return "critical";
	if (r >= 0.02) return "watch";
	return null;
}

function hemi(v: number, pos: string, neg: string) {
	return `${Math.abs(v)}°${v >= 0 ? pos : neg}`;
}

async function fetchRegion(lat: number, lon: number): Promise<Aircraft[]> {
	const urls = [
		`https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${RADIUS_NM}`,
		`https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${RADIUS_NM}`,
	];
	let last = "";
	for (const u of urls) {
		try {
			assertSafeUrl(u);
			const res = await stealthFetch(u);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const j = (await res.json()) as { ac?: unknown; aircraft?: unknown };
			return z.array(Ac).parse(j.ac ?? j.aircraft ?? []);
		} catch (e: unknown) {
			last = `${new URL(u).hostname}: ${errMsg(e)}`;
			await sleep(1100); // adsb.fi allows 1 req/s
		}
	}
	throw new Error(last);
}

export async function collect() {
	const layer = "gpsjam";
	const runStart = await dbClock();
	const byHex = new Map<string, Aircraft>();
	const errors: string[] = [];
	for (const [name, lat, lon] of REGIONS) {
		try {
			for (const a of await fetchRegion(lat, lon)) byHex.set(a.hex, a);
		} catch (e: unknown) {
			errors.push(`${name}: ${errMsg(e)}`);
		}
		await sleep(1100);
	}
	const okRegions = REGIONS.length - errors.length;
	await storeRaw(SOURCE, layer, okRegions ? 200 : 500, {
		regions: okRegions,
		aircraft: byHex.size,
	});
	if (!okRegions) {
		await markHealth(SOURCE, false, errors.join("; "));
		return { ok: false, error: errors.join("; ") };
	}
	const now = new Date().toISOString();
	let n = 0;
	for (const c of binCells([...byHex.values()])) {
		const sev = cellSeverity(c);
		if (!sev) continue;
		const pct = Math.round((c.bad / c.total) * 100);
		const { lat0: y, lon0: x } = c;
		await storeNormalized({
			id: `gpsjam:${c.key}`,
			ts: now,
			source: SOURCE,
			layer,
			title: `GNSS interference ${pct}% · ${c.bad}/${c.total} aircraft degraded · ${hemi(y, "N", "S")} ${hemi(x, "E", "W")}`,
			url: "https://gpsjam.org/",
			severity: sev,
			confidence: Math.min(0.9, 0.5 + c.total / 50),
			geomJson: {
				type: "Polygon",
				coordinates: [
					[
						[x, y],
						[x + 1, y],
						[x + 1, y + 1],
						[x, y + 1],
						[x, y],
					],
				],
			},
			meta: { bad: c.bad, total: c.total, ratio: c.bad / c.total },
		});
		n++;
	}
	// Heartbeat (no geometry) keeps the feed's freshness honest on quiet
	// runs; it is pruned as soon as real cells return.
	if (!n)
		await storeNormalized({
			id: "gpsjam:quiet",
			ts: now,
			source: SOURCE,
			layer,
			title: `No GNSS interference above 2% across ${okRegions} watched regions`,
			severity: "info",
			confidence: 0.6,
			meta: { quiet: true, aircraft: byHex.size },
		});
	// Only a complete sweep may clear cells: a failed region must not read
	// as "interference ended".
	if (!errors.length) await pruneStale(SOURCE, runStart);
	await markHealth(SOURCE, true, errors.length ? errors.join("; ") : undefined);
	return { ok: true, count: n, aircraft: byHex.size, regions: okRegions };
}

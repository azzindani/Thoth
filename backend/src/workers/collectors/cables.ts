// Submarine cables + landing points (TeleGeography Submarine Cable Map,
// keyless GeoJSON, CC BY-NC-SA 3.0 — attribution kept on every row).
// Routes are MultiLineStrings on a line layer; landing stations are
// points on the same layer. Daily: the map changes a few times a year.
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

const BASE = "https://www.submarinecablemap.com/api/v3";
const URL_CABLES = `${BASE}/cable/cable-geo.json`;
const URL_LANDING = `${BASE}/landing-point/landing-point-geo.json`;
const SOURCE = "submarine-cables";
const CREDIT = "Submarine Cable Map, TeleGeography (CC BY-NC-SA 3.0)";

const Feature = z
	.object({
		geometry: z
			.object({
				type: z.string(),
				coordinates: z.array(z.unknown()),
			})
			.nullish(),
		properties: z
			.object({
				id: z.string().nullish(),
				name: z.string().nullish(),
				color: z.string().nullish(),
			})
			.passthrough(),
	})
	.passthrough();

export type CableFeature = {
	id: string;
	name: string;
	geometry: { type: string; coordinates: unknown[] };
	color: string | null;
};

export function parseCableGeo(j: unknown, kinds: string[]): CableFeature[] {
	const feats = (j as { features?: unknown[] } | null)?.features ?? [];
	const out: CableFeature[] = [];
	for (const f of feats) {
		const r = Feature.safeParse(f);
		if (!r.success || !r.data.geometry) continue;
		if (!kinds.includes(r.data.geometry.type)) continue;
		const id = r.data.properties.id ?? "";
		if (!/^[a-z0-9-]+$/i.test(id)) continue;
		out.push({
			id,
			name: r.data.properties.name ?? id,
			geometry: r.data.geometry,
			color: r.data.properties.color ?? null,
		});
	}
	return out;
}

export async function collect() {
	const layer = "cables";
	try {
		const runStart = await dbClock();
		assertSafeUrl(URL_CABLES);
		const res = await stealthFetch(URL_CABLES, {}, 60000);
		if (!res.ok) throw new Error(`cables HTTP ${res.status}`);
		const cables = parseCableGeo(await res.json(), [
			"LineString",
			"MultiLineString",
		]);
		await storeRaw(SOURCE, layer, res.status, { cables: cables.length });
		if (!cables.length) throw new Error("no cable routes parsed");
		const now = new Date().toISOString();
		for (const c of cables)
			await storeNormalized({
				id: `cable:${c.id}`,
				ts: now,
				source: SOURCE,
				layer,
				title: `Submarine cable · ${c.name}`.slice(0, 280),
				body: CREDIT,
				url: `https://www.submarinecablemap.com/submarine-cable/${c.id}`,
				severity: "info",
				confidence: 0.9,
				geomJson: c.geometry,
				entities: { cable: c.name },
				meta: { kind: "cable", color: c.color },
			});
		// Landing points are optional: routes alone are a complete picture.
		let landings = 0;
		try {
			assertSafeUrl(URL_LANDING);
			const lp = await stealthFetch(URL_LANDING, {}, 60000);
			if (lp.ok)
				for (const p of parseCableGeo(await lp.json(), ["Point"])) {
					const [lon, lat] = p.geometry.coordinates as number[];
					await storeNormalized({
						id: `cable-landing:${p.id}`,
						ts: now,
						source: SOURCE,
						layer,
						title: `Cable landing · ${p.name}`.slice(0, 280),
						body: CREDIT,
						url: `https://www.submarinecablemap.com/landing-point/${p.id}`,
						severity: "info",
						confidence: 0.9,
						lat,
						lon,
						entities: { place: p.name },
						meta: { kind: "landing" },
					});
					landings++;
				}
		} catch {
			/* keep the routes */
		}
		// Only prune landings when that half succeeded too.
		if (landings) await pruneStale(SOURCE, runStart);
		await markHealth(SOURCE, true);
		return {
			ok: true,
			count: cables.length + landings,
			cables: cables.length,
			landings,
		};
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

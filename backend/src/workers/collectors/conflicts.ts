import { z as zc } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// Conflict blast detection without any key (world-dashboard conflicts.py pattern):
// USGS non-tectonic event types (explosion, quarry_blast, sonic_boom) inside
// active war-zone bounding boxes. Quarry noise outside zones is ignored by design.
const ZONES: { name: string; bbox: string }[] = [
	{ name: "ukraine", bbox: "22,44,40,53" },
	{ name: "gaza-israel", bbox: "34,29,37,34" },
	{ name: "lebanon-syria", bbox: "35,32,43,38" },
	{ name: "yemen", bbox: "42,12,56,20" },
	{ name: "sudan", bbox: "21,8,39,23" },
	{ name: "sahel", bbox: "-17,10,16,26" },
	{ name: "myanmar", bbox: "92,9,102,29" },
	{ name: "drc", bbox: "12,-14,32,6" },
];

const Props = zc.object({
	mag: zc.number().nullable().optional(),
	place: zc.string().nullable().optional(),
	time: zc.number().nullable().optional(),
	type: zc.string().nullable().optional(),
	url: zc.string().nullable().optional(),
});
const Feat = zc.object({
	geometry: zc.object({ coordinates: zc.unknown() }).nullable().optional(),
	properties: Props.nullable().optional(),
	id: zc.string().optional(),
});

export async function collect() {
	const layer = "conflicts";
	let n = 0;
	const errors: string[] = [];
	for (const zone of ZONES) {
		for (const et of ["explosion", "quarry_blast"]) {
			const url =
				`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=20&orderby=time` +
				`&eventtype=${et}&minlatitude=${zone.bbox.split(",")[1]}&maxlatitude=${zone.bbox.split(",")[3]}` +
				`&minlongitude=${zone.bbox.split(",")[0]}&maxlongitude=${zone.bbox.split(",")[2]}`;
			const source = "usgs-blast";
			try {
				assertSafeUrl(url);
				const res = await stealthFetch(url);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const json = (await res.json()) as { features?: unknown };
				const feats = zc.array(Feat).parse(json.features ?? []);
				await storeRaw(source, layer, res.status, {
					zone: zone.name,
					et,
					n: feats.length,
				});
				for (const f of feats) {
					const c = f.geometry?.coordinates;
					if (!Array.isArray(c)) continue;
					const [lon, lat] = c as number[];
					if (typeof lon !== "number" || typeof lat !== "number") continue;
					const p = f.properties ?? {};
					const mag = p.mag ?? 0;
					await storeNormalized({
						id: `blast:${f.id ?? `${zone.name}-${p.time ?? Date.now()}`}`,
						ts: new Date(p.time ?? Date.now()).toISOString(),
						source,
						layer,
						title: `${et.replace("_", " ")} M${mag.toFixed(1)} — ${p.place ?? zone.name}`,
						url: p.url ?? undefined,
						severity: mag >= 3 ? "critical" : "watch",
						confidence: 0.7,
						lon,
						lat,
						entities: {},
						meta: { zone: zone.name, eventtype: et, mag },
					});
					n++;
				}
			} catch (e: unknown) {
				errors.push(`${zone.name}/${et}: ${errMsg(e)}`);
			}
		}
	}
	// Empty is a legitimate finding (no catalogued blasts in zones), not an outage.
	await markHealth("usgs-blast", true, errors.join("; ") || undefined);
	return { ok: true, count: n };
}

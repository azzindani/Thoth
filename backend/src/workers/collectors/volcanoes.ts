import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// Smithsonian GVP Holocene volcanoes via GeoServer WFS (JSON), keyless.
// Slow-moving baseline: daily poll, severity by eruption recency.
const URL =
	"https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&maxFeatures=1500&outputFormat=application%2Fjson";

const F = z.object({
	geometry: z.object({ coordinates: z.unknown() }).nullable().optional(),
	properties: z
		.object({
			Volcano_Number: z.union([z.string(), z.number()]).nullable().optional(),
			Volcano_Name: z.string().nullable().optional(),
			Country: z.string().nullable().optional(),
			Primary_Volcano_Type: z.string().nullable().optional(),
			Last_Eruption_Year: z
				.union([z.string(), z.number()])
				.nullable()
				.optional(),
		})
		.nullable()
		.optional(),
});

// Reference layer (like bases/chokepoints): always info, never floods ALERTS.
// Recency stays visible in title + meta.lastEruption.

export async function collect() {
	const source = "smithsonian";
	const layer = "volcanoes";
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { features?: unknown };
		const feats = z.array(F).parse(json.features ?? []);
		await storeRaw(source, layer, res.status, { n: feats.length });
		let n = 0;
		for (const f of feats) {
			const c = f.geometry?.coordinates;
			if (!Array.isArray(c)) continue;
			const [lon, lat] = c as number[];
			if (typeof lon !== "number" || typeof lat !== "number") continue;
			const p = f.properties ?? {};
			const name = p.Volcano_Name ?? "unnamed volcano";
			await storeNormalized({
				id: `gvp:${String(p.Volcano_Number ?? name)}`,
				ts: new Date().toISOString(),
				source,
				layer,
				title: `${name} (${p.Country ?? "?"}) — last eruption ${p.Last_Eruption_Year ?? "unknown"}`,
				severity: "info",
				confidence: 0.9,
				lon,
				lat,
				entities: {},
				meta: {
					type: p.Primary_Volcano_Type,
					lastEruption: p.Last_Eruption_Year,
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

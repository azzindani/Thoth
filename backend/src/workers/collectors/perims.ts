import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// NIFC WFIGS current interagency fire perimeters (ArcGIS FeatureServer, keyless).
// Org ID migrated 2024-25: T4QMspbfLg3qTGWY (old ...V5aH is dead). Polygon twin
// to the FIRMS hotspot dots. See docs/PORT-newsources.md.
const URL =
	"https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query";

type Ring = number[][];
interface PerimFeature {
	attributes?: Record<string, unknown>;
	properties?: Record<string, unknown>;
	geometry?: { rings?: Ring[]; coordinates?: Ring[] };
}

export async function collect() {
	const source = "nifc";
	const layer = "perims";
	try {
		assertSafeUrl(URL);
		const q =
			`${URL}?where=1%3D1&outFields=attr_UniqueFireIdentifier,attr_IncidentName,poly_IncidentName,` +
			`attr_FireDiscoveryDateTime,attr_IncidentSize,attr_PercentContained,attr_FireCause&` +
			`returnGeometry=true&f=geojson&resultRecordCount=500&geometryPrecision=4&` +
			`maxAllowableOffset=0.01`;
		const res = await stealthFetch(q, {}, 60000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { features?: PerimFeature[] };
		const feats = json.features ?? [];
		if (!feats.length) throw new Error("empty feature set");
		await storeRaw(source, layer, res.status, { n: feats.length });
		let n = 0;
		for (const f of feats.slice(0, 300)) {
			// f=geojson nests attrs under properties; Esri json under attributes
			const a = { ...(f.attributes ?? {}), ...(f.properties ?? {}) };
			const rings = f.geometry?.rings ?? f.geometry?.coordinates;
			if (!rings?.length) continue;
			const name = String(
				a.attr_IncidentName ?? a.poly_IncidentName ?? `Fire ${n}`,
			);
			const id = String(a.attr_UniqueFireIdentifier ?? name);
			const size = Number(a.attr_IncidentSize ?? 0);
			const contained = Number(a.attr_PercentContained ?? 0);
			await storeNormalized({
				id: `nifc:${id}`,
				ts: new Date().toISOString(),
				source,
				layer,
				title: name.slice(0, 300),
				body: `size ${Number.isNaN(size) ? "?" : size}ac · contained ${Number.isNaN(contained) ? "?" : contained}%`,
				severity:
					!Number.isNaN(size) && size > 10000 && contained < 50
						? "critical"
						: !Number.isNaN(size) && size > 1000
							? "watch"
							: "info",
				confidence: 0.9,
				geomJson: { type: "Polygon", coordinates: rings },
				entities: {},
				meta: {
					size_ac: a.attr_IncidentSize,
					contained_pct: a.attr_PercentContained,
					cause: a.attr_FireCause,
					discovered: a.attr_FireDiscoveryDateTime,
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

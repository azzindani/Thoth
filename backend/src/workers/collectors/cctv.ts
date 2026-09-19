import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// CCTV federation: SG LTA + TfL JamCams + Ontario 511 (all keyless, verified).
// Dead/keyed (checked 2026-09-09, do NOT retry blind): Caltrans ArcGIS (empty),
// 511 Alberta (Invalid Key), RWS NL (empty), WSDOT (access code required).
// Japan river cams are bare image URLs with no coord API — needs manual registry.
const SG_URL = "https://api.data.gov.sg/v1/transport/traffic-images";
const TFL_URL = "https://api.tfl.gov.uk/Place/Type/JamCam";
const ON511_URL = "https://511on.ca/api/v2/get/cameras";

const SgCam = z.object({
	camera_id: z.string(),
	image: z.string(),
	timestamp: z.string(),
	location: z.object({ latitude: z.number(), longitude: z.number() }),
});
const TflPlace = z.object({
	id: z.string(),
	commonName: z.string(),
	lat: z.number(),
	lon: z.number(),
	additionalProperties: z
		.array(z.object({ key: z.string(), value: z.string() }))
		.optional(),
});

let probeOffset = 0;

async function probe(url: string): Promise<boolean> {
	try {
		assertSafeUrl(url);
		const res = await stealthFetch(url, { method: "HEAD" }, 10000);
		return res.ok;
	} catch {
		return false;
	}
}

export async function collect() {
	const layer = "cctv";
	let n = 0;
	const errors: string[] = [];

	try {
		assertSafeUrl(SG_URL);
		const res = await stealthFetch(SG_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const sg = (await res.json()) as { items?: unknown };
		const sgItems = sg.items;
		const first = Array.isArray(sgItems)
			? (sgItems[0] as { cameras?: unknown } | undefined)
			: undefined;
		const camsRaw =
			first?.cameras ?? (sgItems as { cameras?: unknown })?.cameras ?? [];
		const cams = z.array(SgCam).parse(camsRaw);
		await storeRaw("sg-lta", layer, res.status, { n: cams.length });
		for (const [i, c] of cams.entries()) {
			// probe rotating sample of 10
			let live: boolean | null = null;
			if (i % Math.max(1, Math.floor(cams.length / 10)) === probeOffset % 10) {
				live = await probe(c.image);
				await new Promise((r) => setTimeout(r, 300));
			}
			await storeNormalized({
				id: `cctv:sg:${c.camera_id}`,
				ts: c.timestamp,
				source: "sg-lta",
				layer,
				title: `SG traffic cam ${c.camera_id}`,
				url: c.image,
				severity: "info",
				confidence: 0.9,
				lon: c.location.longitude,
				lat: c.location.latitude,
				entities: {},
				meta: { camera_id: c.camera_id, image: c.image, probe_live: live },
			});
			n++;
		}
		await markHealth("sg-lta", true);
	} catch (e: unknown) {
		errors.push(`sg-lta: ${errMsg(e)}`);
		await markHealth("sg-lta", false, errors[errors.length - 1]);
	}

	try {
		assertSafeUrl(TFL_URL);
		const res = await stealthFetch(TFL_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const raw = (await res.json()) as unknown;
		const places = z.array(TflPlace).parse(Array.isArray(raw) ? raw : []);
		await storeRaw("tfl-jamcam", layer, res.status, { n: places.length });
		for (const [i, p] of places.slice(0, 400).entries()) {
			const props: Record<string, string> = {};
			for (const a of p.additionalProperties ?? []) props[a.key] = a.value;
			let live: boolean | null = null;
			if (props.imageUrl && i % 40 === probeOffset % 10) {
				live = await probe(props.imageUrl);
				await new Promise((r) => setTimeout(r, 300));
			}
			await storeNormalized({
				id: `cctv:tfl:${p.id}`,
				ts: new Date().toISOString(),
				source: "tfl-jamcam",
				layer,
				title: p.commonName,
				url: props.imageUrl,
				severity: "info",
				confidence: 0.85,
				lon: p.lon,
				lat: p.lat,
				entities: {},
				meta: {
					available: props.available,
					image: props.imageUrl,
					probe_live: live,
				},
			});
			n++;
		}
		await markHealth("tfl-jamcam", true);
	} catch (e: unknown) {
		errors.push(`tfl: ${errMsg(e)}`);
		await markHealth("tfl-jamcam", false, errors[errors.length - 1]);
	}

	try {
		assertSafeUrl(ON511_URL);
		const res = await stealthFetch(ON511_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const raw = (await res.json()) as unknown;
		const cams = z
			.array(
				z.object({
					Id: z.union([z.string(), z.number()]),
					Location: z.string().nullable().optional(),
					Roadway: z.string().nullable().optional(),
					Latitude: z.number(),
					Longitude: z.number(),
				}),
			)
			.parse(Array.isArray(raw) ? raw : []);
		await storeRaw("on511", layer, res.status, { n: cams.length });
		for (const c of cams.slice(0, 400)) {
			await storeNormalized({
				id: `cctv:on511:${String(c.Id)}`,
				ts: new Date().toISOString(),
				source: "on511",
				layer,
				title: `${c.Location ?? "Ontario cam"} (${c.Roadway ?? "?"})`,
				severity: "info",
				confidence: 0.85,
				lon: c.Longitude,
				lat: c.Latitude,
				entities: {},
				meta: { roadway: c.Roadway },
			});
			n++;
		}
		await markHealth("on511", true);
	} catch (e: unknown) {
		errors.push(`on511: ${errMsg(e)}`);
		await markHealth("on511", false, errors[errors.length - 1]);
	}

	probeOffset++;
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

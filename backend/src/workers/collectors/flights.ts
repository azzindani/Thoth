import { readFileSync } from "node:fs";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// Primary: adsb.lol (may 503 from cloud IPs). Fallback: OpenSky public (100 req/day anon).
const ADSB_URL =
	"https://api.adsb.lol/v2/states/all?lamin=45&lamax=55&lomin=5&lomax=15";
const OPENSKY_URL =
	"https://opensky-network.org/api/states/all?lamin=45&lamax=55&lomin=5&lomax=15";
// Extra theater/city regions (same shape): Tokyo Bay, Sydney Basin,
// Mexico City. Null-states regions (Kyiv — closed airspace) excluded.
const OPENSKY_REGIONS: [string, string, string][] = [
	["opensky-bosporus", "opensky-bos", "https://opensky-network.org/api/states/all?lamin=40&lamax=42&lomin=27&lomax=31"],
	["opensky-tokyo", "opensky-tyo", "https://opensky-network.org/api/states/all?lamin=35&lamax=37&lomin=135&lomax=142"],
	["opensky-sydney", "opensky-syd", "https://opensky-network.org/api/states/all?lamin=-33&lamax=-32&lomin=151&lomax=152"],
	["opensky-mexico", "opensky-mex", "https://opensky-network.org/api/states/all?lamin=19&lamax=20&lomin=-100&lomax=-98"],
];
// adsb.fi opendata (keyless): second opinion when both above fail.
const ADSFI_URL = "https://opendata.adsb.fi/api/v2/mil";
const Ac = z.object({
	hex: z.string(),
	flight: z.string().nullable().optional(),
	lat: z.number().nullable().optional(),
	lon: z.number().nullable().optional(),
	alt_baro: z.number().nullable().optional(),
	track: z.number().nullable().optional(),
});

// Airline registry (vendored shadowbroker airlines.json): callsign prefix → name.
let airlineMap: Map<string, string> | null = null;
export function airlineOf(callsign: string): string | null {
	if (!airlineMap) {
		try {
			const raw = JSON.parse(
				readFileSync(
					new URL("../../../static/airlines.json", import.meta.url).pathname,
					"utf8",
				),
			) as { items?: { icao?: string; name?: string }[] };
			airlineMap = new Map();
			for (const a of raw.items ?? [])
				if (a.icao && a.name && a.icao.length === 3)
					airlineMap.set(a.icao.toUpperCase(), a.name);
		} catch {
			airlineMap = new Map();
		}
	}
	const m = /^\s*([A-Z]{3})/.exec(callsign.toUpperCase());
	return (m && airlineMap.get(m[1])) || null;
}

export async function collect() {
	const layer = "flights";
	const attempts: Array<{
		source: string;
		url: string;
		kind: "adsb" | "opensky";
	}> = [
		{ source: "adsb.lol", url: ADSB_URL, kind: "adsb" },
		{ source: "opensky", url: OPENSKY_URL, kind: "opensky" },
	];
	let lastError = "";
	for (const a of attempts) {
		try {
			assertSafeUrl(a.url);
			const res = await stealthFetch(a.url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = (await res.json()) as { ac?: unknown; states?: unknown[][] };
			if (a.kind === "adsb") {
				const acRaw = json.ac;
				await storeRaw(a.source, layer, res.status, {
					n: Array.isArray(acRaw) ? acRaw.length : 0,
				});
				const ac = z.array(Ac).parse(acRaw ?? []);
				let n = 0;
				for (const f of ac.slice(0, 500)) {
					if (f.lat == null || f.lon == null) continue;
					const cs = (f.flight ?? f.hex).trim() || f.hex;
					await storeNormalized({
						id: `adsb:${f.hex}`,
						ts: new Date().toISOString(),
						source: a.source,
						layer,
						title: cs,
						severity: "info",
						confidence: 0.8,
						lon: f.lon,
						lat: f.lat,
						entities: { hex: f.hex },
						meta: {
							alt_baro: f.alt_baro,
							track: f.track,
							airline: airlineOf(cs),
						},
					});
					n++;
				}
				await markHealth(a.source, true);
				return { ok: true, source: a.source, count: n };
			}
			// opensky states: [icao24, callsign, origin, ..., lon(5), lat(6), baro_alt(7), ..., track(10)]
			const states: unknown[][] = json.states ?? [];
			await storeRaw(a.source, layer, res.status, { n: states.length });
			let n = 0;
			for (const s of states.slice(0, 500)) {
				const [icao24, callsign, , , , lon, lat, baro, , track] = s;
				if (typeof lat !== "number" || typeof lon !== "number") continue;
				const name = typeof callsign === "string" ? callsign.trim() : "";
				await storeNormalized({
					id: `opensky:${String(icao24)}`,
					ts: new Date().toISOString(),
					source: a.source,
					layer,
					title: name || String(icao24),
					severity: "info",
					confidence: 0.75,
					lon,
					lat,
					entities: { hex: String(icao24) },
					meta: { alt_baro: baro, track, airline: airlineOf(name) },
				});
				n++;
			}
			await markHealth(a.source, true);
			if (a.source === "opensky") {
				// Extra regions: independent polls appended to the same tick
				// (own ids/health each, never blocks EU return).
				for (const [src, prefix, url] of OPENSKY_REGIONS) {
					try {
						assertSafeUrl(url);
						const bres = await stealthFetch(url);
						if (!bres.ok) throw new Error(`HTTP ${bres.status}`);
						const bj = (await bres.json()) as { states?: unknown[][] };
						const bstates: unknown[][] = bj.states ?? [];
						await storeRaw(src, layer, bres.status, {
							n: bstates.length,
						});
						for (const bs of bstates.slice(0, 100)) {
							const [bicao, bcs, , , , blon, blat, bbaro, , btrack] = bs;
							if (typeof blat !== "number" || typeof blon !== "number")
								continue;
							const bname =
								typeof bcs === "string" ? bcs.trim() : "";
							await storeNormalized({
								id: `${prefix}:${String(bicao)}`,
								ts: new Date().toISOString(),
								source: src,
								layer,
								title: bname || String(bicao),
								severity: "info",
								confidence: 0.75,
								lon: blon,
								lat: blat,
								entities: { hex: String(bicao) },
								meta: {
									alt_baro: bbaro,
									track: btrack,
									airline: airlineOf(bname),
								},
							});
							n++;
						}
						await markHealth(src, true);
					} catch (e: unknown) {
						await markHealth(src, false, `${src}: ${errMsg(e)}`);
					}
				}
			}
			return { ok: true, source: a.source, count: n };
		} catch (e: unknown) {
			lastError = `${a.source}: ${errMsg(e)}`;
			await markHealth(a.source, false, lastError);
		}
	}
	// adsb.fi military-interest sweep (keyless): last-resort metal picture.
	try {
		assertSafeUrl(ADSFI_URL);
		const res = await stealthFetch(ADSFI_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { ac?: unknown };
		const ac = z.array(Ac).parse(json.ac ?? []);
		await storeRaw("adsbfi", layer, res.status, { n: ac.length });
		let n = 0;
		for (const f of ac.slice(0, 300)) {
			if (f.lat == null || f.lon == null) continue;
			const cs = (f.flight ?? f.hex).trim() || f.hex;
			await storeNormalized({
				id: `adsbfi:${f.hex}`,
				ts: new Date().toISOString(),
				source: "adsbfi",
				layer,
				title: cs,
				severity: "info",
				confidence: 0.7,
				lon: f.lon,
				lat: f.lat,
				entities: { hex: f.hex },
				meta: { alt_baro: f.alt_baro, track: f.track, airline: airlineOf(cs) },
			});
			n++;
		}
		await markHealth("adsbfi", true);
		return { ok: true, source: "adsbfi", count: n };
	} catch (e: unknown) {
		lastError = `adsbfi: ${errMsg(e)}`;
		await markHealth("adsbfi", false, lastError);
	}
	return { ok: false, error: lastError };
}

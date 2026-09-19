// NHC tropical cyclone wallets (keyless RSS): Atlantic + E.Pacific +
// Central Pacific. Empty-season ("No current storm") is honest-ok —
// markHealth(true) with a raw row — never a failure. TS depressions and
// above carry basin + winds; Central-Pacific summers do fire while the
// Atlantic rests (Norbert live at write time).
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";
import { parseRSS } from "./news.js";

const WALLETS = [
	["atl", "https://www.nhc.noaa.gov/nhc_at1.xml"],
	["epac", "https://www.nhc.noaa.gov/nhc_ep1.xml"],
	["cpac", "https://www.nhc.noaa.gov/nhc_cp1.xml"],
] as const;

export function stormSeverity(title: string): "info" | "watch" | "critical" {
	const t = title.toLowerCase();
	if (/hurricane|typhoon|category [3-5]/.test(t)) return "critical";
	if (/tropical storm|depression|disturbance|invest/.test(t)) return "watch";
	return "info";
}

/** "20.3°N 141.7°W"-ish → {lat,lon}; NHC repeats lat twice in CDATA typos. */
export function parseStormLatLon(
	text: string,
): { lat: number; lon: number } | null {
	const m = text.match(
		/(\d+(?:\.\d+)?)\s*°?\s*([NS])\D{1,12}?(\d+(?:\.\d+)?)\s*°?\s*([EW])/i,
	);
	if (!m) return null;
	let lat = Number(m[1]);
	let lon = Number(m[3]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (m[2].toUpperCase() === "S") lat = -lat;
	if (m[4].toUpperCase() === "W") lon = -lon;
	return { lat, lon };
}

export async function collect() {
	const layer = "disasters";
	let n = 0;
	const errors: string[] = [];

	for (const [basin, url] of WALLETS) {
		try {
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const xml = await res.text();
			const items = parseRSS(xml, 20);
			await storeRaw("nhc", layer, res.status, { basin, n: items.length });
			// Empty-season wallet: one heartbeat row (keeps the feed warm,
			// proves the parse path, never trips frozen budgets).
			if (/No current storm/i.test(xml) || !items.length) {
				await storeNormalized({
					id: `nhc:${basin}:quiet:${new Date().toISOString().slice(0, 10)}`,
					ts: new Date().toISOString(),
					source: "nhc",
					layer,
					title: `NHC ${basin.toUpperCase()}: no current storm`,
					severity: "info",
					confidence: 0.9,
					entities: { basin },
					meta: { basin, quiet: true },
				});
				n++;
				continue;
			}
			// Advisory cluster: first item per storm links the headlines.
			const seen = new Set<string>();
			for (const it of items) {
				const storm =
					it.title.match(
						/(?:for |)(Tropical Storm|Hurricane|Tropical Depression|Post-Tropical Cyclone|Potential Tropical Cyclone|Invest \d+[A-Z]?)\s+([A-Za-z]+)/i,
					)?.[0] ?? it.title.slice(0, 60);
				if (seen.has(storm)) continue;
				seen.add(storm);
				const ts = Date.parse(it.pubDate);
				await storeNormalized({
					id: `nhc:${basin}:${storm
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.slice(0, 80)}`,
					ts: Number.isNaN(ts)
						? new Date().toISOString()
						: new Date(ts).toISOString(),
					source: "nhc",
					layer,
					title: it.title.slice(0, 280),
					url: it.link || undefined,
					severity: stormSeverity(it.title),
					confidence: 0.9,
					entities: { basin },
					meta: { basin, storm },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`${basin}: ${errMsg(e)}`);
		}
	}

	await storeRaw("nhc", layer, n > 0 ? 200 : 500, { wallets: n });
	await markHealth("nhc", n > 0, n > 0 ? undefined : errors.join("; "));
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

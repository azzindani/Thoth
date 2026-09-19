import { createHash } from "node:crypto";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// NASA FIRMS keyless 24h CSVs (osiris pattern: CSV needs no MAP_KEY, API does).
// VIIRS NOAA-20 global 24h is the densest; NOAA-21 + Suomi-NPP rungs next,
// MODIS C6 fallback. Probe-verified 2026-09-17 (N21 95k rows, NPP 83k rows,
// MODIS C61 path 404 — kept C6 which is the live one).
const URLS = [
	"https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv",
	"https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv",
	"https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv",
	"https://firms.modaps.eosdis.nasa.gov/data/active_fire/c6/csv/MODIS_C6_Global_24h.csv",
];

function parseCSV(text: string): Array<Record<string, string>> {
	const lines = text.trim().split("\n");
	if (lines.length < 2) return [];
	const head = lines[0].split(",");
	return lines.slice(1).map((l) => {
		const cells = l.split(",");
		const o: Record<string, string> = {};
		head.forEach((h, i) => {
			o[h.trim()] = (cells[i] ?? "").trim();
		});
		return o;
	});
}

export async function collect() {
	const source = "firms";
	const layer = "fires";
	let lastError = "";
	for (const url of URLS) {
		try {
			assertSafeUrl(url);
			const res = await stealthFetch(url, {}, 30000);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const text = await res.text();
			const rows = parseCSV(text);
			if (!rows.length) throw new Error("empty csv");
			await storeRaw(source, layer, res.status, {
				n: rows.length,
				feed: url.split("/").slice(-2, -1)[0],
			});
			let n = 0;
			for (const r of rows.slice(0, 500)) {
				const lat = parseFloat(r.latitude ?? "");
				const lon = parseFloat(r.longitude ?? "");
				if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
				const bright = parseFloat(r.bright_ti4 ?? r.brightness ?? "");
				await storeNormalized({
					id: `firms:${createHash("md5").update(`${r.latitude},${r.longitude},${r.acq_date},${r.acq_time}`).digest("hex")}`,
					ts: new Date().toISOString(),
					source,
					layer,
					title:
						`Fire ${r.acq_date ?? ""} ${Number.isNaN(bright) ? "" : `B${Math.round(bright)}`}`.trim(),
					severity: !Number.isNaN(bright) && bright > 400 ? "watch" : "info",
					confidence: 0.85,
					lon,
					lat,
					entities: {},
					meta: {
						bright_ti4: r.bright_ti4,
						brightness: r.brightness,
						confidence: r.confidence,
						satellite: r.satellite,
					},
				});
				n++;
			}
			await markHealth(source, true);
			return { ok: true, count: n };
		} catch (e: unknown) {
			lastError = `${url.split("/").slice(-2, -1)[0]}: ${errMsg(e)}`;
			await markHealth(source, false, lastError);
		}
	}
	return { ok: false, error: lastError };
}

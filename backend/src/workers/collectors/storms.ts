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

// JTWC (US Navy/USAF, keyless RSS): West Pacific, North Indian Ocean and
// Southern Hemisphere cyclones — the basins NHC does not cover. The RSS
// lists each active system with a link to its warning text; the position
// ("NEAR 12.3N 128.7E") and max winds come from that text.
const JTWC_RSS = "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss";

export type JtwcSystem = {
	kind: string;
	id: string;
	name: string;
	txt: string;
};

const SYS =
	/(Super Typhoon|Typhoon|Tropical Storm|Tropical Depression|Tropical Cyclone|Subtropical Storm)\s+(\d{2}[A-Z])(?:\s*\(([^)]+)\))?/gi;

function unesc(s: string): string {
	return s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&");
}

/** JTWC RSS → active systems, each with its warning-text URL (if linked). */
export function parseJtwcRss(xml: string): JtwcSystem[] {
	const html = unesc(xml);
	const hits = [...html.matchAll(SYS)];
	const out: JtwcSystem[] = [];
	const seen = new Set<string>();
	hits.forEach((m, i) => {
		const id = m[2].toUpperCase();
		if (seen.has(id)) return;
		seen.add(id);
		// The system's own chunk: up to the next system header.
		const chunk = html.slice(m.index, hits[i + 1]?.index ?? html.length);
		const txt =
			chunk.match(/href="([^"]+?web\.txt)"/i)?.[1] ??
			chunk.match(/href="([^"]+?\.txt)"/i)?.[1] ??
			"";
		out.push({ kind: m[1], id, name: (m[3] ?? "").trim(), txt });
	});
	return out;
}

/** Warning text → first fix position + max sustained winds (kt). */
export function parseJtwcWarning(text: string): {
	lat: number;
	lon: number;
	windKt: number | null;
} | null {
	const m = text.match(/NEAR\s+(\d+(?:\.\d+)?)([NS])\s+(\d+(?:\.\d+)?)([EW])/i);
	if (!m) return null;
	const lat = Number(m[1]) * (m[2].toUpperCase() === "S" ? -1 : 1);
	const lon = Number(m[3]) * (m[4].toUpperCase() === "W" ? -1 : 1);
	const w = text.match(/MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT/i);
	return { lat, lon, windKt: w ? Number(w[1]) : null };
}

async function collectJtwc(layer: string): Promise<number> {
	assertSafeUrl(JTWC_RSS);
	const res = await stealthFetch(JTWC_RSS);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const xml = await res.text();
	const systems = parseJtwcRss(xml);
	await storeRaw("jtwc", layer, res.status, { n: systems.length });
	const now = new Date().toISOString();
	if (!systems.length) {
		await storeNormalized({
			id: `jtwc:quiet:${now.slice(0, 10)}`,
			ts: now,
			source: "jtwc",
			layer,
			title: "JTWC: no current tropical cyclone warnings",
			severity: "info",
			confidence: 0.9,
			meta: { quiet: true },
		});
		return 1;
	}
	let n = 0;
	for (const s of systems) {
		let fix: ReturnType<typeof parseJtwcWarning> = null;
		if (s.txt) {
			try {
				assertSafeUrl(s.txt);
				const t = await stealthFetch(s.txt);
				if (t.ok) fix = parseJtwcWarning(await t.text());
			} catch {
				/* position is best-effort; the headline still stands */
			}
		}
		const hurricaneForce = (fix?.windKt ?? 0) >= 64;
		const label = `${s.kind} ${s.id}${s.name ? ` (${s.name})` : ""}`;
		await storeNormalized({
			id: `jtwc:${s.id.toLowerCase()}`,
			ts: now,
			source: "jtwc",
			layer,
			title: `JTWC · ${label}${fix?.windKt ? ` · ${fix.windKt} kt` : ""}`.slice(
				0,
				280,
			),
			url: s.txt || "https://www.metoc.navy.mil/jtwc/jtwc.html",
			severity: hurricaneForce ? "critical" : stormSeverity(s.kind),
			confidence: 0.9,
			lat: fix?.lat,
			lon: fix?.lon,
			entities: { basin: "jtwc" },
			meta: { storm: label, windKt: fix?.windKt ?? null },
		});
		n++;
	}
	return n;
}

export async function collect() {
	const layer = "disasters";
	let n = 0;
	const errors: string[] = [];
	try {
		const j = await collectJtwc(layer);
		n += j;
		await markHealth("jtwc", true);
	} catch (e: unknown) {
		errors.push(`jtwc: ${errMsg(e)}`);
		await markHealth("jtwc", false, errMsg(e));
	}
	const jtwcCount = n;

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

	const nhc = n - jtwcCount;
	const nhcErrors = errors.filter((e) => !e.startsWith("jtwc:"));
	await storeRaw("nhc", layer, nhc > 0 ? 200 : 500, { wallets: nhc });
	await markHealth("nhc", nhc > 0, nhc > 0 ? undefined : nhcErrors.join("; "));
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n, nhc, jtwc: jtwcCount };
}

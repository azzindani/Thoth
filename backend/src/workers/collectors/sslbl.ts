// abuse.ch SSLBL certificate blacklist (keyless CSV, CC0): SHA-1
// fingerprints of TLS certificates seen on malware C2 servers, with the
// malware family. One row per certificate listed in the last 7 days on the
// cyber layer (no geometry); older listings are pruned, so the layer shows
// the current week. (The companion IP list was frozen on 2025-01-03.)
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import {
	dbClock,
	errMsg,
	markHealth,
	pruneStale,
	storeNormalized,
	storeRaw,
} from "../lib/store.js";

const SOURCE = "sslbl";
const FEED_URL = "https://sslbl.abuse.ch/blacklist/sslblacklist.csv";
const WINDOW_MS = 7 * 86400_000;

export type SslblRow = { listed: string; sha1: string; reason: string };

/** `Listingdate,SHA1,Listingreason` rows (UTC, newest first) inside the
 * window. Comment lines start with `#`. */
export function sslblRows(csv: string, now = Date.now()): SslblRow[] {
	const out: SslblRow[] = [];
	for (const line of csv.split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		const [date, sha1, ...rest] = t.split(",");
		if (!/^[0-9a-f]{40}$/i.test(sha1 ?? "")) continue;
		const ts = Date.parse(`${date?.replace(" ", "T")}Z`);
		if (Number.isNaN(ts) || now - ts > WINDOW_MS) continue;
		out.push({
			listed: new Date(ts).toISOString(),
			sha1: sha1.toLowerCase(),
			reason: rest.join(",").trim(),
		});
	}
	return out;
}

export async function collect() {
	const layer = "cyber";
	try {
		const runStart = await dbClock();
		assertSafeUrl(FEED_URL);
		const res = await stealthFetch(FEED_URL, {}, 30_000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.text();
		// The header names the list; without it the file is not SSLBL.
		if (!body.includes("SSLBL")) throw new Error("unexpected payload");
		const rows = sslblRows(body);
		await storeRaw(SOURCE, layer, res.status, { n: rows.length });
		for (const r of rows) {
			const family = r.reason.replace(/\s*C&C$/i, "") || "malware";
			await storeNormalized({
				id: `sslbl:${r.sha1}`,
				ts: r.listed,
				source: SOURCE,
				layer,
				title: `${family} C2 TLS certificate ${r.sha1.slice(0, 16)}…`,
				url: `https://sslbl.abuse.ch/ssl-certificates/sha1/${r.sha1}/`,
				severity: "watch",
				confidence: 0.9,
				entities: { sha1: r.sha1, malware: family },
				meta: { reason: r.reason },
			});
		}
		// A quiet week lists nothing — honest, not an outage.
		await pruneStale(SOURCE, runStart);
		await markHealth(SOURCE, true);
		return { ok: true, count: rows.length };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

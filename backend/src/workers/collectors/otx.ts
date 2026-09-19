import { config } from "../../config.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// OTX AlienVault pulses (osiris pattern). THE only keyed source in Thoth:
// free signup key in OTX_API_KEY. Unset → honest disabled, zero fake data.
const URL = "https://otx.alienvault.com/api/v1/pulses/subscribed?limit=20";

export async function collect() {
	const source = "otx";
	const layer = "cyber";
	if (!config.OTX_API_KEY) {
		await markHealth(
			source,
			false,
			"disabled: OTX_API_KEY unset (free signup)",
		);
		return { ok: false, error: "disabled: OTX_API_KEY unset" };
	}
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL, {
			headers: { "X-OTX-API-KEY": config.OTX_API_KEY },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as { results?: unknown };
		const pulses = (Array.isArray(json.results) ? json.results : []) as {
			id?: string;
			name?: string;
			description?: string;
			modified?: string;
			tlp?: string;
		}[];
		await storeRaw(source, layer, res.status, { n: pulses.length });
		let n = 0;
		for (const p of pulses.slice(0, 20)) {
			if (!p.name) continue;
			const ts = Date.parse(p.modified ?? "");
			await storeNormalized({
				id: `otx:${String(p.id ?? p.name)}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source,
				layer,
				title: p.name.slice(0, 300),
				body: (p.description ?? "").slice(0, 300),
				severity: "watch",
				confidence: 0.85,
				entities: {},
				meta: { tlp: p.tlp },
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

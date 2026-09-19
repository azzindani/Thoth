// USGS HANS volcano alerts (keyless): alert_level + color_code for every
// monitored US volcano. Turns the `volcanoes` layer live — the static file
// only knew the cones, HANS knows which ones are restless right now.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const URL =
	"https://volcanoes.usgs.gov/hans-public/api/volcano/getMonitoredVolcanoes";

const Volc = z
	.object({
		volcano_name: z.string().optional(),
		vnum: z.string().nullable().optional(),
		alert_level: z.string().nullable().optional(),
		color_code: z.string().nullable().optional(),
		obs_abbr: z.string().nullable().optional(),
		notice_url: z.string().nullable().optional(),
	})
	.passthrough();

export function hansSeverity(
	color?: string | null,
	level?: string | null,
): "info" | "watch" | "critical" {
	const c = (color ?? "").toUpperCase();
	const l = (level ?? "").toUpperCase();
	if (c === "RED" || l === "WARNING") return "critical";
	if (c === "ORANGE" || l === "WATCH") return "watch";
	if (c === "YELLOW" || l === "ADVISORY") return "watch";
	return "info";
}

export async function collect() {
	const source = "hans";
	const layer = "volcanoes";
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = z.array(Volc).parse(await res.json());
		await storeRaw(source, layer, res.status, { n: rows.length });
		let n = 0;
		for (const v of rows) {
			if (!v.volcano_name) continue;
			const sev = hansSeverity(v.color_code, v.alert_level);
			// Quiet volcanoes: heartbeat-only rows keep the feed warm without
			// spamming the ticker — elevated ones carry full detail.
			await storeNormalized({
				id: `hans:${(v.vnum ?? v.volcano_name ?? "?").replace(/[^a-zA-Z0-9]+/g, "-")}`,
				ts: new Date().toISOString(),
				source,
				layer,
				title: `${v.volcano_name} — ${v.color_code ?? "?"} / ${v.alert_level ?? "?"}`,
				url: v.notice_url ?? undefined,
				severity: sev,
				confidence: 0.95,
				entities: {},
				meta: {
					color: v.color_code,
					level: v.alert_level,
					obs: v.obs_abbr,
					vnum: v.vnum,
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

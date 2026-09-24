// Volcano alert levels from the agencies that set them (keyless):
//   hans         USGS HANS: alert_level + color_code for every monitored US
//                volcano. Turns the `volcanoes` layer live — the static file
//                only knew the cones, HANS knows which are restless now.
//   jma-volcano  Japan Meteorological Agency eruption warnings: every
//                Japanese volcano above normal (Levels 1–5, near-crater and
//                sea-area warnings) at its summit. Current picture, pruned.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import {
	dbClock,
	errMsg,
	markHealth,
	pruneStale,
	storeNormalized,
	storeRaw,
} from "../lib/store.js";

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

async function collectHans(): Promise<number> {
	const source = "hans";
	const layer = "volcanoes";
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
	return n;
}

// ── JMA eruption warnings ───────────────────────────────────────────────
// warning.json: the latest warning event per volcano still above normal;
// the "対象火山" block names the volcano and its warning code.
// volcano_list.json: the 120 monitored volcanoes with summit lat/lon.
const JMA_WARNINGS = "https://www.jma.go.jp/bosai/volcano/data/warning.json";
const JMA_VOLCANOES =
	"https://www.jma.go.jp/bosai/volcano/const/volcano_list.json";
const JMA_PAGE = "https://www.jma.go.jp/bosai/volcano/";
/** JMA's English names for the warning codes it uses. */
const JMA_LEVELS: Record<string, string> = {
	"11": "Level 1 (potential for increased activity)",
	"12": "Level 2 (do not approach the crater)",
	"13": "Level 3 (do not approach the volcano)",
	"14": "Level 4 (prepare to evacuate)",
	"15": "Level 5 (evacuate)",
	"21": "potential for increased activity",
	"22": "near-crater warning",
	"23": "non-residential area warning",
	"36": "warning for the surrounding sea area",
};

const JmaEvent = z
	.object({
		reportDatetime: z.string().nullish(),
		volcanoInfos: z
			.array(
				z
					.object({
						type: z.string(),
						items: z.array(
							z
								.object({
									code: z.string().nullish(),
									name: z.string().nullish(),
									condition: z.string().nullish(),
									areas: z.array(
										z
											.object({ code: z.string(), name: z.string() })
											.passthrough(),
									),
								})
								.passthrough(),
						),
					})
					.passthrough(),
			)
			.nullish(),
	})
	.passthrough();
const JmaVolcano = z
	.object({
		code: z.string(),
		latlon: z.array(z.union([z.string(), z.number()])),
		name_en: z.string().nullish(),
	})
	.passthrough();

/** Level 4–5 and residential-area warnings are critical; Level 1 and the
 * plain "active volcano" notice are informational; the rest watch. */
export function jmaVolcanoSeverity(
	code: string,
	name = "",
): "critical" | "watch" | "info" {
	if (code === "14" || code === "15" || name.includes("居住地域"))
		return "critical";
	if (code === "11" || code === "21" || name.includes("留意")) return "info";
	return "watch";
}

export type JmaVolcanoRow = {
	code: string;
	volcano: string;
	warning: string;
	warningCode: string;
	condition: string | null;
	since: string | null;
};

/** warning.json → one entry per volcano from its "対象火山" block. */
export function jmaVolcanoRows(events: unknown): JmaVolcanoRow[] {
	const out = new Map<string, JmaVolcanoRow>();
	for (const raw of z.array(z.unknown()).parse(events)) {
		const e = JmaEvent.safeParse(raw);
		if (!e.success) continue;
		for (const vi of e.data.volcanoInfos ?? []) {
			if (!vi.type.includes("対象火山")) continue;
			for (const it of vi.items)
				for (const a of it.areas) {
					if (!it.code) continue;
					out.set(a.code, {
						code: a.code,
						volcano: a.name,
						warning: JMA_LEVELS[it.code] ?? it.name ?? it.code,
						warningCode: it.code,
						condition: it.condition ?? null,
						since: e.data.reportDatetime ?? null,
					});
				}
		}
	}
	return [...out.values()];
}

/** Summit positions are static: fetched once per worker life. */
let jmaSummits: Map<string, { lat: number; lon: number; name: string }> | null =
	null;

async function getJson(url: string) {
	assertSafeUrl(url);
	const res = await stealthFetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return { status: res.status, json: (await res.json()) as unknown };
}

async function collectJmaVolcano(): Promise<number> {
	const source = "jma-volcano";
	const layer = "volcanoes";
	const runStart = await dbClock();
	const w = await getJson(JMA_WARNINGS);
	const rows = jmaVolcanoRows(w.json);
	await storeRaw(source, layer, w.status, { n: rows.length });
	// Some Japanese volcano is always above normal (Sakurajima has not been
	// below Level 2 in years); an empty list means the format moved.
	if (!rows.length) throw new Error("no volcano warnings parsed");
	if (!jmaSummits) {
		// Three entries are groupings with no summit ("all/other/new active
		// volcanoes"): skipped, not a reason to reject the list.
		const list = z
			.array(z.unknown())
			.parse((await getJson(JMA_VOLCANOES)).json)
			.flatMap((x) => {
				const v = JmaVolcano.safeParse(x);
				return v.success ? [v.data] : [];
			});
		if (!list.length) throw new Error("no volcano positions");
		jmaSummits = new Map(
			list.map((v) => [
				v.code,
				{
					lat: Number(v.latlon[0]),
					lon: Number(v.latlon[1]),
					name: v.name_en ?? v.code,
				},
			]),
		);
	}
	for (const r of rows) {
		const at = jmaSummits.get(r.code);
		const ts = Date.parse(r.since ?? "");
		await storeNormalized({
			id: `jma-volcano:${r.code}`,
			ts: Number.isNaN(ts)
				? new Date().toISOString()
				: new Date(ts).toISOString(),
			source,
			layer,
			title: `${at?.name ?? r.volcano} — ${r.warning}`.slice(0, 300),
			url: JMA_PAGE,
			severity: jmaVolcanoSeverity(r.warningCode, r.warning),
			confidence: 0.95,
			lat: Number.isFinite(at?.lat) ? at?.lat : undefined,
			lon: Number.isFinite(at?.lon) ? at?.lon : undefined,
			entities: { agency: "Japan Meteorological Agency" },
			meta: {
				volcano: r.volcano,
				code: r.warningCode,
				condition: r.condition,
			},
		});
	}
	await pruneStale(source, runStart);
	return rows.length;
}

export async function collect() {
	let n = 0;
	const errors: string[] = [];
	for (const [source, leg] of [
		["hans", collectHans],
		["jma-volcano", collectJmaVolcano],
	] as const) {
		try {
			n += await leg();
			await markHealth(source, true);
		} catch (e: unknown) {
			errors.push(`${source}: ${errMsg(e)}`);
			await markHealth(source, false, errMsg(e));
		}
	}
	return errors.length < 2
		? { ok: true, count: n }
		: { ok: false, error: errors.join("; ") };
}

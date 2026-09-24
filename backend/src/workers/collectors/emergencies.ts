// IFRC GO emergencies (keyless JSON, goadmin.ifrc.org): every Red Cross /
// Red Crescent emergency that started in the last 90 days, on the
// disasters layer at the first affected country's capital. IFRC's own
// severity grades it (Red critical, Orange watch, Yellow info); an active
// Emergency Appeal — the international ask, bigger than a DREF — lifts
// Yellow to watch. Active appeals are joined on by event id for the funding
// picture. Current picture: events older than the window are pruned.
import { z } from "zod";
import { locateCountry } from "../lib/countries.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import {
	dbClock,
	errMsg,
	markHealth,
	pruneStale,
	storeNormalized,
	storeRaw,
} from "../lib/store.js";

const SOURCE = "ifrc-go";
const API = "https://goadmin.ifrc.org/api/v2";
const WINDOW_DAYS = 90;
const TIMEOUT_MS = 60_000;

const Country = z
	.object({ iso3: z.string().nullish(), name: z.string().nullish() })
	.passthrough();
const Event = z
	.object({
		id: z.number(),
		name: z.string(),
		disaster_start_date: z.string().nullish(),
		dtype: z.object({ name: z.string().nullish() }).passthrough().nullish(),
		countries: z.array(Country).nullish(),
		ifrc_severity_level: z.number().nullish(),
		ifrc_severity_level_display: z.string().nullish(),
		num_affected: z.number().nullish(),
		glide: z.string().nullish(),
		summary: z.string().nullish(),
	})
	.passthrough();
const Appeal = z
	.object({
		code: z.string().nullish(),
		event: z.number().nullish(),
		atype: z.number().nullish(),
		atype_display: z.string().nullish(),
		amount_requested: z.number().nullish(),
		amount_funded: z.number().nullish(),
		num_beneficiaries: z.number().nullish(),
	})
	.passthrough();
const Page = z.object({ results: z.array(z.unknown()) }).passthrough();

export type IfrcEvent = z.infer<typeof Event>;
export type IfrcAppeal = z.infer<typeof Appeal>;

/** IFRC appeal type 1 = Emergency Appeal (0 = DREF, 2 = Intl. appeal,
 * 3 = forecast-based action). */
const EMERGENCY_APPEAL = 1;

export function ifrcSeverity(
	level: number | null | undefined,
	appeals: IfrcAppeal[],
): "critical" | "watch" | "info" {
	if (level === 2) return "critical";
	if (level === 1) return "watch";
	return appeals.some((a) => a.atype === EMERGENCY_APPEAL) ? "watch" : "info";
}

/** "LBY: Pluvial/Flash Flood - 09-2026 - Sokna Flood " → without the
 * leading ISO code and trailing space. */
export const ifrcTitle = (name: string) =>
	name.replace(/^[A-Z]{3}:\s*/, "").trim();

const plain = (s: string) =>
	s
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();

function parse<T>(schema: z.ZodType<T>, j: unknown): T[] {
	return Page.parse(j).results.flatMap((x) => {
		const r = schema.safeParse(x);
		return r.success ? [r.data] : [];
	});
}

async function getJson(url: string) {
	assertSafeUrl(url);
	const res = await stealthFetch(url, {}, TIMEOUT_MS);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return { status: res.status, body: await res.json() };
}

export async function collect() {
	const layer = "disasters";
	try {
		const runStart = await dbClock();
		const since = new Date(Date.now() - WINDOW_DAYS * 86400_000)
			.toISOString()
			.slice(0, 10);
		const ev = await getJson(
			`${API}/event/?limit=200&ordering=-disaster_start_date&disaster_start_date__gte=${since}`,
		);
		const events = parse(Event, ev.body);
		// Funding is enrichment: an appeals outage still maps the events.
		let appeals: IfrcAppeal[] = [];
		let appealNote: string | null = null;
		try {
			appeals = parse(
				Appeal,
				(await getJson(`${API}/appeal/?status=0&limit=500`)).body,
			);
		} catch (e: unknown) {
			appealNote = `appeals: ${errMsg(e)}`;
		}
		await storeRaw(SOURCE, layer, ev.status, {
			events: events.length,
			appeals: appeals.length,
		});
		// Ninety days without a single emergency has not happened; an empty
		// list means the API or its filter changed.
		if (!events.length) throw new Error("no events in the window");
		const byEvent = new Map<number, IfrcAppeal[]>();
		for (const a of appeals)
			if (a.event != null)
				byEvent.set(a.event, [...(byEvent.get(a.event) ?? []), a]);
		for (const e of events) {
			const own = byEvent.get(e.id) ?? [];
			const names = (e.countries ?? [])
				.map((c) => c.name ?? "")
				.filter(Boolean);
			const at = names.map((n) => locateCountry(n)).find(Boolean);
			const requested = own.reduce((s, a) => s + (a.amount_requested ?? 0), 0);
			const funded = own.reduce((s, a) => s + (a.amount_funded ?? 0), 0);
			const ts = Date.parse(e.disaster_start_date ?? "");
			await storeNormalized({
				id: `ifrc-go:${e.id}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: SOURCE,
				layer,
				title: ifrcTitle(e.name).slice(0, 300),
				body: e.summary
					? plain(e.summary).slice(0, 2000) || undefined
					: undefined,
				url: `https://go.ifrc.org/emergencies/${e.id}`,
				severity: ifrcSeverity(e.ifrc_severity_level, own),
				confidence: 0.9,
				lon: at?.lon,
				lat: at?.lat,
				entities: {
					countries: names,
					iso3: (e.countries ?? []).map((c) => c.iso3).filter(Boolean),
				},
				meta: {
					type: e.dtype?.name ?? null,
					ifrcLevel: e.ifrc_severity_level_display ?? null,
					affected: e.num_affected ?? null,
					glide: e.glide || null,
					appeals: own.map((a) => ({
						code: a.code ?? null,
						type: a.atype_display ?? null,
						requestedChf: a.amount_requested ?? null,
						fundedChf: a.amount_funded ?? null,
						beneficiaries: a.num_beneficiaries ?? null,
					})),
					fundedPct:
						requested > 0 ? Math.round((funded / requested) * 100) : null,
				},
			});
		}
		await pruneStale(SOURCE, runStart);
		await markHealth(SOURCE, true, appealNote ?? undefined);
		return { ok: true, count: events.length };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

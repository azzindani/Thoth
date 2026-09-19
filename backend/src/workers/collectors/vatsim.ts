// VATSIM live virtual traffic (keyless, 2s refresh): ~1k connected pilots
// with lat/lon/altitude/speed + flight plans, plus controllers. The human
// air picture next to adsb/OpenSky metal. Sampled: airborne only, cap 400.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const URL = "https://data.vatsim.net/v3/vatsim-data.json";

const Pilot = z
	.object({
		cid: z.union([z.string(), z.number()]).optional(),
		callsign: z.string().optional(),
		latitude: z.number().optional(),
		longitude: z.number().optional(),
		altitude: z.number().optional(),
		groundspeed: z.number().optional(),
		heading: z.number().optional(),
		flight_plan: z
			.object({
				departure: z.string().nullable().optional(),
				arrival: z.string().nullable().optional(),
				aircraft_short: z.string().nullable().optional(),
			})
			.passthrough()
			.nullable()
			.optional(),
	})
	.passthrough();

const Feed = z.object({
	general: z
		.object({ connected_clients: z.number().optional() })
		.passthrough()
		.optional(),
	pilots: z.array(Pilot).optional(),
	controllers: z
		.array(z.object({ callsign: z.string().optional() }).passthrough())
		.optional(),
});

export async function collect() {
	const source = "vatsim";
	const layer = "flights";
	try {
		assertSafeUrl(URL);
		const res = await stealthFetch(URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const feed = Feed.parse(await res.json());
		const airborne = (feed.pilots ?? []).filter(
			(p) =>
				typeof p.latitude === "number" &&
				typeof p.longitude === "number" &&
				(p.altitude ?? 0) > 1000,
		);
		await storeRaw(source, layer, res.status, {
			clients: feed.general?.connected_clients,
			airborne: airborne.length,
		});
		let n = 0;
		for (const p of airborne.slice(0, 400)) {
			const fp = p.flight_plan;
			const route =
				fp?.departure && fp?.arrival ? `${fp.departure}→${fp.arrival}` : "";
			await storeNormalized({
				id: `vatsim:${p.callsign ?? p.cid}:${new Date().toISOString().slice(0, 16)}`,
				ts: new Date().toISOString(),
				source,
				layer,
				title:
					`${p.callsign ?? "?"} ${fp?.aircraft_short ?? ""} ${route} FL${Math.round((p.altitude ?? 0) / 100)}`.slice(
						0,
						280,
					),
				severity: "info",
				confidence: 0.85,
				lon: p.longitude,
				lat: p.latitude,
				entities: {},
				meta: {
					callsign: p.callsign,
					alt: p.altitude,
					gs: p.groundspeed,
					hdg: p.heading,
					dep: fp?.departure,
					arr: fp?.arrival,
				},
			});
			n++;
		}
		await markHealth(source, true);
		const ivao = await collectIvao(layer);
		return { ok: true, count: n + ivao };
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		const ivao = await collectIvao(layer);
		if (ivao > 0) return { ok: true, count: ivao };
		return { ok: false, error: errMsg(e) };
	}
}

// IVAO whazzup (keyless, VATSIM's sibling network): clients.pilots[] with
// lastTrack (lat/lon/alt/groundSpeed/onGround) + flightPlan legs.
const IVAO_URL = "https://api.ivao.aero/v2/tracker/whazzup";

const IvaoPilot = z
	.object({
		callsign: z.string().optional(),
		lastTrack: z
			.object({
				latitude: z.number().optional(),
				longitude: z.number().optional(),
				altitude: z.number().optional(),
				groundSpeed: z.number().optional(),
				onGround: z.boolean().optional(),
			})
			.passthrough()
			.nullable()
			.optional(),
		flightPlan: z
			.object({
				departureId: z.string().nullable().optional(),
				arrivalId: z.string().nullable().optional(),
				aircraftId: z.string().nullable().optional(),
			})
			.passthrough()
			.nullable()
			.optional(),
	})
	.passthrough();

async function collectIvao(layer: string): Promise<number> {
	try {
		assertSafeUrl(IVAO_URL);
		const res = await stealthFetch(IVAO_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as { clients?: { pilots?: unknown[] } };
		const pilots = z.array(IvaoPilot).parse(j.clients?.pilots ?? []);
		const airborne = pilots.filter(
			(p) =>
				p.lastTrack?.onGround !== true &&
				typeof p.lastTrack?.latitude === "number" &&
				typeof p.lastTrack?.longitude === "number" &&
				(p.lastTrack?.altitude ?? 0) > 1000,
		);
		await storeRaw("ivao", layer, res.status, { airborne: airborne.length });
		let n = 0;
		for (const p of airborne.slice(0, 300)) {
			const t = p.lastTrack;
			const fp = p.flightPlan;
			const route =
				fp?.departureId && fp?.arrivalId
					? `${fp.departureId}→${fp.arrivalId}`
					: "";
			await storeNormalized({
				id: `ivao:${p.callsign ?? "?"}:${new Date().toISOString().slice(0, 16)}`,
				ts: new Date().toISOString(),
				source: "ivao",
				layer,
				title:
					`${p.callsign ?? "?"} ${fp?.aircraftId ?? ""} ${route} FL${Math.round((t?.altitude ?? 0) / 100)}`.slice(
						0,
						280,
					),
				severity: "info",
				confidence: 0.8,
				lon: t?.longitude,
				lat: t?.latitude,
				entities: {},
				meta: {
					callsign: p.callsign,
					alt: t?.altitude,
					gs: t?.groundSpeed,
					dep: fp?.departureId,
					arr: fp?.arrivalId,
				},
			});
			n++;
		}
		await markHealth("ivao", true);
		return n;
	} catch (e: unknown) {
		await markHealth("ivao", false, errMsg(e));
		return 0;
	}
}

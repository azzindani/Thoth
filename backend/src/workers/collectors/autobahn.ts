// German Autobahn API (keyless, BMDV): roadworks with coords + closure
// flags on curated corridors → `disasters` (ground-logistics leg). German
// descriptions kept raw in body — location + blocked flag are the signal.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// North-south + east-west arteries through theater-adjacent corridors.
const ROADS = ["A1", "A2", "A3", "A5", "A7", "A8", "A9"];

const Work = z
	.object({
		identifier: z.string().optional(),
		title: z.string().nullable().optional(),
		subtitle: z.string().nullable().optional(),
		isBlocked: z.union([z.string(), z.boolean()]).nullable().optional(),
		future: z.boolean().nullable().optional(),
		description: z.array(z.string()).nullable().optional(),
		coordinate: z
			.object({ lat: z.number().optional(), long: z.number().optional() })
			.passthrough()
			.nullable()
			.optional(),
	})
	.passthrough();

export async function collect() {
	const source = "autobahn";
	const layer = "disasters";
	let n = 0;
	const errors: string[] = [];

	for (const road of ROADS) {
		try {
			const url = `https://verkehr.autobahn.de/o/autobahn/${road}/services/roadworks`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const j = (await res.json()) as { roadworks?: unknown };
			const works = z.array(Work).parse(j.roadworks ?? []);
			await storeRaw(source, layer, res.status, { road, n: works.length });
			for (const w of works.slice(0, 30)) {
				const lat = w.coordinate?.lat;
				const lon = w.coordinate?.long;
				const blocked =
					w.isBlocked === true ||
					String(w.isBlocked ?? "").toLowerCase() === "true";
				await storeNormalized({
					id: `autobahn:${road}:${String(
						w.identifier ?? w.title ?? Math.random(),
					)
						.replace(/[^a-zA-Z0-9-]+/g, "-")
						.slice(0, 100)}`,
					ts: new Date().toISOString(),
					source,
					layer,
					title:
						`${w.title ?? `${road} roadworks`}${blocked ? " — BLOCKED" : ""}`.slice(
							0,
							280,
						),
					body: [
						w.subtitle,
						(w.description ?? [])[1] ?? (w.description ?? [])[0],
					]
						.filter(Boolean)
						.join(" · ")
						.slice(0, 300),
					severity: blocked ? "watch" : "info",
					confidence: 0.8,
					lon: typeof lon === "number" ? lon : undefined,
					lat: typeof lat === "number" ? lat : undefined,
					entities: { country: "DEU" },
					meta: { road, blocked, future: w.future },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`${road}: ${errMsg(e)}`);
		}
	}

	await markHealth(
		source,
		n > 0,
		n > 0 ? undefined : errors.slice(0, 3).join("; "),
	);
	if (n === 0) return { ok: false, error: errors.slice(0, 5).join("; ") };
	return { ok: true, count: n };
}

import type express from "express";
import { z } from "zod";
import { query } from "../db/client.js";
import { log } from "../lib/logger.js";
import { countryNames, locateCountry } from "../workers/lib/countries.js";

// Country page (ROADMAP P5): one country, all layers. Anchored on the
// capital (lib/countries.ts): travel advisories (US + UK) and UNHCR
// displacement are stored at the capital; hazards, conflicts, outages and
// flights are counted within `radius_km` of it; news that names the
// country is matched by text. Capital + radius is coarse for very large
// countries — the radius is a parameter and the response says so.

const Q = z.object({
	q: z.string().trim().min(2).max(80),
	radius_km: z.coerce.number().min(50).max(2000).default(500),
});

export function registerCountry(app: express.Express): void {
	app.get("/api/country/list", (_req, res) => {
		res.json({ ok: true, items: countryNames() });
	});

	app.get("/api/country", async (req, res) => {
		const p = Q.safeParse(req.query);
		if (!p.success) {
			res.status(400).json({ ok: false, error: "q (country name) required" });
			return;
		}
		const where = locateCountry(p.data.q);
		if (!where) {
			res
				.status(404)
				.json({ ok: false, error: `unknown country: ${p.data.q}` });
			return;
		}
		const name = where.key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
		const pt = `ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography`;
		const args = [where.lon, where.lat];
		try {
			const [anchored, counts, items, mentions] = await Promise.all([
				// Advisories and displacement sit on the capital itself.
				query<{
					layer: string;
					source: string;
					title: string;
					severity: string;
					ts: string;
					url: string | null;
					meta: Record<string, unknown>;
				}>(
					// Newest row per issuer: one US, one UK advisory, one UNHCR line.
					`SELECT DISTINCT ON (layer, source)
					        layer, source, title, severity, ts, url, meta FROM events
					  WHERE layer IN ('advisories', 'displacement') AND geom IS NOT NULL
					    AND ST_DWithin(geom::geography, ${pt}, 30000)
					  ORDER BY layer, source, ts DESC`,
					args,
				),
				query<{ layer: string; n: number; critical: number; watch: number }>(
					`SELECT layer, count(*)::int AS n,
					        count(*) FILTER (WHERE severity = 'critical')::int AS critical,
					        count(*) FILTER (WHERE severity = 'watch')::int AS watch
					   FROM events
					  WHERE geom IS NOT NULL AND source <> 'static'
					    AND layer NOT IN ('advisories', 'displacement')
					    AND ts > now() - interval '7 days'
					    AND ST_DWithin(geom::geography, ${pt}, $3 * 1000)
					    AND NOT EXISTS (SELECT 1 FROM event_dups d WHERE d.id = events.id)
					  GROUP BY layer ORDER BY count(*) DESC`,
					[...args, p.data.radius_km],
				),
				query(
					`SELECT id, ts, source, layer, title, url, severity,
					        ST_AsGeoJSON(geom)::json AS geom
					   FROM events
					  WHERE geom IS NOT NULL AND source <> 'static'
					    AND severity IN ('critical', 'watch')
					    AND layer NOT IN ('advisories', 'displacement')
					    AND ts > now() - interval '7 days'
					    AND ST_DWithin(geom::geography, ${pt}, $3 * 1000)
					    AND NOT EXISTS (SELECT 1 FROM event_dups d WHERE d.id = events.id)
					  ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, ts DESC
					  LIMIT 60`,
					[...args, p.data.radius_km],
				),
				// Wire stories that name the country, wherever they are pinned.
				query(
					`SELECT id, ts, source, layer, title, url, severity,
					        ST_AsGeoJSON(geom)::json AS geom
					   FROM events
					  WHERE layer IN ('news', 'telegram', 'policy', 'health')
					    AND ts > now() - interval '3 days'
					    AND title ~* ('\\m' || $1 || '\\M')
					  ORDER BY ts DESC LIMIT 30`,
					[name.replace(/[^A-Za-z .'-]/g, "")],
				),
			]);
			res.json({
				ok: true,
				country: { name, lat: where.lat, lon: where.lon },
				anchor: "capital",
				radius_km: p.data.radius_km,
				advisories: anchored.filter((r) => r.layer === "advisories"),
				displacement: anchored.find((r) => r.layer === "displacement") ?? null,
				counts,
				items,
				mentions,
			});
		} catch (e: unknown) {
			log.error("country failed", { error: String(e) });
			res.status(500).json({ ok: false, error: "country query failed" });
		}
	});
}

import { z } from "zod";

// Request schemas shared by the routes (validation) and the OpenAPI
// document (openapi.ts), so the published spec is the validation itself.
// `.describe()` texts become the parameter descriptions.

export { LayerParams } from "./shared.js";

/** Camera view for map slices: zoom + optional bbox "w,s,e,n" (w > e
 * crosses the antimeridian). */
export const ViewParams = z.object({
	z: z.coerce
		.number()
		.min(0)
		.max(24)
		.optional()
		.describe("Map zoom. With it, the response is a viewport slice."),
	bbox: z
		.string()
		.max(120)
		.transform((s) => s.split(",").map(Number))
		.refine(
			(b) =>
				b.length === 4 &&
				b.every(Number.isFinite) &&
				b[0] >= -180 &&
				b[2] <= 180 &&
				b[1] >= -90 &&
				b[3] <= 90 &&
				b[1] < b[3] &&
				b[0] <= 180 &&
				b[2] >= -180,
		)
		.transform((b) => b as [number, number, number, number])
		.optional()
		.describe("Viewport `w,s,e,n` in degrees; w > e crosses the antimeridian."),
});

export const HistoryParams = z.object({
	layer: z.string().min(1).max(64),
	bucket: z.enum(["hour", "day"]).default("day"),
	from: z.string().datetime({ offset: true }).optional(),
	to: z.string().datetime({ offset: true }).optional(),
});

export const DossierParams = z.object({
	lat: z.coerce.number().min(-90).max(90),
	lon: z.coerce
		.number()
		.min(-180)
		.max(180)
		.describe("Longitude (`lng` is accepted too)."),
	radius_km: z.coerce.number().min(1).max(1000).default(100),
});

// Area watches carry a circle (lat/lon/radius_km) or a GeoJSON polygon;
// the other kinds are matched on text, layer or severity.
const Polygon = z.object({
	type: z.enum(["Polygon", "MultiPolygon"]),
	coordinates: z.array(z.unknown()).min(1),
});
export const WatchParams = z.discriminatedUnion("kind", [
	z.object({
		kind: z.enum(["keyword", "layer", "severity"]),
		value: z.string().trim().min(1).max(200),
		note: z.string().trim().max(500).optional().default(""),
	}),
	z.object({
		kind: z.literal("area"),
		value: z.string().trim().min(1).max(200),
		note: z.string().trim().max(500).optional().default(""),
		lat: z.number().min(-90).max(90).optional(),
		lon: z.number().min(-180).max(180).optional(),
		radius_km: z.number().positive().max(2000).optional(),
		geom: Polygon.optional(),
	}),
]);

/** Analyst-owned object names (portfolios, screens). */
export const Slug = z
	.string()
	.trim()
	.min(1)
	.max(80)
	.regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/);

export const PortfolioBody = z.object({
	name: Slug,
	note: z.string().max(500).default(""),
});

export const PositionBody = z.object({
	symbol: z
		.string()
		.trim()
		.min(1)
		.max(12)
		.regex(/^[A-Za-z0-9.^=-]+$/),
	qty: z.coerce.number().finite(),
	avg_price: z.coerce.number().finite().optional(),
	note: z.string().max(300).default(""),
});

export const NoteParams = z.object({
	title: z.string().trim().min(1).max(200),
	body: z.string().max(8000).default(""),
	category: z
		.enum(["idea", "earnings", "risk", "macro", "watch", "place"])
		.default("idea"),
	tickers: z.string().max(200).default(""),
	sentiment: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]).default("NEUTRAL"),
	favorite: z.coerce.boolean().default(false),
	// Map notes: optionally pinned to a place (both or neither).
	lat: z.number().min(-90).max(90).optional(),
	lon: z.number().min(-180).max(180).optional(),
});

export const ScreenParams = z.object({
	name: Slug,
	spec: z.record(z.unknown()).default({}),
});

export const CountryParams = z.object({
	q: z.string().trim().min(2).max(80).describe("Country name."),
	radius_km: z.coerce.number().min(50).max(2000).default(500),
});

export const SanctionsParams = z.object({
	query: z.string().trim().min(1).max(200),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GeoParams = z.object({
	lat: z.coerce.number().min(-90).max(90),
	lng: z.coerce.number().min(-180).max(180),
});

export const IpParams = z.object({
	host: z
		.string()
		.trim()
		.min(1)
		.max(253)
		.regex(/^[a-zA-Z0-9.:-]+$/)
		.describe("IP address or hostname."),
});

export const DnsParams = z.object({
	q: z.string().trim().min(1).max(253).describe("Domain or IP."),
});

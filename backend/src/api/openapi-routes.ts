import { z } from "zod";
import {
	CountryParams,
	DnsParams,
	DossierParams,
	GeoParams,
	HistoryParams,
	IpParams,
	LayerParams,
	NoteParams,
	PortfolioBody,
	PositionBody,
	SanctionsParams,
	ScreenParams,
	ViewParams,
	WatchParams,
} from "./schemas.js";

// The route catalog behind the OpenAPI document (openapi.ts). Routes that
// validate with zod reuse their schemas from schemas.ts; for the rest, the
// query shape here documents what the handler reads. test/openapi.test.ts
// fails when a route is registered without an entry here, or vice versa.

export type RouteDoc = {
	method: "get" | "post" | "delete";
	path: string;
	tag: string;
	summary: string;
	description?: string;
	query?: z.AnyZodObject;
	body?: z.ZodTypeAny;
	/** text/event-stream */
	stream?: boolean;
	/** text/plain */
	text?: boolean;
	/** a live upstream lookup: 502 when it fails */
	upstream?: boolean;
};

const s = (description: string, max = 200) =>
	z.string().min(1).max(max).describe(description);
const opt = (description: string, max = 200) =>
	z.string().max(max).optional().describe(description);
const num = (description: string) => z.coerce.number().describe(description);
const q = (description: string) =>
	z.object({ q: s(`${description} Also accepted as \`query\`.`) });
const lat = z.coerce.number().min(-90).max(90).describe("Latitude");
const lon = z.coerce.number().min(-180).max(180).describe("Longitude");
const latLon = z.object({
	lat,
	lon: lon.describe("Longitude (`lng` is accepted too)"),
});
const dohQuery = z.object({
	name: s("Domain name", 253),
	type: z.string().max(10).default("A").describe("Record type"),
});
const id = (d: string) => z.object({ id: s(d, 64) });

const get = (
	path: string,
	tag: string,
	summary: string,
	more: Partial<RouteDoc> = {},
): RouteDoc => ({ method: "get", path, tag, summary, ...more });
const lookup = (
	path: string,
	tag: string,
	summary: string,
	query: z.AnyZodObject,
): RouteDoc => get(path, tag, summary, { query, upstream: true });

const SYSTEM = "System";
const LAYERS = "Layers";
const INTEL = "Intelligence";
const WATCH = "Watches and notifications";
const SITREP = "Sitreps";
const WORK = "Analyst workspace";
const MON = "Monitor";
const NET = "OSINT: network";
const THREAT = "OSINT: threat intel";
const ORG = "OSINT: sanctions and companies";
const MOVE = "OSINT: transport";
const CRYPTO = "OSINT: crypto";
const GEO = "OSINT: geo";
const MACRO = "OSINT: macro";
const REF = "OSINT: research and reference";
const LIFE = "OSINT: life sciences";
const SOFT = "OSINT: software";

export const ROUTE_DOCS: RouteDoc[] = [
	// ── system ──
	get("/api/livez", SYSTEM, "Process liveness (no database)"),
	get("/api/readyz", SYSTEM, "Readiness: the database answers"),
	get("/api/health", SYSTEM, "Per-source freshness", {
		description:
			"last_ok, content_ts, lag, error, collector and interval per source.",
	}),
	get("/api/stats", SYSTEM, "Row counts per layer"),
	get("/api/versions", SYSTEM, "Layer versions; poll to find what changed"),
	get("/api/routes", SYSTEM, "Every registered route"),
	get("/api/openapi.json", SYSTEM, "This OpenAPI document"),
	get("/metrics", SYSTEM, "Prometheus metrics", { text: true }),
	get("/api/metrics", SYSTEM, "Prometheus metrics", { text: true }),
	get("/api/stream", SYSTEM, "Live Server-Sent Events", {
		stream: true,
		description:
			"Events: connected, snapshot, layer_changed, heartbeat. Resume with `known` (base64 JSON {layer: version}) or Last-Event-ID.",
		query: z.object({
			known: opt("base64 JSON {layer: version} to resume from", 20000),
		}),
	}),

	// ── layers ──
	get("/api/layers/:layer", LAYERS, "Layer slice", {
		description:
			"Without `z`: the newest 500 events. With `z`: a viewport slice with spatial sampling, plus matched, limit and truncated.",
		query: LayerParams.merge(ViewParams),
	}),
	get("/api/layers/:layer/history", LAYERS, "Event counts per time bucket", {
		query: HistoryParams,
	}),
	get(
		"/api/layers/:layer/export",
		LAYERS,
		"Download the layer (CSV or GeoJSON)",
		{
			query: LayerParams.extend({
				format: z.enum(["csv", "geojson"]).default("csv"),
			}),
		},
	),

	// ── intelligence ──
	get("/api/brief", INTEL, "Deterministic brief: counts and top items"),
	get("/api/event", INTEL, "One event with its provenance", {
		query: id("Event id"),
	}),
	get("/api/alerts", INTEL, "Critical and watch events in a window", {
		query: z.object({
			hours: z.coerce.number().min(1).max(168).default(24),
			limit: z.coerce.number().default(50),
		}),
	}),
	get("/api/dossier", INTEL, "Everything near a point", {
		description: "Events by layer, geo context and a threat score.",
		query: DossierParams,
	}),
	get("/api/country", INTEL, "Country page", { query: CountryParams }),
	get("/api/country/list", INTEL, "Known country names"),
	get("/api/theaters", INTEL, "Theatre presets (region, cities, feeds)"),
	get("/api/search", INTEL, "Full-text search over events", {
		query: z.object({
			q: s("Search text"),
			layer: opt("Restrict to one layer", 40),
			limit: z.coerce.number().int().min(1).max(200).default(50),
		}),
	}),
	lookup(
		"/api/imagery",
		INTEL,
		"Freshest low-cloud Sentinel-2 scene over a point",
		z.object({ lat, lon }),
	),
	get("/api/analytics/trend", INTEL, "Daily series with the sitrep archive", {
		query: z.object({
			layer: opt("Layer id", 64),
			days: z.coerce.number().min(1).max(90).default(14),
		}),
	}),

	// ── watches and notifications ──
	get("/api/watch", WATCH, "List watches"),
	{
		method: "post",
		path: "/api/watch",
		tag: WATCH,
		summary: "Create a watch",
		body: WatchParams,
	},
	{
		method: "delete",
		path: "/api/watch/:id",
		tag: WATCH,
		summary: "Delete a watch",
	},
	get("/api/watch/matches", WATCH, "Recent events matching any watch", {
		query: z.object({ limit: z.coerce.number().default(50) }),
	}),
	{
		method: "post",
		path: "/api/notify",
		tag: WATCH,
		summary: "Send a Telegram message",
		description: "Reports `disabled` without a bot token and chat id.",
		body: z.object({ text: s("Message text", 3500) }),
	},

	// ── sitreps ──
	{
		method: "post",
		path: "/api/sitrep",
		tag: SITREP,
		summary: "Build and archive today's sitrep",
	},
	get("/api/sitrep", SITREP, "Latest sitrep"),
	get("/api/sitrep/history", SITREP, "Archived sitreps", {
		query: z.object({ days: z.coerce.number().default(30) }),
	}),

	// ── analyst workspace ──
	get("/api/notes", WORK, "List notes", {
		query: z.object({ q: opt("Search title, body and tickers", 100) }),
	}),
	{
		method: "post",
		path: "/api/notes",
		tag: WORK,
		summary: "Create or update a note",
		body: NoteParams,
	},
	{
		method: "delete",
		path: "/api/notes/:id",
		tag: WORK,
		summary: "Delete a note",
	},
	get("/api/portfolios", WORK, "List portfolios with positions"),
	{
		method: "post",
		path: "/api/portfolios",
		tag: WORK,
		summary: "Create or update a portfolio",
		body: PortfolioBody,
	},
	{
		method: "delete",
		path: "/api/portfolios/:id",
		tag: WORK,
		summary: "Delete a portfolio",
	},
	{
		method: "post",
		path: "/api/portfolios/:id/positions",
		tag: WORK,
		summary: "Add or update a position",
		body: PositionBody,
	},
	{
		method: "delete",
		path: "/api/portfolios/:id/positions/:sym",
		tag: WORK,
		summary: "Delete a position",
	},
	get("/api/screens", WORK, "List saved market screens"),
	{
		method: "post",
		path: "/api/screens",
		tag: WORK,
		summary: "Save a market screen",
		body: ScreenParams,
	},
	{
		method: "delete",
		path: "/api/screens/:id",
		tag: WORK,
		summary: "Delete a market screen",
	},

	// ── monitor ──
	get(
		"/api/monitor/summary",
		MON,
		"Totals, source states, worker, database size",
	),
	get("/api/monitor/sources", MON, "Per-source statistics"),
	get(
		"/api/monitor/sources/:source",
		MON,
		"One source's recent runs and calls",
	),
	get("/api/monitor/collectors", MON, "Collector schedule and next-due times"),
	get("/api/monitor/endpoints", MON, "Upstream host statistics"),
	get(
		"/api/monitor/catalog",
		MON,
		"Source catalog: hosts, layer, cadence, key",
	),
	{
		method: "post",
		path: "/api/monitor/run/:collector",
		tag: MON,
		summary: "Queue an immediate collector run",
	},

	// ── OSINT: network ──
	lookup("/api/osint/ip", NET, "IP or host: geolocation and network", IpParams),
	lookup(
		"/api/osint/ipwhois",
		NET,
		"ipwhois.app: location, ASN and ISP",
		IpParams,
	),
	lookup(
		"/api/osint/asn",
		NET,
		"ASN and routing context (RIPEstat)",
		z.object({ q: s("AS number, IP or prefix") }),
	),
	lookup(
		"/api/osint/rdap",
		NET,
		"RDAP domain registration",
		z.object({ domain: s("Domain", 253) }),
	),
	lookup("/api/osint/dns", NET, "DNS records (HackerTarget)", DnsParams),
	lookup(
		"/api/osint/reverse",
		NET,
		"Hosts sharing an IP (HackerTarget)",
		DnsParams,
	),
	lookup("/api/osint/doh", NET, "DNS over HTTPS (Cloudflare)", dohQuery),
	lookup(
		"/api/osint/doh-cf",
		NET,
		"DNS over HTTPS (Cloudflare, third opinion)",
		dohQuery,
	),
	lookup("/api/osint/doh-google", NET, "DNS over HTTPS (Google)", dohQuery),
	lookup(
		"/api/osint/cert",
		NET,
		"Certificate-transparency subdomains (crt.sh)",
		z.object({ domain: s("Domain", 253) }),
	),
	lookup(
		"/api/osint/ports",
		NET,
		"Open ports, hostnames and vulns (Shodan InternetDB)",
		z.object({ host: s("IP address", 64) }),
	),
	lookup(
		"/api/osint/robtex",
		NET,
		"Reverse-IP and routing context (Robtex)",
		z.object({ host: s("IP address", 64) }),
	),

	// ── OSINT: threat intel ──
	lookup(
		"/api/osint/cve",
		THREAT,
		"CVE record or keyword search (NVD)",
		z.object({
			id: opt("CVE-YYYY-NNNN", 32),
			q: opt("Keyword (when no id)"),
		}),
	),
	lookup(
		"/api/osint/epss",
		THREAT,
		"Exploit probability (FIRST EPSS)",
		id("CVE id"),
	),
	lookup(
		"/api/osint/osv",
		THREAT,
		"OSV record: affected packages and fixes",
		id("CVE, GHSA or OSV id"),
	),
	lookup("/api/osint/circl", THREAT, "CIRCL CVE record", id("CVE id")),
	lookup("/api/osint/mitre-cve", THREAT, "MITRE CVE record", id("CVE id")),
	get("/api/osint/mitre", THREAT, "MITRE ATT&CK technique search", {
		query: z.object({ query: opt("Technique id or name", 100) }),
	}),
	lookup(
		"/api/osint/ghsa",
		THREAT,
		"GitHub Security Advisories",
		z.object({
			id: opt("GHSA or CVE id", 64),
			q: opt("Keyword (when no id)"),
		}),
	),
	lookup(
		"/api/osint/maltiverse",
		THREAT,
		"Hostname or IP reputation (Maltiverse)",
		z.object({
			host: opt("Hostname", 253),
			ip: opt("IP address", 64),
		}),
	),
	lookup(
		"/api/osint/maltsearch",
		THREAT,
		"Malware-family IOC search (Maltiverse)",
		q("Family or keyword."),
	),
	lookup(
		"/api/osint/urlscan",
		THREAT,
		"Recent urlscan.io scans for a domain",
		z.object({
			host: s("Domain (also accepted as `q` or `query`)", 253),
		}),
	),
	lookup(
		"/api/osint/stealers",
		THREAT,
		"Info-stealer exposure (Hudson Rock)",
		z.object({
			email: opt("Email address", 120),
			username: opt("Username (when no email)", 60),
		}),
	),
	lookup(
		"/api/osint/gravatar",
		THREAT,
		"Gravatar account and profile for an email",
		z.object({
			email: s("Email address", 120),
		}),
	),

	// ── OSINT: sanctions and companies ──
	get("/api/osint/sanctions", ORG, "Sanctions list search", {
		query: SanctionsParams,
	}),
	lookup(
		"/api/osint/company",
		ORG,
		"Company identity (GLEIF LEI)",
		q("Legal name."),
	),
	lookup(
		"/api/osint/sirene",
		ORG,
		"French company registry (INSEE Sirene)",
		z.object({
			q: s("Company name (also accepted as `name`)", 120),
		}),
	),
	lookup(
		"/api/osint/edgar",
		ORG,
		"SEC EDGAR full-text filing search",
		z.object({ q: s("Search text") }),
	),
	lookup(
		"/api/osint/fdic",
		ORG,
		"US bank search (FDIC)",
		q("Bank name or CERT."),
	),
	get("/api/osint/symbol", ORG, "Listed symbol directory", {
		query: z.object({
			q: opt("Name or symbol text"),
			sym: opt("Exact symbol", 16),
		}),
	}),
	lookup(
		"/api/osint/ror",
		ORG,
		"Research-organization identity (ROR)",
		q("Organization name."),
	),

	// ── OSINT: transport ──
	get(
		"/api/osint/aircraft",
		MOVE,
		"Aircraft registration: operator and category",
		{
			query: z.object({ reg: s("Registration", 16) }),
		},
	),
	get("/api/osint/airport", MOVE, "Airport by IATA or ICAO code", {
		query: z.object({ code: s("IATA or ICAO code", 4) }),
	}),
	get("/api/osint/vessel", MOVE, "Naval and notable vessels by name or MMSI", {
		query: z.object({ q: s("Name or MMSI", 80) }),
	}),
	lookup(
		"/api/osint/planespotter",
		MOVE,
		"Aircraft photos (PlaneSpotters)",
		z.object({
			hex: s(
				"ICAO 24-bit hex or registration (also accepted as `reg` or `q`)",
				20,
			),
		}),
	),
	lookup(
		"/api/osint/airspace",
		MOVE,
		"Drone airspace grids (FAA UAS Facility Map)",
		z.object({
			bbox: s("w,s,e,n in degrees", 120),
		}),
	),
	lookup(
		"/api/osint/transit",
		MOVE,
		"Swiss transit departures",
		z.object({
			station: s("Station name (also accepted as `q`)", 80),
		}),
	),

	// ── OSINT: crypto ──
	lookup(
		"/api/osint/btc",
		CRYPTO,
		"Bitcoin address balance and activity",
		z.object({
			address: s("Base58 or bech32 address", 80),
		}),
	),
	lookup(
		"/api/osint/token",
		CRYPTO,
		"DEX pairs for a token (DexScreener)",
		z.object({
			address: s("Token mint or address (also accepted as `addr`)", 80),
		}),
	),

	// ── OSINT: geo ──
	lookup("/api/osint/geo", GEO, "Reverse geocode and place context", GeoParams),
	lookup("/api/osint/geocode", GEO, "Reverse geocode (Photon)", latLon),
	lookup(
		"/api/osint/nominatim",
		GEO,
		"Place search (Nominatim)",
		q("Place name."),
	),
	lookup(
		"/api/osint/omgeo",
		GEO,
		"Place search (Open-Meteo geocoding)",
		q("Place name."),
	),
	lookup("/api/osint/daylight", GEO, "Sunrise and sunset at a point", latLon),
	lookup(
		"/api/osint/zip",
		GEO,
		"Postal code to place (Zippopotam)",
		z.object({
			country: z
				.string()
				.max(2)
				.default("us")
				.describe("ISO country code (also accepted as `cc`)"),
			code: s("Postal code (also accepted as `q`)", 16),
		}),
	),
	lookup(
		"/api/osint/holidays",
		GEO,
		"Public holidays (Nager.Date)",
		z.object({
			country: z
				.string()
				.max(2)
				.default("US")
				.describe("ISO country code (also accepted as `cc`)"),
			year: num("Year (default: the current year)").optional(),
		}),
	),

	// ── OSINT: macro ──
	lookup(
		"/api/osint/macro",
		MACRO,
		"Macro snapshot (World Bank)",
		z.object({
			country: s("ISO2 or ISO3 code (also accepted as `q`)", 3),
		}),
	),
	lookup(
		"/api/osint/macro-imf",
		MACRO,
		"Macro snapshot (IMF)",
		z.object({
			country: s("ISO2 or ISO3 code (also accepted as `q`)", 3),
		}),
	),

	// ── OSINT: research and reference ──
	lookup("/api/osint/wiki", REF, "Wikipedia summary", q("Title.")),
	lookup("/api/osint/wikidata", REF, "Wikidata entity search", q("Name.")),
	lookup(
		"/api/osint/books",
		REF,
		"Book search (Open Library)",
		q("Title or author."),
	),
	lookup("/api/osint/stack", REF, "Stack Exchange search", q("Search text.")),
	lookup(
		"/api/osint/funder",
		REF,
		"Research funder search (OpenAlex)",
		q("Funder name."),
	),
	lookup(
		"/api/osint/crfunder",
		REF,
		"Funder registry lookup (Crossref)",
		q("Funder name."),
	),
	lookup(
		"/api/osint/museum",
		REF,
		"Museum collections (AIC, the Met, Europeana)",
		q("Search text."),
	),
	lookup(
		"/api/osint/music",
		REF,
		"Release search (MusicBrainz)",
		q("Release title."),
	),
	lookup("/api/osint/nasa-img", REF, "NASA image search", q("Keyword.")),
	lookup(
		"/api/osint/sbdb",
		REF,
		"Small-body lookup (JPL SBDB)",
		q("Designation."),
	),
	lookup(
		"/api/osint/name",
		REF,
		"Name demographics: age, gender, nationality",
		z.object({
			name: s("First name (also accepted as `q`)", 60),
		}),
	),

	// ── OSINT: life sciences ──
	lookup("/api/osint/gene", LIFE, "Gene search (NCBI)", q("Gene symbol.")),
	lookup(
		"/api/osint/protein",
		LIFE,
		"Protein search (UniProt)",
		q("Gene or protein."),
	),
	lookup(
		"/api/osint/ontology",
		LIFE,
		"Ontology term search (EBI OLS)",
		q("Term."),
	),
	lookup(
		"/api/osint/chembl",
		LIFE,
		"Molecule lookup (ChEMBL)",
		q("Molecule name."),
	),
	lookup("/api/osint/rxnorm", LIFE, "Drug products (RxNorm)", q("Drug name.")),
	lookup(
		"/api/osint/fda-drug",
		LIFE,
		"Drug labels (openFDA)",
		q("Brand or generic name."),
	),
	lookup(
		"/api/osint/dailymed",
		LIFE,
		"Drug names (DailyMed)",
		q("Brand or generic name."),
	),
	lookup(
		"/api/osint/food",
		LIFE,
		"Food products (Open Food Facts)",
		q("Keyword."),
	),

	// ── OSINT: software ──
	lookup(
		"/api/osint/package",
		SOFT,
		"Package metadata (npm, PyPI, crates, gems)",
		z.object({
			eco: z.enum(["npm", "pypi", "crates", "gems"]).default("npm"),
			name: s("Package name (also accepted as `q`)", 214),
		}),
	),
	lookup(
		"/api/osint/deps",
		SOFT,
		"Dependency graph (deps.dev)",
		z.object({
			eco: s("Ecosystem (npm, pypi, go, maven, cargo, nuget)", 16),
			name: s("Package name", 214),
			version: s("Version", 64),
		}),
	),
	lookup(
		"/api/osint/npm-dl",
		SOFT,
		"npm weekly downloads",
		z.object({
			name: s("Package name (also accepted as `q`)", 214),
		}),
	),
	lookup(
		"/api/osint/github",
		SOFT,
		"GitHub repository or owner recon",
		z.object({
			q: s("owner/repo or owner", 140),
		}),
	),
];

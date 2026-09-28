// Provenance helpers: where a source lives and where an object can be
// checked independently. Every link here is to the publisher itself or to a
// public tracker keyed by the object's own identifier (ICAO hex, MMSI,
// NORAD id) — never a search that could land on something else.

/** Publisher home pages by source id. Keys ending in "*" match a prefix
 * (families like energy-charts-de, swpc-kp, tfl-arr-…). Unknown sources
 * get no link: better no link than a guessed one. */
const HOME: Record<string, string> = {
	"adsb.lol": "https://adsb.lol",
	adsbfi: "https://adsb.fi",
	opensky: "https://opensky-network.org",
	vatsim: "https://vatsim.net",
	ivao: "https://www.ivao.aero",
	"digitraffic*": "https://www.digitraffic.fi/en/",
	"celestrak*": "https://celestrak.org",
	"tle-mirror": "https://celestrak.org",
	"amsat*": "https://www.amsat.org",
	satnogs: "https://network.satnogs.org",
	spacedevs: "https://thespacedevs.com",
	rocketlive: "https://thespacedevs.com",
	"iss-*": "https://spotthestation.nasa.gov",
	usgs: "https://earthquake.usgs.gov",
	"usgs-*": "https://www.usgs.gov",
	emsc: "https://www.emseqc.org",
	geofon: "https://geofon.gfz.de",
	"geonet*": "https://www.geonet.org.nz",
	ingv: "https://terremoti.ingv.it",
	bmkg: "https://www.bmkg.go.id",
	"turkey-afad": "https://deprem.afad.gov.tr",
	"turkey-kandilli": "http://www.koeri.boun.edu.tr",
	jma: "https://www.jma.go.jp",
	"jma-*": "https://www.jma.go.jp",
	smithsonian: "https://volcano.si.edu",
	gdacs: "https://www.gdacs.org",
	eonet: "https://eonet.gsfc.nasa.gov",
	firms: "https://firms.modaps.eosdis.nasa.gov",
	nifc: "https://www.nifc.gov",
	calfire: "https://www.fire.ca.gov",
	"nsw-rfs": "https://www.rfs.nsw.gov.au",
	"vic-emv": "https://emergency.vic.gov.au",
	"qld-fire": "https://www.fire.qld.gov.au",
	"wa-dfes": "https://www.emergency.wa.gov.au",
	"act-esa": "https://esa.act.gov.au",
	nws: "https://www.weather.gov",
	"nws-*": "https://www.weather.gov",
	nhc: "https://www.nhc.noaa.gov",
	spc: "https://www.spc.noaa.gov",
	jtwc: "https://www.metoc.navy.mil/jtwc/jtwc.html",
	ptwc: "https://www.tsunami.gov",
	ntwc: "https://www.tsunami.gov",
	"swpc-*": "https://www.swpc.noaa.gov",
	"goes-xray": "https://www.swpc.noaa.gov",
	"silso*": "https://www.sidc.be/SILSO/",
	"awc*": "https://aviationweather.gov",
	"faa-nas": "https://nasstatus.faa.gov",
	"coops*": "https://tidesandcurrents.noaa.gov",
	ndbc: "https://www.ndbc.noaa.gov",
	nwis: "https://waterdata.usgs.gov",
	"open-meteo": "https://open-meteo.com",
	"openmeteo-*": "https://open-meteo.com",
	"om-flood": "https://open-meteo.com",
	"nasa-power": "https://power.larc.nasa.gov",
	"yr-*": "https://www.yr.no",
	brightsky: "https://brightsky.dev",
	"dwd-warn": "https://www.dwd.de",
	bom: "http://www.bom.gov.au",
	ipma: "https://www.ipma.pt",
	fmi: "https://en.ilmatieteenlaitos.fi",
	hko: "https://www.hko.gov.hk",
	"hko-warn": "https://www.hko.gov.hk",
	"eccc-alerts": "https://weather.gc.ca",
	"ea-floods": "https://check-for-flooding.service.gov.uk",
	mowas: "https://warnung.bund.de",
	katwarn: "https://www.katwarn.de",
	biwapp: "https://www.biwapp.de",
	"lhp-floods": "https://www.hochwasserzentralen.de",
	pegelonline: "https://www.pegelonline.wsv.de",
	rainviewer: "https://www.rainviewer.com",
	"rainviewer-ir": "https://www.rainviewer.com",
	safecast: "https://safecast.org",
	"bfs-odl": "https://odlinfo.bfs.de",
	luftdaten: "https://sensor.community",
	"sg-*": "https://data.gov.sg",
	"tfl-*": "https://tfl.gov.uk",
	"gbfs*": "https://gbfs.org",
	mbta: "https://www.mbta.com",
	"septa*": "https://www.septa.org",
	sncf: "https://www.sncf.com",
	"irail*": "https://irail.be",
	"swiss-*": "https://transport.opendata.ch",
	metrotransit: "https://www.metrotransit.org",
	neptun: "https://neptun.in.ua",
	"nga-msi": "https://msi.nga.mil",
	gpsjam: "https://gpsjam.org",
	"submarine-cables": "https://www.submarinecablemap.com",
	"copernicus-ems": "https://emergency.copernicus.eu",
	reliefweb: "https://reliefweb.int",
	ocha: "https://www.unocha.org",
	unhcr: "https://www.unhcr.org",
	"hdx*": "https://data.humdata.org",
	ifrc: "https://www.ifrc.org",
	"ifrc-go": "https://go.ifrc.org",
	who: "https://www.who.int",
	"who-*": "https://www.who.int",
	ecdc: "https://www.ecdc.europa.eu",
	fema: "https://www.fema.gov",
	"state-travel": "https://travel.state.gov",
	"uk-fcdo": "https://www.gov.uk/foreign-travel-advice",
	gdelt: "https://www.gdeltproject.org",
	bbc: "https://www.bbc.com/news",
	aljazeera: "https://www.aljazeera.com",
	dw: "https://www.dw.com",
	france24: "https://www.france24.com",
	guardian: "https://www.theguardian.com",
	"nyt-world": "https://www.nytimes.com/section/world",
	defenseone: "https://www.defenseone.com",
	breakingdef: "https://breakingdefense.com",
	telegram: "https://telegram.org",
	"cisa-kev": "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
	"cert-fr": "https://www.cert.ssi.gouv.fr",
	"cert-eu": "https://cert.europa.eu",
	cccs: "https://www.cyber.gc.ca",
	jpcert: "https://www.jpcert.or.jp",
	"enisa-euvd": "https://euvd.enisa.europa.eu",
	ghsa: "https://github.com/advisories",
	msrc: "https://msrc.microsoft.com",
	urlhaus: "https://urlhaus.abuse.ch",
	threatfox: "https://threatfox.abuse.ch",
	feodo: "https://feodotracker.abuse.ch",
	sslbl: "https://sslbl.abuse.ch",
	bazaar: "https://bazaar.abuse.ch",
	otx: "https://otx.alienvault.com",
	"dshield*": "https://www.dshield.org",
	"sans-isc": "https://isc.sans.edu",
	openphish: "https://openphish.com",
	ransomware: "https://www.ransomware.live",
	ioda: "https://ioda.inetintel.cc.gatech.edu",
	ooni: "https://explorer.ooni.org",
	"tor-onionoo": "https://metrics.torproject.org",
	opensanctions: "https://www.opensanctions.org",
	fedreg: "https://www.federalregister.gov",
	govtrack: "https://www.govtrack.us",
	"energy-charts*": "https://www.energy-charts.info",
	"carbon-uk*": "https://carbonintensity.org.uk",
	arxiv: "https://arxiv.org",
	pubmed: "https://pubmed.ncbi.nlm.nih.gov",
	"pubmed-*": "https://pubmed.ncbi.nlm.nih.gov",
	medrxiv: "https://www.medrxiv.org",
	coingecko: "https://www.coingecko.com",
	"cg-*": "https://www.coingecko.com",
	yahoo: "https://finance.yahoo.com",
	polymarket: "https://polymarket.com",
	kalshi: "https://kalshi.com",
};

export function sourceHome(source: string): string | null {
	if (!source) return null;
	if (HOME[source]) return HOME[source];
	let best: [number, string] | null = null;
	for (const [k, v] of Object.entries(HOME)) {
		if (!k.endsWith("*")) continue;
		const pre = k.slice(0, -1);
		if (source.startsWith(pre) && (!best || pre.length > best[0]))
			best = [pre.length, v];
	}
	return best?.[1] ?? null;
}

/** "earthquake.usgs.gov" from a record URL; null when not a web link. */
export function hostOf(url: string | undefined | null): string | null {
	if (!url || !/^https?:\/\//.test(url)) return null;
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return null;
	}
}

export type VerifyLink = { label: string; href: string };

type Obj = {
	id?: string;
	layer?: string;
	title?: string;
	lat?: number;
	lon?: number;
};

const HEX = /^[0-9a-f]{6}$/i;

/** Independent places to check this object, keyed by its own identifier,
 * then the spot itself on two public maps. */
export function verifyLinks(p: Obj): VerifyLink[] {
	const out: VerifyLink[] = [];
	const id = String(p.id ?? "");
	const [prefix, ...rest] = id.split(":");
	const key = rest.join(":");
	if (p.layer === "flights") {
		// adsb:<hex>, adsbfi:<hex>, opensky:<icao24> — the transponder address
		if (HEX.test(key))
			out.push({
				label: "ADS-B Exchange",
				href: `https://globe.adsbexchange.com/?icao=${key.toLowerCase()}`,
			});
		const cs = String(p.title ?? "")
			.trim()
			.split(/\s+/)[0];
		if (
			/^[A-Z]{2,4}\d[A-Z0-9]{0,4}$/.test(cs) &&
			prefix !== "vatsim" &&
			prefix !== "ivao"
		)
			out.push({
				label: "FlightAware",
				href: `https://www.flightaware.com/live/flight/${cs}`,
			});
	}
	if (p.layer === "vessels") {
		const mmsi = id.match(/(\d{9})$/)?.[1];
		if (mmsi)
			out.push(
				{
					label: "MarineTraffic",
					href: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}`,
				},
				{
					label: "VesselFinder",
					href: `https://www.vesselfinder.com/vessels/details/${mmsi}`,
				},
			);
	}
	if (p.layer === "satellites" && /^(sat|amsat-tle)$/.test(prefix)) {
		const norad = key.match(/^\d{1,6}$/)?.[0];
		if (norad)
			out.push(
				{ label: "N2YO", href: `https://www.n2yo.com/satellite/?s=${norad}` },
				{
					label: "CelesTrak",
					href: `https://celestrak.org/satcat/table-satcat.php?CATNR=${norad}`,
				},
			);
	}
	const lat = Number(p.lat);
	const lon = Number(p.lon);
	if (Number.isFinite(lat) && Number.isFinite(lon)) {
		const la = lat.toFixed(5);
		const lo = lon.toFixed(5);
		out.push(
			{
				label: "OpenStreetMap",
				href: `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=13/${la}/${lo}`,
			},
			{
				label: "Google Maps",
				href: `https://www.google.com/maps/search/?api=1&query=${la},${lo}`,
			},
		);
	}
	return out;
}

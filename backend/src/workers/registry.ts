export const COLLECTORS = {
	quakes: { module: "./collectors/quakes.js", intervalSec: 60, ttlSec: 300 },
	flights: {
		module: "./collectors/flights.js",
		intervalSec: 900,
		ttlSec: 1800,
	},
	gdelt: { module: "./collectors/gdelt.js", intervalSec: 300, ttlSec: 3600 },
	news: { module: "./collectors/news.js", intervalSec: 300, ttlSec: 3600 },
	gdacs: { module: "./collectors/gdacs.js", intervalSec: 600, ttlSec: 3600 },
	cyber: { module: "./collectors/cyber.js", intervalSec: 900, ttlSec: 3600 },
	oceans: { module: "./collectors/oceans.js", intervalSec: 600, ttlSec: 3600 },
	relief: { module: "./collectors/relief.js", intervalSec: 300, ttlSec: 3600 },
	radiation: {
		module: "./collectors/radiation.js",
		intervalSec: 900,
		ttlSec: 3600,
	},
	volcanoes: {
		module: "./collectors/volcanoes.js",
		intervalSec: 86400,
		ttlSec: 172800,
	},
	drones: { module: "./collectors/drones.js", intervalSec: 120, ttlSec: 600 },
	conflicts: {
		module: "./collectors/conflicts.js",
		intervalSec: 600,
		ttlSec: 3600,
	},
	otx: { module: "./collectors/otx.js", intervalSec: 1800, ttlSec: 3600 },
	finnhub: {
		module: "./collectors/finnhub.js",
		intervalSec: 21600,
		ttlSec: 86400,
	},
	fx: { module: "./collectors/fx.js", intervalSec: 21600, ttlSec: 86400 },
	airquality: {
		module: "./collectors/airquality.js",
		intervalSec: 1800,
		ttlSec: 3600,
	},
	satellites: {
		module: "./collectors/satellites.js",
		intervalSec: 600,
		ttlSec: 900,
	},
	telegram: {
		module: "./collectors/telegram.js",
		intervalSec: 60,
		ttlSec: 600,
	},
	fires: { module: "./collectors/fires.js", intervalSec: 600, ttlSec: 3600 },
	disasters: {
		module: "./collectors/disasters.js",
		intervalSec: 600,
		ttlSec: 3600,
	},
	markets: { module: "./collectors/markets.js", intervalSec: 600, ttlSec: 900 },
	weather: { module: "./collectors/weather.js", intervalSec: 300, ttlSec: 900 },
	spacewx: { module: "./collectors/spacewx.js", intervalSec: 300, ttlSec: 900 },
	cctv: { module: "./collectors/cctv.js", intervalSec: 600, ttlSec: 1200 },
	sanctions: {
		module: "./collectors/sanctions.js",
		intervalSec: 86400,
		ttlSec: 172800,
	},
	perims: { module: "./collectors/perims.js", intervalSec: 1800, ttlSec: 3600 },
	airwx: { module: "./collectors/airwx.js", intervalSec: 900, ttlSec: 1800 },
	fema: { module: "./collectors/fema.js", intervalSec: 21600, ttlSec: 86400 },
	ioda: { module: "./collectors/ioda.js", intervalSec: 600, ttlSec: 3600 },
	ooni: { module: "./collectors/ooni.js", intervalSec: 3600, ttlSec: 7200 },
	metar: { module: "./collectors/metar.js", intervalSec: 900, ttlSec: 1800 },
	forecast: {
		module: "./collectors/forecast.js",
		intervalSec: 10800,
		ttlSec: 21600,
	},
	sentiment: {
		module: "./collectors/sentiment.js",
		intervalSec: 21600,
		ttlSec: 86400,
	},
	research: {
		module: "./collectors/research.js",
		intervalSec: 21600,
		ttlSec: 86400,
	},
	health: {
		module: "./collectors/health-who.js",
		intervalSec: 604800,
		ttlSec: 1209600,
	},
	hdx: { module: "./collectors/hdx.js", intervalSec: 86400, ttlSec: 172800 },
	policy: {
		module: "./collectors/policy-fedreg.js",
		intervalSec: 86400,
		ttlSec: 172800,
	},
	crypto: {
		module: "./collectors/crypto.js",
		intervalSec: 1800,
		ttlSec: 3600,
	},
	solar: {
		module: "./collectors/solar.js",
		intervalSec: 3600,
		ttlSec: 7200,
	},
	fxdepth: {
		module: "./collectors/fxdepth.js",
		intervalSec: 21600,
		ttlSec: 86400,
	},
	quakesnz: {
		module: "./collectors/quakes-nz.js",
		intervalSec: 300,
		ttlSec: 900,
	},
	predict: {
		module: "./collectors/predict.js",
		intervalSec: 21600,
		ttlSec: 86400,
	},
	radar: {
		module: "./collectors/radar.js",
		intervalSec: 1800,
		ttlSec: 3600,
	},
	energyuk: {
		module: "./collectors/energy-uk.js",
		intervalSec: 3600,
		ttlSec: 7200,
	},
	litwatch: {
		module: "./collectors/litwatch.js",
		intervalSec: 21600,
		ttlSec: 86400,
	},
	storms: {
		module: "./collectors/storms.js",
		intervalSec: 1800,
		ttlSec: 3600,
	},
	rivers: {
		module: "./collectors/rivers.js",
		intervalSec: 3600,
		ttlSec: 7200,
	},
	imf: { module: "./collectors/imf.js", intervalSec: 604800, ttlSec: 1209600 },
	vatsim: { module: "./collectors/vatsim.js", intervalSec: 300, ttlSec: 600 },
	hans: { module: "./collectors/hans.js", intervalSec: 3600, ttlSec: 7200 },
	autobahn: {
		module: "./collectors/autobahn.js",
		intervalSec: 21600,
		ttlSec: 43200,
	},
	quakesasia: {
		module: "./collectors/quakes-asia.js",
		intervalSec: 300,
		ttlSec: 900,
	},
	civic: {
		module: "./collectors/civic.js",
		intervalSec: 21600,
		ttlSec: 43200,
	},
	energyeu: {
		module: "./collectors/energy-eu.js",
		intervalSec: 3600,
		ttlSec: 7200,
	},
	social: {
		module: "./collectors/social.js",
		intervalSec: 3600,
		ttlSec: 7200,
	},
	transit: {
		module: "./collectors/transit.js",
		intervalSec: 1800,
		ttlSec: 3600,
	},
	navwarn: {
		module: "./collectors/navwarn.js",
		intervalSec: 1800,
		ttlSec: 3600,
	},
	gpsjam: { module: "./collectors/gpsjam.js", intervalSec: 1800, ttlSec: 3600 },
	spc: { module: "./collectors/spc.js", intervalSec: 900, ttlSec: 1800 },
	tsunami: {
		module: "./collectors/tsunami.js",
		intervalSec: 300,
		ttlSec: 900,
	},
	advisories: {
		module: "./collectors/advisories.js",
		intervalSec: 21600,
		ttlSec: 86400,
	},
	// Aviation status, emergency mapping, shipping, displacement, subsea
	// cables, vulnerabilities, Tor exits, travel advice.
	faa: { module: "./collectors/faa.js", intervalSec: 300, ttlSec: 900 },
	ems: { module: "./collectors/ems.js", intervalSec: 3600, ttlSec: 7200 },
	vessels: {
		module: "./collectors/vessels.js",
		intervalSec: 600,
		ttlSec: 1800,
	},
	unhcr: {
		module: "./collectors/unhcr.js",
		intervalSec: 86400,
		ttlSec: 172800,
	},
	cables: {
		module: "./collectors/cables.js",
		intervalSec: 86400,
		ttlSec: 172800,
	},
	euvd: { module: "./collectors/euvd.js", intervalSec: 3600, ttlSec: 7200 },
	torexits: {
		module: "./collectors/torexits.js",
		intervalSec: 3600,
		ttlSec: 7200,
	},
	fcdo: { module: "./collectors/fcdo.js", intervalSec: 21600, ttlSec: 86400 },
	// Official agency fire incidents and public warnings.
	wildfires: {
		module: "./collectors/wildfires.js",
		intervalSec: 900,
		ttlSec: 1800,
	},
	warnings: {
		module: "./collectors/warnings.js",
		intervalSec: 900,
		ttlSec: 1800,
	},
	// Add more open-source endpoints here (see docs/ADDING_ENDPOINTS.md):
} as const;

export type CollectorName = keyof typeof COLLECTORS;

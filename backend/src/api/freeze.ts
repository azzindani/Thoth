// Frozen-feed rule: a source that keeps succeeding while its newest
// observation stops moving is FROZEN. Shared by /api/health (display) and
// the worker's ops alerts, so both judge a feed the same way.
// Freeze budgets per source class (sec). Sensors: event-ts ≈ now, tight budget.
// Digests (article dates lag legitimately): wide budget. Catalogs: fetch-failure
// is the only signal — event dates are inherently old, never frozen.
const NEVER_FROZEN =
	/^(cisa-kev|smithsonian|opensanctions|static|gdacs|swpc-alerts|fema|ioda|ooni|usgs-blast|fng|who-gho|hdx-idmc|fda-food|fda-device|fda-faers|fda-510k|fda-ndc|who-news)$/;
const BUDGET: [RegExp, number][] = [
	[
		/^(usgs|emsc|ingv|jma|jma-forecast|bmkg|turkey-kandilli|turkey-afad|opensky|opensky-bosporus|opensky-tokyo|opensky-sydney|opensky-mexico|adsb|telegram|neptun|celestrak|tle-mirror|iss-live|ndbc|coops|coops-temp|coops-pred|coops-wind|coops-pressure|urlhaus|swpc-kp|om-flood)$/,
		7200,
	],
	[
		/^(eonet|neo|firms|nws|nws-fx|metalerts|metalarm|metnow|metocean|metocean-ns|metsun|sunsched|hko|brightsky|nasa-power|bom|ipma|iss-now|yr-forecast|yr-nowcast|nws-obs|fmi|dwd-warn|swiss-rail|swiss-conn|sncf|metrotransit|gbfs|gbfs-divvy|gbfs-cabi|gbfs-blue|gbfs-toronto|tfl-aq|tfl-tube|tfl-bike|tfl-road|tfl-arr|tfl-arr-kx|tfl-arr-eus|tfl-arr-gpk|tfl-arr-pac|tfl-arr-vic|tfl-arr-ovl|tfl-arr-hsc|tfl-arr-wlo|tfl-arr-lnb|tfl-status|irail-conn|mbta|septa|septa-rail|digitraffic|irail|ioda|kalshi|epa-ie|safecast|usgs-blast|sg-lta|sg-psi|tfl-jamcam|on511|polymarket|coingecko|cg-global|yahoo|binance|coinbase|kraken|bitstamp|deribit|deribit-dvol|deribit-funding|mempool|manifold|fxrates|nbp|hn|trials|pubmed|pubmed-latest|doaj|datacite|nhc|carbon-uk|carbon-uk-hist|dk-spot|rainviewer|energy-charts|energy-charts-fr|energy-charts-es|energy-charts-it|energy-charts-nl|energy-charts-pl|energy-charts-be|energy-charts-at|energy-charts-se|energy-charts-dk|energy-charts-pt|energy-charts-gr|energy-charts-hu|energy-charts-si|energy-charts-fi|energy-charts-no|energy-charts-cz|geonet|vatsim|ivao|satnogs|spacedevs|rocketlive|amsat-tle|amsat-status|ghsa|autobahn|blockchair|goldapi|nyfed|fiscaldata|bls-cpi|boc-fx|worldbank|moex|nbp-pln|cbr|nasdaq-top|npm-dl|pypi-dl|rubygems|jsdelivr|crates-trend|defi|cg-exchanges|thn|krebs|bleep|schneier|spamdrop|threatpost|feodo|dshield|dshield-top|cins|threatfox|bazaar|ransomware|msrc|blocklistde|nyc311|chicrime|lacrime|austintraffic|sf311|ukbills|swpc-scales|swpc-wwv|goes-xray|sentry|silso-daily|ocha|ifrc|gateio|spamrep|medrxiv|zenodo|hal|inspire|core|figshare|openaire|arbeitnow|remoteok|themuse|openfood|musicbrainz|erapi-usd|erapi-eur|coinlore|paprika|frankfurter|adsbfi|stack|masto|reddit|lemmy|flickr|inat|gbif|bsky|gh-events|radio|lobsters|devto|)$/,
		14400,
	],
	[
		/^(gdelt|bbc|dw|france24|aljazeera|guardian|gnews|nyt-world|breakingdef|defenseone|ecdc|who-news|reliefweb|fema|sans-isc|snapi|fedreg|govtrack|openalex|crossref|epmc|arxiv|awc-metar|awc-taf|openmeteo-fx|openmeteo-marine|swpc-aurora|swpc-xray|swpc-f107|ecb|imf|nwis)$/,
		43200,
	],
	[/./, 14400],
];
export function frozenBudget(source: string): number | null {
	if (NEVER_FROZEN.test(source)) return null;
	for (const [re, s] of BUDGET) if (re.test(source)) return s;
	return 5400;
}

/** True when the newest observation is older than the source's budget. */
export function isFrozen(
	source: string,
	lastOk: string | Date | null,
	contentTs: string | Date | null,
	now = Date.now(),
): boolean {
	const budget = frozenBudget(source);
	if (!lastOk || budget === null || !contentTs) return false;
	return now - new Date(contentTs).getTime() > budget * 1000;
}

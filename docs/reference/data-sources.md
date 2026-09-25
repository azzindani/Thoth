# Data sources

Thoth collects data from 300+ public upstream sources through about 75
collectors. This page summarizes them by map layer. **The authoritative
list is the running system itself:**

- `GET /api/monitor/catalog`: every source with its upstream hosts,
  collector, layer, cadence and whether it needs a key;
- `GET /api/health`: live freshness for each source;
- the Monitor tab in the UI.

## Sourcing principles

1. **Keyless first.** Everything below works with no account and no key.
   A keyed source is only added when a keyless alternative exists or the
   feature is optional, and it ships disabled until a key is configured.
2. **Provenance on every row.** Each event keeps its `source`, a link to
   the original (`url`), and the raw payload in `raw_events`.
3. **Respect the upstream.** Collectors send a User-Agent, stay within
   published rate limits, pace requests where needed, and poll no faster
   than the upstream publishes.
4. **Honest freshness.** See the
   [freshness contract](../architecture/overview.md#freshness-contract).

## Live layers

The cadence is the collector's poll interval, before jitter.

### Hazards

| Layer | Main upstreams | Cadence |
|---|---|---|
| `quakes` | USGS (M2.5+), EMSC, GFZ GEOFON, INGV, GeoNet NZ (incl. volcano alert levels), JMA, BMKG, Kandilli, AFAD | 60 s – 5 min |
| `fires` | NASA FIRMS VIIRS (NOAA-20, NOAA-21, Suomi-NPP) CSV; agency incidents: CAL FIRE, NSW RFS, VIC EMV, QLD Fire, WA DFES, ACT ESA | 10–15 min |
| `perims` | NIFC WFIGS current fire perimeters | 30 min |
| `weather` | US NWS alerts, MET Norway MetAlerts, DWD, FMI, Environment Canada, Hong Kong Observatory, JMA warnings, RainViewer radar and IR frames | 5–30 min |
| `disasters` | NASA EONET, GDACS, FEMA declarations, NHC tropical outlooks, JTWC, IFRC GO emergencies, IDMC displacement (HDX), UK Environment Agency floods, German civil-protection warnings (MoWaS, KATWARN, BIWAPP, LHP), Copernicus EMS, JPL CNEOS close approaches, Autobahn closures | 5 min – daily |
| `volcanoes` | Smithsonian GVP, USGS HANS alert levels, JMA eruption warnings | 1 h – daily |
| `oceans` | NOAA NDBC buoys, NOAA CO-OPS tide, wind and pressure gauges, USGS NWIS rivers, Pegelonline (German waterways), Open-Meteo flood discharge | 10 min – 1 h |
| `radiation` | BfS ODL German gamma dose-rate network, Safecast | 15 min |
| `spacewx` | NOAA SWPC (Kp, alerts, scales, aurora, GOES X-ray, F10.7), SILSO sunspots | 5 min – 1 h |
| `airquality` | Open-Meteo air quality, Sensor.Community, Singapore PSI | 30 min |
| `airwx` | Aviation Weather Center SIGMETs, international SIGMETs, G-AIRMETs | 15 min |
| `metar` | Aviation Weather Center METAR and TAF, 44 world stations | 15 min |
| `forecast` | Open-Meteo forecast and marine, MET Norway, BrightSky (DWD), IPMA, BOM, NASA POWER | 3 h |

### Movement and infrastructure

| Layer | Main upstreams | Cadence |
|---|---|---|
| `flights` | adsb.lol → OpenSky (fallback, several regional boxes), adsb.fi, VATSIM, IVAO | 5–15 min |
| `vessels` | Digitraffic Finnish AIS (Baltic) | 10 min |
| `satellites` | CelesTrak TLE → TLE mirror fallback, AMSAT, ISS position, SpaceDevs launches, SatNOGS | 10 min – 6 h |
| `transit` | TfL (arrivals, line status, roads, bikes), Swiss transport, SNCF, iRail, Digitraffic rail, MBTA, SEPTA, GBFS bike share | 30 min |
| `navwarn` | NGA MSI broadcast navigation warnings | 30 min |
| `gpsjam` | GNSS interference cells derived from ADS-B | 30 min |
| `cctv` | Singapore LTA traffic cameras, TfL JamCams, Caltrans, 511 Alberta, Rijkswaterstaat | 10 min |
| `energy` | UK Carbon Intensity, Energy-Charts (25 European countries), Danish spot prices | 1 h |
| `cables` | Submarine cable map | daily |

### Security and conflict

| Layer | Main upstreams | Cadence |
|---|---|---|
| `conflicts` | USGS explosion events, FIRMS anomalies in conflict zones | 10 min |
| `drones` | Ukrainian air-raid alerts | 2 min |
| `telegram` | Public channel previews (`t.me/s/…`) with place-name geoparsing | 1 min |
| `cyber` | CISA KEV, NVD, GitHub advisories, ENISA EUVD, national CERTs (CERT-FR, CERT-EU, CCCS, JPCERT/CC), IODA outages, OONI censorship, abuse.ch (URLhaus, Feodo, ThreatFox, MalwareBazaar, SSLBL), DShield, Spamhaus DROP, CINS, blocklist.de, Tor exits, ransomware.live, security press RSS | 15 min – 1 h |
| `advisories` | US State Department and UK FCDO travel advisories | 6 h |
| `displacement` | UNHCR Refugee Data Finder | daily |

### Information

These layers are mostly non-geographic. They appear in the ticker, tabs,
timeline and alerts rather than as map points.

| Layer | Main upstreams | Cadence |
|---|---|---|
| `news` | BBC, DW, France 24, Al Jazeera, Guardian, NYT, defence press, Google News search, GDELT, WHO, OCHA/IFRC (ReliefWeb RSS), Spaceflight News, Mastodon, Lemmy, Reddit | 5 min – 1 h |
| `markets` | Yahoo Finance, CBOE delayed indices, CoinGecko, Binance, Coinbase, Kraken, Bitstamp, Deribit, mempool.space, Polymarket, Manifold, Kalshi, ECB/Frankfurter/NBP/BoC FX, US Treasury FiscalData, NY Fed, BLS, IMF, World Bank, DBnomics, Fear & Greed | 10 min – weekly |
| `research` | OpenAlex, Crossref, Europe PMC, arXiv, ClinicalTrials.gov, PubMed, DOAJ, DataCite, Zenodo, HAL, INSPIRE-HEP | 6 h |
| `health` | WHO Disease Outbreak News, WHO GHO indicators, openFDA recalls and adverse events, UNESCO | 3 h – weekly |
| `policy` | US Federal Register, GovTrack, UK Parliament bills | daily |

### Derived layers

| Layer | Source |
|---|---|
| `incidents` | Worker intelligence pass: corroborated clusters across layers |
| `anomalies` | Worker intelligence pass: activity against a 7-day baseline |
| `ops` | Worker monitor: feed failure and freeze alerts |

## Static datasets

Vendored in `backend/static/`. Loaded by `npm run db:seed` and by the
compose `seed` service. Rebuilt with the `src/scripts/build-*.ts` scripts.

| Layer / use | Dataset | Licence |
|---|---|---|
| `bases`, `chokepoints`, `conflicts` | Curated military bases and chokepoints; UCDP GED v26.1 conflict aggregates | UCDP: free for research use |
| `ports` | Natural Earth 10m ports | Public domain |
| `airports` | OurAirports | Public domain |
| `datacenters` | Curated list, PeeringDB facilities | PeeringDB guest data |
| `energy` | WRI Global Power Plant Database v1.3.0 (≥1000 MW); OWID/Ember electricity mix | CC BY 4.0 |
| `signals`, `theaters` | Curated monitoring stations and theatre presets | — |
| Sanctions search | OpenSanctions OFAC SDN mirror (refreshed daily), UN Security Council consolidated list | See the publishers |
| Cyber context | MITRE ATT&CK enterprise techniques | CC BY-SA (MITRE) |
| Aircraft enrichment | plane-alert-db, airline codes | See the upstream repository |
| Symbol lookup | NasdaqTrader symbol directory | — |
| Space weather history | SILSO monthly sunspot numbers | CC BY-NC |

## Optional keyed sources

| Variable | Adds |
|---|---|
| `OTX_API_KEY` | AlienVault OTX pulses → `cyber` |
| `FINNHUB_KEY` | Earnings calendar → `markets` |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Outbound alert delivery (not a data source) |

For setup details, see [Configuration › Optional keys](../operations/configuration.md#optional-keys).

## Not supported

These sources need paid plans, approved applications or keys that have no
keyless alternative. They are left out on purpose:

- Global live AIS (AISStream, commercial AIS). Only the Baltic is covered,
  keyless, through Digitraffic.
- ACLED conflict events (researcher token).
- ReliefWeb API v2 (needs an approved `appname`). OCHA and IFRC headlines
  arrive by RSS instead.
- AviationStack, CoinGecko Pro, full Shodan, commercial search and scrape
  APIs.
- Telegram MTProto at scale. The public web preview is used instead.

## Attribution and terms

Upstream data belongs to its publishers. Thoth stores the original link
and source id with every record so it can be attributed. If you run Thoth
publicly or redistribute its data, check each upstream's terms. Some,
such as UCDP, SILSO and some national open-data licences, restrict
commercial use or require specific attribution. The licence for a source
is noted in its collector next to the upstream URL.

To propose a new source, see [Adding data sources](../development/adding-data-sources.md).

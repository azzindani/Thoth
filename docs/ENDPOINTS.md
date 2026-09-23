# Thoth — Endpoints Overview (all sources digested)

## LIVE (free, no keys — shipping, 2026-09-09)
56 collectors, 229+ upstream feeds, 34 explorer layers. Non-geo layers (news, cyber-intel,
markets, research, health, policy) surface via ticker + counts + timeline + alerts, not map dots.

| Layer | Free upstream feeds |
|---|---|---|
| airquality (NEW 2026-09-13) | Open-Meteo air-quality, 30 world cities, US-AQI severity |
| news | RSS: BBC, DW, France24, AlJazeera, Guardian, Google News search + GDELT doc API (429-prone, backup only) |
| gdacs | GDACS event search (EQ/TC/FL/VO/WF/DR, Red→critical) |
| cyber | urlhaus text_recent (info) + CISA KEV catalog (≤30d→critical) |
| markets | Polymarket Gamma + CoinGecko + Yahoo Finance chart (BTC/ETH/S&P/gold/EURUSD) + Frankfurter ECB FX (8 USD pairs, daily) |
| quakes / flights / fires / disasters / weather / spacewx / cctv / telegram / sanctions | USGS / adsb.lol→OpenSky / FIRMS / EONET / NWS / SWPC×2 / SG-LTA+TfL / t.me / OpenSanctions |
| perims (NEW) | NIFC WFIGS current interagency fire perimeters (ArcGIS, org …3qTGWY) |
| airwx (NEW) | Aviation Weather Center active SIGMETs GeoJSON (replaces retired FAA ASWS) |
| disasters+oceans+weather+cyber (NEW 2026-09-14) | FEMA OpenFEMA declarations → `disasters`; NOAA CO-OPS tide gauges (8 surge stations, datum MSL) → `oceans`; MET Norway MetAlerts 2.0 → `weather`; IODA blackout alerts → `cyber` (all keyless; fema/ioda sparse-by-design = never frozen) |
| cyber+space+news+markets+quakes (NEW 2026-09-14 #3) | OONI confirmed-censorship (new `ooni` collector) + SANS infocon → `cyber`; live ISS fix (wheretheiss.at) → `satellites`; Spaceflight News API → `news`; Kalshi statecraft contracts → `markets` (egress-blocked here, honest-STALE); EMSC FDSN → `quakes` (all keyless; ooni never frozen) |
| airports+datacenters (NEW 2026-09-14 static) | OurAirports daily dump (public domain) → `airports` 375→5280; PeeringDB top facilities (guest reads) → `datacenters` +387 (both via checked-in build scripts, reseedable) |
| metar+forecast (NEW 2026-09-15) | AWC METAR+TAF 44 world stations (point obs, fltCat severity) → `metar`; Open-Meteo forecast+marine 24 cities/coasts → `forecast` (heat/wave severity) |
| markets sentiment (NEW 2026-09-15) | Fear & Greed Index (alternative.me, daily) → `markets` (extreme fear/greed → critical; never frozen) |
| research+health+policy (NEW 2026-09-15) | OpenAlex+Crossref+EuropePMC+arXiv (backoff-honest) → `research`; WHO GHO 6 indicators × 25 countries (weekly, never frozen) → `health`; Federal Register PRESDOCU+security search (daily) → `policy` |
| disasters depth (NEW 2026-09-15) | IDMC internal displacement via HDX CKAN, 25 hotspot countries conflict+disaster CSVs (daily, never frozen) → `disasters` |
| energy+ports+conflicts (NEW 2026-09-15 static) | WRI Global Power Plant DB v1.3.0 (CC BY 4.0, ≥1000MW, idempotent dedupe — +0, all covered) → `energy`; Natural Earth 10m ports (public domain) → `ports` 52→1104; UCDP GED v26.1 per-conflict aggregates 2015+ (216k events → 876 conflicts, top 60 non-curated) → `conflicts` 10→70 (all via checked-in build scripts, reseedable) |
| markets/crypto depth (NEW 2026-09-15 #2) | Binance 24h tickers (BTC/ETH/SOL) + Coinbase BTC/fiat table → `markets` (CoinGecko third opinion) |
| spacewx solar depth (NEW 2026-09-15 #2) | SWPC Ovation aurora power + GOES X-ray flare class + F10.7 flux → `spacewx` |
| fx redundancy (NEW 2026-09-15 #2) | ECB official daily XML (EUR cross → USD-base) + fxratesapi keyless JSON → `markets` (Frankfurter stays primary) |
| quakes+weather+energy (NEW 2026-09-15 #2) | GeoNet NZ quakes → `quakes`; NHC 3-basin wallets (quiet-season heartbeats honest-ok) → `disasters`; RainViewer radar index → `weather`; UK carbon intensity → `energy`; USGS NWIS river gauges → `oceans` |
| research litwatch (NEW 2026-09-15 #2) | ClinicalTrials.gov v2 + PubMed counts + HN Algolia stories → `research` |
| macro second opinion (NEW 2026-09-15 #2) | IMF DataMapper GDP/inflation/unemployment 25 countries (weekly) → `markets`; `macro-imf` OSINT route |
| flights/volcanoes/ground (NEW 2026-09-15 #3) | VATSIM live virtual traffic (~1k pilots, airborne sample) → `flights`; USGS HANS alert/color per monitored volcano → `volcanoes` (live!); German Autobahn roadworks+closures (7 corridors) → `disasters` |
| crypto/fx depth (NEW 2026-09-15 #3) | Kraken OHLC + Bitstamp vwap + mempool chain-head/fees → `markets` (crypto.ts); NBP Polish FX table (PLN cross → USD-base) → `markets` (fxdepth.ts) |
| cyber/satellites/research (NEW 2026-09-15 #3) | GitHub Security Advisories → `cyber`; SpaceDevs launches + SatNOGS transmitters → `satellites`; DOAJ articles + DataCite datasets → `research` |
| sanctions multilateral (NEW 2026-09-15 #3) | UN Security Council consolidated XML (736 individuals + 275 entities, build-unsanctions.ts) → `sanctions_entities` dataset='unsc' (1,011 rows live) |
| quakes Asia+Med (NEW 2026-09-16 batch22) | JMA list (277KB live, shindo) + BMKG TEWS (tsunami flag) → `quakes` (new quakes-asia collector); INGV FDSN text → `quakes` (pipe-parse, 4.8 Med sample) |
| weather depth (NEW 2026-09-16 batch22) | MET Norway nowcast + NWS gridpoints 7-day (NYC) + HKO 9-day → `weather` (weather.ts; ocean/sunrise/AQ probed-live, parked) |
| spacewx depth (NEW 2026-09-16 batch22) | NOAA scales R/S/G + WWV digest + GOES X-ray 1-day peak (DONKI DEMO_KEY 429s — dropped) → `spacewx`; JPL CAD 2-day flybys (H<22 large→watch; NEO DEMO_KEY 429s — dropped) → `disasters` |
| markets depth (NEW 2026-09-16 batch22) | CoinGecko global mcap + Blockchair chain stats + gold-api XAU + NY Fed EFFR + Treasury FiscalData TGA → `markets` |
| cyber press (NEW 2026-09-16 batch22) | THN + Krebs + BleepingComputer + Schneier + Threatpost RSS → `cyber` (watch on 0-day/ransomware/breach) |
| health/policy/news (NEW 2026-09-16 batch22) | openFDA food+device recalls → `health`; UK Parliament bills → `policy`; WHO news RSS → `news` |
| flights/satellites/rivers (NEW 2026-09-16 batch22) | IVAO whazzup airborne → `flights`; RocketLaunch.live → `satellites`; OM flood discharge 6 gauges → `oceans` (rivers.ts) |
| civic (NEW 2026-09-16 batch22) | NYC 311 + Chicago crimes 7d + LA crimes → `disasters` (new civic collector) |
| energy EU (NEW 2026-09-16 batch22) | Danish Elspot DK1/DK2 + UK carbon 24h peak → `energy` (new energy-eu collector) |
| energy EU depth (NEW 2026-09-17 batch58) | Fraunhofer public-power 25-country loop (DE/FR + ES/IT/NL/PL/BE/AT/SE/DK/PT/GR/FI/NO/CZ/HU/SI + RO/SK/HR/IE/LU/EE/LV/LT, top-3 positive mix each, 1.5s throttle vs 429) → `energy` (energy-eu.ts) |
| transit roads + status (NEW 2026-09-17 batch58) | TfL road disruptions A2/A3/A4 + A1/A10/A13/A40 (point coords, closure flags) + 6-line status (victoria/central/jubilee/piccadilly/northern/bakerloo) + swiss return legs BE-ZH/GE-BE → `transit` (transit.ts) |
| transit boards (NEW 2026-09-17 batch58) | TfL arrivals 16 stations (+Stratford/Canning Town/Liverpool St/Ealing Bdwy/Holborn/Bond St, ≤8 each with line/platform/countdown) → `transit` (transit.ts) |
| oceans CO-OPS ring (NEW 2026-09-17 batch58) | Tide gauges +7 (Providence/Springmaid/Pilots-Station/San-Diego/Astoria/Seattle/Nawiliwili — 15 stations, datum MSL) + wind/pressure second ring (sparse-green: 5/7 wind, 6/7 pressure met-equipped) → `oceans` (oceans.ts) |
| fx cross (NEW 2026-09-17 batch59) | Frankfurter EUR-base reverse view (EUR/USD/GBP/JPY/CHF) next to USD-base 8 → `markets` (fx.ts) |
| energy UK depth (NEW 2026-09-17 batch59) | Carbon Intensity 48h forecast peak (look-ahead leg) + generation mix top-3 fuels (wind/solar/gas/nuclear %) → `energy` (energy-uk.ts) |
| airwx depth (NEW 2026-09-17 batch60) | AWC G-AIRMET area forecasts (icing/turb/FZLVL lines) + intl SIGMETs (132 FIR polygons, TS/VA watch) next to CONUS SIGMETs → `airwx` (airwx.ts) |
| weather satellite IR (NEW 2026-09-17 batch60) | RainViewer `satellite.infrared` cloud-cover frames (same payload as radar index, honest-green at 0) → `weather` (radar.ts) |
| quakes NZ depth (NEW 2026-09-17 batch60) | GeoNet volcano VAL (12 NZ volcanoes, RED→critical) + news feed (eruption-keyword watch) → `quakes` (quakes-nz.ts) |
| fires rungs (NEW 2026-09-17 batch60) | FIRMS NOAA-21 VIIRS + Suomi-NPP VIIRS rungs after NOAA-20 (95k/83k-row fallbacks, same 500-row cap) → `fires` (fires.ts) |
| markets volatility (NEW 2026-09-17 batch61/fincept-1) | CBOE delayed indices (VIX/SPX/NDX/RUT) + EU flagships (UK100/DAX40/CAC40/IBEX35/FTSEMIB/ES50) → `markets` (markets.ts) |
| rates curve (NEW 2026-09-17 batch61/fincept-1) | FiscalData avg interest rates (Bills/Notes/Bonds/TIPS) next to TGA-flow leg → `markets` (markets.ts) |
| macro BEA mirror (NEW 2026-09-17 batch61/fincept-1) | DBnomics BEA GDP time series (no BEA key) → `markets` (imf.ts) |
| security master seed (NEW 2026-09-17 batch61/fincept-1) | Yahoo symbol search (exchange + sector + industry, 4-ticker watchlist) → `research` (research.ts) |
| education enrolment (NEW 2026-09-17 batch62/fincept-2) | UNESCO primary pupils per watchlist country → `health` (health-who.ts) |
| symbol master (NEW 2026-09-17 batch62/fincept-2) | NasdaqTrader SymDir 12.5k static (build-symdir.ts) + `/api/osint/symbol?q=` prefix search → terminal security-master |
| gov catalog pulse (NEW 2026-09-18 batch63/fincept-3) | CKAN package_search counts (Canada/Swiss/AU/Slovenia) → `disasters` (hdx.ts) |
| macro fiscal depth (NEW 2026-09-18 batch65) | World Bank WDI source-series: govt debt %GDP + real GDP growth (latest non-null year, debt>100 watch) → `markets` (imf.ts, worldbank-src) |
| crypto board depth (NEW 2026-09-18 batch65) | CoinGecko movers top-3 (price+24h+rank) + trending top-4 + Coinbase spot BTC/USD+EUR + Llama Aave/Lido TVL → `markets` (markets.ts cg-movers/cg-trending, crypto.ts coinbase-spot/llama-tvl) |
| terminal objects (NEW 2026-09-18 batch64/fincept-UI) | portfolios + positions, notes journal, saved screens (006_terminal) + PULSE/PORTFOLIO/SCREEN/NOTES tabs → analyst workspace |
| terminal fixes (2026-09-18 inspection) | bitfinex LAST_PRICE, source-namespaced FX ids, full-source PULSE FX, quotes-first EQUITIES |
| research depth (NEW 2026-09-16 batch23) | Zenodo records + HAL French archive + INSPIRE-HEP → `research` (research.ts) |
| fx/macro depth (NEW 2026-09-16 batch23) | ER-API USD+EUR tables + CoinLore tickers → `markets` (fxdepth.ts); BLS CPI-U + MoM → `markets` (imf.ts) |
| weather/flights/litwatch (NEW 2026-09-16 batch23) | MET ocean + sunrise-daylight → `weather`; adsb.fi mil sweep fallback → `flights`; StackExchange votes → `research` (litwatch.ts) |
| social (NEW 2026-09-16 batch23) | Mastodon tags + ArcticShift Reddit + Lemmy + Flickr + iNaturalist + GBIF → `news` (new social collector, Bluesky 403-parked) |
| transit (NEW 2026-09-16 batch24) | Swiss stationboards 6 hubs (delay disruption) + SNCF stations + MetroTransit heartbeat → `transit` layer (new collector, catalog+intel) |
| forecast depth (NEW 2026-09-16 batch24) | BrightSky DWD 3 cities + NASA POWER London → `forecast` |
| statics (NEW 2026-09-16 batch24) | OWID/Ember electricity mix 59 countries → `energy`; SILSO sunspots 120mo → `spacewx` (build scripts + seeded) |
| health/transit/markets (NEW 2026-09-16 batch31/loop-6) | FDA 510k + NDC → `health`; MBTA Boston vehicles → `transit`; DeFi Llama top-5 + CG venue ranking → `markets` |
| quakes/fx/airquality/dev (NEW 2026-09-16 batch30/loop-5) | GEOFON Potsdam → `quakes`; Bitfinex + KuCoin → `markets` (fxdepth); Luftdaten citizen sensors → `airquality`; npm DL + crates trending → `markets`; GH public events → `news` · OSINT +3: `dailymed` NLM, `holidays` Nager, `npm-dl` |
| dev-ecosystem (NEW 2026-09-16 batch29/loop-4) | npm weekly DL + crates.io trending → `markets`; GitHub public events → `news` · metar wdir-VRB fix (awc-metar green) |
| health/civic/research (NEW 2026-09-16 batch28/loop-3) | FAERS serious reports → `health`; Austin traffic → `disasters`; OpenAIRE OAF → `research` · metar/hans schema fixes (epoch obsTime, null vnum) |
| research/fx/cyber (NEW 2026-09-16 batch27/loop-2) | CORE papers + Figshare datasets → `research`; CoinPaprika 3 coins → `markets`; Spamhaus DROP 60 nets → `cyber` |
| weather/space/transit/markets (NEW 2026-09-16 batch26/loop-1) | YR 3-city 6h + NWS 3 stations + FMI Helsinki + DWD JSONP → `weather`; SILSO daily → `spacewx`; GBFS sample + TfL AQ/tube → `transit`; MOEX IMOEX → `markets` |
| relief/crypto/research/space/forecast (NEW 2026-09-16 batch25) | OCHA+IFRC RSS → `news` (relief.ts, WAF-proof ?q= path); Gate.io 3 pairs + StopForumSpam heartbeat → `markets` (crypto.ts); medRxiv filtered preprints → `research`; JPL Sentry top-10 Palermo → `disasters`; BOM 4 AU cities → `forecast` |
| security/hazards (NEW 2026-09-23 batch31) | NGA MSI broadcast warnings (NAVAREA IV/XII, HYDROLANT/PAC/ARC; coords parsed from text → areas/tracklines/points, cancelled warnings pruned) → new `navwarn`; GNSS interference cells derived from ADS-B NACp at adsb.lol→adsb.fi over 6 hotspots (gpsjam.org method, 1° cells, >10% critical / 2–10% watch, cleared cells pruned) → new `gpsjam`; US State Dept travel advisories (L4 critical / L3 watch, capital anchor via `lib/countries.ts`) → new `advisories`; NOAA SPC storm reports today+yesterday (tornado critical, sig-severe watch) → `weather`; NTWC+PTWC tsunami Atom bulletins → `quakes`; JTWC West Pacific/Indian Ocean cyclones (position + winds from warning text) → `disasters` (storms.ts). Contract-tested with stubbed upstreams; not yet probed live from a networked host |
| OSINT (57: +6 2026-09-16 batch25) | `rxnorm` dose forms, `chembl` ChEMBL phase (.json suffix!), `sbdb` orbit/PHA, `deps` transitive deps, `nasa-img` thumbnails, `planespotter` photos (contact UA) |
| OSINT (60: +3 2026-09-17 flowsint digest) | `sirene` French SIREN + HQ geo + activity (INSEE, keyless), `stealers` HudsonRock info-stealer check (email/username, free tier), `gravatar` existence + profile (md5 addressing, HEAD d=404) |
| OSINT (51: +2 2026-09-16 batch24) | `funder` OpenAlex, `museum` AIC+Met |
| OSINT (49: +9 2026-09-16 batch23) | `fda-drug` openFDA labels, `gene` NCBI, `ontology` OLS/EBI, `protein` UniProt, `package` npm/PyPI/crates/gems, `daylight` sunrise-sunset, `zip` Zippopotam, `transit` Swiss stationboard, `name` agify/genderize/nationalize |
| OSINT (40: +9 2026-09-16 batch22) | `cert` via crt.sh, `asn` via RIPEstat as-overview/announced-prefixes/network-info, `cve` via NVD 2.0, `epss` via FIRST.org exploit probability, `osv` via Google OSV (affected packages + fix ranges), `circl` via CIRCL CVE aggregator (NVD-failover summaries), `company` via GLEIF LEI, `rdap` via IANA bootstrap, `dns`/`reverse` via HackerTarget free tier (on-demand only, 50/day), `edgar` via SEC full-text (egress-blocked here, honest-502), `doh` via Cloudflare, `doh-google` via Google DoH (resolver second opinion), `ipwhois` via ipwhois.app second-source geo+ASN, `github` code search, `airspace` via FAA UAS facility map, `robtex` via Robtex free IP (reverse-IP+ASN), `fdic` via FDIC bank search, `doh-cf` via Cloudflare DoH JSON, `token` via DexScreener pairs, `wikidata` entity search, `wiki` Wikipedia summary, `books` OpenLibrary, `stack` StackExchange, `nominatim` forward geocode |
| search + watch + notify | FTS over events corpus; keyword/layer/severity watchlists + match scan; `POST /api/notify` Telegram push (disabled-honest without token) |
| sitrep + export + imagery | POST/GET /api/sitrep markdown archive + history; per-layer CSV/GeoJSON download; `/api/imagery` freshest Sentinel-2 scene via earth-search STAC |
| finnhub | earnings-calendar collector shipped disabled-honest (free key turns it on) |
| NOT free, NOT shipped | vessels/AIS (AISStream key — probed 2026-09-13, no keyless path exists), ACLED (token), Exa/SerpAPI (keys) |

## Live route table (verified 2026-09-17, 85 routes incl. self-index: 53 + 9 batch22 + 9 batch23 + 2 batch24 + 6 batch25 + 3 batch30 + 3 flowsint)

Self-describing at runtime: `GET /api/routes` (generated from the Express
stack — documentation that cannot drift).

Core/ops: `GET /api/health · /api/stats · /api/versions · /api/brief · /api/alerts · /api/theaters · /api/stream` (SSE).
Layers/geo: `GET /api/layers/:layer[?since=] · /api/layers/:layer/history · /api/layers/:layer/export?format=csv|geojson · /api/dossier?lat=&lng=`.
OSINT (20): `/api/osint/sanctions|geo|ip|mitre|aircraft|airport|vessel|btc|cert|asn|cve|company|macro|rdap|dns|reverse|edgar|doh|github|airspace` (cert 502s honestly when crt.sh flakes — retries once, recovers).
Search/watch: `/api/search · /api/watch (GET/POST/DELETE) · /api/watch/matches · POST /api/notify`.
Intel: `/api/sitrep (GET/POST) · /api/sitrep/history · /api/analytics/trend · /api/imagery` (400 on bad lon/lat).

Inventoried from 7 repos in `/workspace/.tmp/`: `worldmonitor`, `osiris`, `shadowbroker`, `ironsight`, `globenewslive`, `global-monitor`, `world-dashboard`. Per-repo details in this folder. This catalog is extensible — we may add more open-source endpoints over time, see ADDING_ENDPOINTS.md.

## How to read this catalog

- `public` = no key. `key` = needs `X-Thoth-Key` / session. `admin/HMAC` = signed agent channel.
- Cache tiers (from worldmonitor): `live` (no-store) / `fast` (60s) / `medium` (5m) / `slow` (15-30m) / `daily` / `static`.
- Thoth convention (TypeScript + PostgreSQL): every live dot has a raw row + normalized row + version. Poll `GET /api/versions`, fetch slices with `?since=`, stream deltas on WS/SSE.

## Unified Thoth API to build (v0)

Base: same-origin Next.js Route Handlers. All GET return `{items,total,serverTs,versions}` unless noted.

### Core (counts first, slices on demand)

```bash
GET /api/stats                          # counts only, for badges — public, fast
GET /api/versions                       # {layer: version} — public, live
GET /api/layers/:layer[?since=]          # newest 500 rows (inspector, ticker)
GET /api/layers/:layer?z=6&bbox=w,s,e,n  # map view: rows inside bbox (w>e crosses
                                        # the antimeridian); over the zoom's limit
                                        # (1000 / 1800 / 3000 at z<3 / <5 / ≥5) rows are
                                        # dealt round-robin across a zoom-sized grid,
                                        # best severity first → {matched, truncated}
GET /api/health                         # {uptime, perFeed:{lagSec,lastOk,hitRate}, dbSize}
```

### Map layers (keyless, fast→slow)

```
GET /api/flights?bbox=                  # adsb.lol sweep, 60s — live
GET /api/flight-route?icao24=           # track + legs
GET /api/ships?bbox=                    # AIS, 60s — live/fallback static
GET /api/satellites                     # CelesTrak TLE + SGP4, 60s
GET /api/satellites/overflights         # predictions
GET /api/earthquakes?minMag=2.5         # USGS, 60s
GET /api/fires                          # FIRMS CSV + EONET, 10m
GET /api/weather?type=                  # GDACS/EONET/Open-Meteo/NWS, 5m
GET /api/space-weather                  # NOAA SWPC Kp/solar, 60s
GET /api/cctv?region=&lat=&lng=&radius= # 17k cams, probe + proxy
GET /api/cctv/proxy?url=  /api/cctv/stream-status?url=  /api/cctv/resolve?url=
GET /api/infrastructure                 # nuclear/powerplants/ports static
GET /api/frontlines  /api/conflicts?conflict=  /api/strikes?conflict=  /api/drones?conflict=
GET /api/alerts                         # OREF 15s + alerts.com.ua + Neptun 20s
GET /api/regional-alerts?conflict=      # per-region severity, 12h window
GET /api/displacement?type=  /api/outages?type=  /api/radar
```

### News / OSINT / markets

```bash
GET /api/news  /api/signals?filter=&refresh=  /api/rss-ticker
GET /api/gdelt  /api/gdelt-events?quad=&limit=&min_articles=
GET /api/telegram?channel=&postId=      # t.me/s scrape + geoparse, 60s
GET /api/live-news  /api/live-streams   # 25+ HLS
GET /api/brief                          # deterministic CRITICAL→INFO brief, no LLM
GET /api/dossier?lat=&lng=  /api/region-dossier?lat=&lng=  /api/entity/expand?type=&id=
GET /api/markets  /api/markets/history?symbol=&range=  /api/finance/*  /api/crypto  /api/oil
GET /api/polymarket  /api/kalshi  /api/predictions     # leading indicators
GET /api/cyber-threats  /api/cyber-attacks  /api/cyber/kev  /api/malware
GET /api/malware/stream                 # SSE
```

### RECON / OSINT toolkit (passive first)

```
GET /api/osint/whois?domain=  /dns?domain=  /ip?ip=  /bgp?query=
GET /api/osint/certs?domain=  /cve?cve=  /threats?query=
GET /api/osint/sanctions?query=&schema=&limit=   # OpenSanctions SDN
GET /api/osint/crypto?address=&chain=&probe=     # BTC/ETH/SOL + OFAC flag
GET /api/osint/username?username=  /github?user=  /leaks?email=
GET /api/osint/phone?number=  /mac?mac=  /shodan?ip=  /hudsonrock?query=
GET /api/osint/sweep?ip=&cidr=   POST /api/osint/sweep/scan  # gated
POST /api/scanner/*              # delegated backend, needs SCANNER_URL/KEY else 503
```

### Live stream (verbose, single DB backed)

```bash
GET /api/stream                      # SSE (live): connected + snapshot + layer_changed + heartbeat
GET /api/layers/:layer/history?bucket=day|hour&from=&to=  # timeline scrubber backend (live)
GET /api/dossier?lat=&lng=&radius_km=100  # nearby counts + items, 7d window (live)
GET /api/osint/sanctions?query=&limit=20  # OFAC mirror, 20k rows (live)
GET /api/ai/channel/sse              # layer_changed,task,alert,heartbeat 15s (HMAC) — Phase 3, AI last
GET /api/sdk/stream                  # SDK entity SSE — Phase 3
```

Poll pattern: `GET /api/versions` → `GET /api/layers/:layer?since=<v>` → apply WS deltas. Never full-refresh.

### AI command channel (agents read + write)

```bash
POST /api/ai/channel/command  {"cmd":"get_layer_slice","args":{"layers":["flights","ships"]}}
POST /api/ai/channel/batch    # ≤20 cmds, 1 RTT
POST /api/ai/channel/poll     # destructive read completions
GET  /api/ai/tools  /api/ai/capabilities  /api/ai/status
GET  /api/ai/connect-info  POST /api/ai/bootstrap|reveal|regenerate
POST /api/mcp  # tools/list (public) + tools/call (key/OAuth)
```

HMAC headers: `X-SB-Timestamp, X-SB-Nonce, X-SB-Signature=HMAC-SHA256(secret, METHOD|path|ts|nonce|sha256(body))`, 60s freshness. See `endpoints-shadowbroker.md` + `AI_AGENTS.md`.

### Ops

```
GET /api/geosearch?q=  /api/geo  /api/directions?from=&to=  /api/arcgis
GET /api/sentinel?lat=&lng=&radius=&days=  /api/sentinel2/search
POST /api/sdk/ingest {source,apiKey,entities[]}  # needs SDK_INGEST_KEY
POST /api/notify  POST /api/telegram  GET+POST+DELETE /api/push
GET /api/docs  # hand-kept apiCatalog.ts
```

Per-repo inventories: `endpoints-worldmonitor.md`, `endpoints-osiris.md`, `endpoints-shadowbroker.md`, `endpoints-small.md`.

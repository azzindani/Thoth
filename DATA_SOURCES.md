# Thoth — Data Sources (verbose catalog)

Rule: keyless first, free-key for depth, paid only with budget caps. Every fetch stores raw + normalized + health. Attribution kept per row.

## Keyless (core works with $0)

| Layer | Source | Poll | Notes |
|---|---|---|---|
| flights | adsb.lol → OpenSky fallback | 60s | adsb 503s from cloud IPs; OpenSky public absorbs. Status = live 2026-09-08 |
| sats | CelesTrak TLE + satellite.js SGP4 | 60s | propagate client or worker |
| quakes | USGS Earthquake API | 60s | M2.5+, unlimited |
| fires | NASA FIRMS CSV | 10m | keyless CSV; API needs key |
| weather | NWS active alerts GeoJSON | 5m | live 2026-09-08: 200 alerts, polygon-centroid geom (US-only; global via EONET) |
| disasters | EONET open events | 10m | live: 50 events |
| spacewx | NOAA SWPC K-index + alerts | 5m | live: 21 rows, K≥5 watch |
| gdelt | GDELT DOC artlist | 5m | degraded from sandbox IP (HTTP 429, 3× backoff); honest health, fills on clean IP |
| news | RSS (Reuters/BBC/AP/AJ/Guardian/DefenseOne) via rss-parser | 90s | relevance filter, drop sports |
| telegram | `t.me/s/<channel>` HTML scrape + geoparse | 60s | `OSIRIS_TELEGRAM_CHANNELS` override, EN+RU/UA+AR/FA dict |
| gdelt | GDELT GEO 2.0 | 5m | protests/unrest, Haversine dedup 0.1° |
| markets | Yahoo chart JSON, CoinGecko free, Polymarket Gamma | 5-10m | stagger 150ms, volume filter |
| cyber | NVD, URLhaus, Shodan internetdb, XposedOrNot, HudsonRock Cavalier, crt.sh, RIPEstat | 5m | all keyless picks from osiris |
| crypto | mempool.space, Blockscout, Solana RPC | on-demand | + 0xB10C SDN address list for SANCTIONED badge |
| sanctions | OpenSanctions OFAC SDN mirror | daily | live 2026-09-08: 20,234 entities in `sanctions_entities`, `/api/osint/sanctions` live |
| cctv | SG LTA traffic-images + TfL JamCams (890) | 10m | live-verified 2026-09-08, 408 rows; rotating HEAD probe sample; registry grows via cctv-seeds pattern |
| infra | Cloudflare Radar (needs free token for full), gpsjam H3, PortWatch static | 5m | outages vs jamming split |
| geo | OSM Nominatim, CARTO dark tiles, Natural Earth borders | on-demand | cache |
| metar | NOAA Aviation Weather Center METAR+TAF JSON (44 world stations) | 15m | point obs + terminal forecast, LIFR→critical |
| forecast | Open-Meteo forecast + marine APIs (24 cities/coasts) | 3h | conditions + seas, CC BY 4.0 |
| markets | Fear & Greed Index (alternative.me) | daily | contrarian sentiment, sparse, never frozen |
| research | OpenAlex + Crossref + Europe PMC + arXiv ATOM | daily | scholarly intel, ts = pub date (arXiv 429s, backoff-honest) |
| health | WHO GHO OData (6 indicators × 25 countries) | weekly | annual data, ts = latest year, never frozen |
| disasters | IDMC internal displacement via HDX CKAN (25 countries) | daily | conflict+disaster CSVs, never frozen |
| policy | US Federal Register documents.json (PRESDOCU + security search) | daily | ts = publication date |
| energy | WRI Global Power Plant DB v1.3.0 (CC BY 4.0) | static | build-powerplants.ts, ≥1000MW, idempotent |
| ports | Natural Earth 10m ports (public domain) | static | build-ports-wpi.ts, 52→1104 |
| markets | Binance 24h + Coinbase rates + Manifold predictions + ECB/fxratesapi FX + IMF growth | 30m–daily | crypto/prediction/FX depth, all keyless |
| spacewx | SWPC Ovation aurora + GOES X-ray + F10.7 flux | 1h | solar depth behind kp |
| quakes | GeoNet NZ GeoJSON (MMI≥3) | 5m | South-Pacific second opinion |
| disasters | NHC 3-basin tropical wallets (RSS) | 30m | quiet-season heartbeats honest-ok |
| weather | RainViewer global radar index | 30m | past+nowcast frame freshness |
| energy | UK Carbon Intensity (National Grid ESO) | 1h | live grid CO₂, regional |
| oceans | USGS NWIS river gauges (8 stations, flow+stage) | 1h | flood/water signal |
| research | ClinicalTrials.gov v2 + PubMed counts + HN Algolia | daily | trials/literature/mindshare |
| flights | VATSIM live traffic (virtual ATC network) | 5m | airborne sample, human air picture |
| volcanoes | USGS HANS alerts (alert_level + color_code) | 1h | live restlessness, static cones stay |
| disasters | German Autobahn roadworks API (7 corridors) | 6h | closures + coords |
| markets | Kraken + Bitstamp + mempool.space + NBP FX | 30m–daily | exchange/chain/FX opinions |
| cyber | GitHub Security Advisories (GHSA→CVE) | 15m | advisory feed |
| satellites | SpaceDevs launches + SatNOGS transmitters | 10m–1h | manifest + ground-station catalog |
| research | DOAJ articles + DataCite datasets | daily | open-access + data legs |
| sanctions | UN Security Council consolidated XML | static | build-unsanctions.ts, 1,011 rows dataset='unsc' |
| conflicts | UCDP GED v26.1 per-conflict aggregates (free research use) | static | build-ucdp.ts, 10→70 (downloads path, API needs token — not used) |
| fires | CAL FIRE incidents API + NSW RFS majorIncidents GeoJSON + Emergency Management Victoria events GeoJSON | 15m | named agency incidents next to FIRMS hotspots; current picture, pruned |
| weather | Environment Canada alerts (MSC GeoMet OGC API `weather-alerts`, Open Government Licence – Canada) | 15m | slow upstream (~25s), 60s timeout; one marker per alerted region |
| disasters | Environment Agency flood warnings (England, OGL v3) + MoWaS via warnung.bund.de (BBK) | 15m | flood levels 1–3; civil-protection CAP alerts; current picture, pruned |
| fires | Queensland Fire Department bushfire alerts GeoJSON + WA DFES `/v1/incidents` + `/v1/warnings` + ACT ESA current-incidents GeoRSS | 15m | AU warning levels; WA/ACT filtered to fire items; current picture, pruned |
| disasters | warnung.bund.de KATWARN, BIWAPP, LHP (cross-state flood portal), police | 15m | same CAP shape + footprint lookup as MoWaS; often empty (honest) |
| oceans | Pegelonline (WSV) federal waterway gauges, DL-DE/Zero | 1h | reference gauges + anything above mean high water; state vs MNW/MHW/HSW |
| weather | Hong Kong Observatory open data `warnsum` | 15m | warnings in force, `{}` when quiet |
| radiation | BfS ODL (Bundesamt für Strahlenschutz) `odlinfo_odl_1h_latest` WFS, DL-DE/BY-2.0 | 15m (hourly data) | ~1,600 German gamma dose-rate stations; ≥0.3 µSv/h watch, ≥1 critical; current picture, pruned. Replaces EPA Ireland radmon (dropped 2026-09-24) |
| cyber | National CERT advisories: CERT-FR avis + alertes RSS, CERT-EU security advisories RSS, Canadian Centre for Cyber Security (CCCS) alerts & advisories Atom, JPCERT/CC English RDF | 30m | exploitation named in the text → critical, alerts → watch, vendor advisories → info; rolling windows, rows kept |
| health | WHO Disease Outbreak News (who.int OData `diseaseoutbreaknews`) | 3h | newest 30 DON reports at the first named country's capital; Ebola/Marburg/Nipah/MERS/avian flu etc. critical; kept after they scroll off |
| cyber | abuse.ch SSLBL SSL certificate blacklist (CSV, CC0) | 1h | malware C2 TLS certificate SHA-1s listed in the last 7 days, by family; older listings pruned |
| disasters | IFRC GO emergencies (`goadmin.ifrc.org/api/v2/event/`) + active appeals (`/appeal/?status=0`) | 3h | Red Cross/Red Crescent emergencies of the last 90 days at the affected country's capital; IFRC Red/Orange/Yellow → critical/watch/info, Emergency Appeal lifts Yellow; appeal funding joined; pruned past the window |

## Free-key (depth / limits)

- `FIRMS_MAP_KEY` (email, 5k/10min), `OPENSKY_CLIENT_ID/SECRET` (OAuth2, higher limits), `N2YO_API_KEY` (1k/hr), `AIS_API_KEY` (aisstream.io WS live ships), `CLOUDFLARE_API_TOKEN` (Radar Read), `ETHERSCAN_API_KEY` + `HELIUS_API_KEY` (ETH internal + SOL parses), `GEMINI_API_KEY` (AI briefs only)
- ReliefWeb API v2: needs an approved `appname` (request form at apidoc.reliefweb.int; v1 decommissioned, unapproved names answer 403 — 2026-09-24). OCHA/IFRC headlines already arrive via the `relief` RSS legs.

## Paid / gated (avoid until traction)

AviationStack (per-airport per-tick — cap with monthly budget like worldmonitor), CoinGecko Pro, Exa/Firecrawl/Brave (search/scrape), full Shodan, HudsonRock commercial, Telegram MTProto at scale (fragile/IP-ban — stay on web preview), commercial AIS.

## Freshness contract

Each collector writes `feed_health`. UI shows intelligence-gap badge when `lag_sec > 2×interval`. Stale → serve last-good + `STALE` flag, never silent empty. UCDP-style annual+monthly merge pattern for any lagging annual source.

# THOTH — god-eye build phases

Goal: production god-eye. Database + backend first (streamline + cache everything),
framework UI second. Measurement = capabilities ledger at the bottom, NOT lines
(more lines can mean dead code; optimum density wins).
Per-project digestion: `PORT-*.md` in this folder. Responsive + primitives contract:
`UI_PRIMITIVES.md`. Current terminal stays live throughout; the Next.js app is built
beside it until parity, then it takes over.

## Phase 0 — Digestion docs [DONE]

- [x] 7 PORT docs (sources free/keyed, components, patterns, out-of-scope)
- [x] ENDPOINTS.md live-table update
- [x] UI_PRIMITIVES.md (breakpoints + 9 builders)
- [x] This phase plan

## Phase 1 — Backend sources (free only)

New collectors (`src/workers/collectors/*.ts`, registry + tests each):
- [x] `satellites` — CelesTrak TLE (global-monitor pattern), ISS + debris subset (tle-mirror fallback after CelesTrak 403)
- [x] `oceans` — NOAA NDBC latest_obs (wave/wind/temp)
- [x] `radiation` — Safecast measurements
- [x] `volcanoes` — Smithsonian GVP WFS
- [x] `drones` — neptun.in.ua air-raid alerts (ironsight pattern)
- [x] `conflicts` — USGS explosions + FIRMS anomalies in war zones (world-dashboard pattern)
- [x] news+: ReliefWeb API, WHO feeds, defense RSS (Defense One/Breaking Defense/haaretz/NYT/DowJones), Reuters tier1 URL, GDACS rss.xml, USGS significant atom
- [x] markets+: Yahoo futures CL=F/BZ=F oil, DX-Y.NYB dollar, defense tickers
- [x] cctv+: Caltrans ArcGIS, 511 Alberta/Ontario, RWS NL (JP river cams skipped — no coordinate API)
- [x] Static layers vendored: GN MILITARY_BASES/CHOKEPOINTS/CONFLICTS, osiris ports/zones, shadowbroker plane_alert_db/datacenters/airlines
- [x] Dossier enrich: RIPE Stat + ip-api + Nominatim (rate-limited, cached)
- [x] MITRE ATT&CK bundle (static, versioned) for cyber context
- [~] OTX — DEFERRED: needs signup key; user policy = zero key-based endpoints (slot documented in OUTSTANDING.md)
- [x] LIVE_LAYERS + e2e extended per collector; gates stay green every merge (209 green)

## Phase 2 — Cache / stream hardening (worldmonitor contracts)

- [x] `feed_health.content_ts` per source (observation date, not run time) + freeze alarm
- [x] Read outcome hit/miss/failure end-to-end; failure keeps last-good + STALE, never confident-empty
- [x] Activation markers: no loud alarm before first genuine publish
- [x] Source tags: primary vs fallback rung stamped (adsb→opensky precedent)
- [x] SSE resume (`gate_sse.py` pattern) + `since=` slices everywhere (lever test)
- [x] Backoff/jitter tiers per source temperament (60s aviation → 24h sanctions)

## Phase 3 — Next.js scaffold (parity, no new features) [DONE 2026-09-09]

- [x] Next.js 16 + React 19 + TS strict + MapLibre globe/flat (app on :3000, backend stays data engine)
- [x] Token system + `ui.tsx` primitive library + `layer-catalog.ts` (25 layers, missions, streams)
- [x] Responsive shell desk/tab/phone (same contract as old terminal)
- [x] layer lifecycle per layer (global-monitor pattern: fetch→normalize→render, clusters, sprites)
- [x] Ticker, command bar (OSINT grammar), dossier+geo, SDN, timeline, VIDEO, missions — parity
- [x] e2e (app/e2e/smoke.spec.ts, 2/2) + screenshot parity (app-parity.png, zero page errors)
- [x] Old terminal stays live until cutover call

## Phase 4 — Tab system + panels [DONE except Gloomberb, deferred]

- [x] NEWS / MARKETS / CYBER tabs (layer feeds; CYBER has KEV + inline MITRE search)
- [x] Explorer find-filter (25 layers searchable)
- [x] Keyboard shortcuts (/ g s m esc)
- [x] Critical-alert toasts (SSE-driven, auto-dismiss)
- [x] ChangelogModal (`changelog` command)
- [x] EntityGraph panel, MiniMap, status strip (ZULU·DEFCON·LIVE·ENT·Kp, 2026-09-10)
- [x] Satellite imagery (2026-09-13): /api/imagery + OBJECT SATELLITE block (earth-search STAC, Sentinel-2)
- [~] Gloomberb market-impact — DEFERRED: needs company-exposure dataset, will not build blind (identity leg shipped: `company <name>` → GLEIF)
- [x] Edge rails map-first reflow: accepted as-is per 2026-09-09 reskin decision (not pending work)

## Phase 5 — Missions / theaters / instruments [DONE]

- [x] Day/night terminator (solar math, 10-min refresh)
- [x] Dossier threat score (3×crit + watch + max quake mag → GUARDED/ELEVATED/HIGH)
- [x] URL state (#c=lng,lat,z share links)
- [x] WARTIME mission preset
- [x] BTC lookup (/api/osint/btc via mempool.space; blockstream blocked from sandbox)
- [x] FOCUS map-first mode (edge rails + overlay inspector, FOCUS button / f key / focus cmd)
- [x] DEFCON badge in ticker (from brief critical count)
- [x] Trade-route trunk lines overlay (6 schematic dashed runs)

- [x] Theater datasets (ironsight 46 cities) + `theaters` layer + /api/theaters + fly-to select
- [x] Deterministic /api/brief + NEWS tab brief block
- [x] Ops console (/ops): layer versions + feed content-age matrix
- [x] Deploy: app Dockerfile + compose app service + CI workflow
- [x] Backend tests 49→56 (brief/theaters/osint/contracts)

## Phase 6 — Video + deterministic intel (no LLM)

- [x] HLS/live video wall — 10/10 evergreen 24/7 embeds, all oembed-verified (France24/AJE/DW/Sky/CNA/NASA/TRT/Euronews/ABC/AlArabiya); capped deliberately, further IDs were unverifiable event-IDs (rot-prone)
- [x] Deterministic brief (CRITICAL→INFO, ironsight brief pattern) + /api/brief + NEWS tab block
- [~] Markets analytics HUD — DEFERRED: needs history to Q1 2027 for backtest; sitrep archive is the clock (growing daily)
- [x] Telegram push code (`sendTelegram`, POST /api/notify, `notify` cmdbar) + [~] token DEFERRED: user policy = zero key-based endpoints

## Phase 7 — Production ops

- [x] Multi-stage Docker + compose (db Timescale-HA → migrate → api/worker/app) — Dockerfiles + compose review-ready; never built here (sandbox denies mounts)
- [x] CI: typecheck + lint + unit + e2e + breakpoint screenshots as gates (.github/workflows/ci.yml)
- [~] Deploy to permanent host + uptime/health dashboards + backup/restore drills — DEFERRED to production move (tunnel is temporary; HOSTING.md is the runbook)
- [x] Dead-code audits per phase (LOC is a capability ratio, not a trophy)
- [x] Production hardening (2026-09-23): security model + write auth, probes, graceful
  shutdown, tracked migrations, deterministic CI on fixtures, compose/image fixes —
  receipts in OUTSTANDING.md D, runbook in PRODUCTION.md

## Capabilities ledger (update every phase — THIS is the scoreboard)

| Capability | Now | Target |
|---|---|---|
| Free upstream feeds LIVE | 36 | 40+ |
| Map layers | 25 | 25 (Phase 1 complete; clustering is a Phase 4 problem — Europe pile-up confirmed on screenshot) |
| Static intel datasets vendored | 11 files (bases-657/ports-52/airports-375/datacenters-4899/energy-1618/signals-798/chokepoints-11/conflicts-10/mitre-709/airlines-6065/plane_alert_db-16k/naval_watch) | 7 |
| OSINT enrich endpoints | 7 (/osint/sanctions,geo,ip,mitre,aircraft,airport,vessel) | 7 |
| Skipped deliberately | tracked_names (celebrity list), carrier_ship (stale Mar-2026), JP river cams (no coord API), trends24 (scrape) | — |
| UX shipped (Phase 4 early) | clustering (all layers, click-to-zoom), 5 mission presets, OSINT cmdbar (7 lookups), AREA geo labels | — |
| Phase 2 cache contracts | content_ts + first_ok_at, freeze budgets by class, warming-vs-STALE, SSE resume (?known=) | 6/6 |
| Video wall | 10/10 evergreen 24/7, all oembed-verified (WION event-ID rejected as rot-prone; capped deliberately) | done |
| PORT-doc items ported | ~15 | all free items, keyed items documented |
| UI panels/tabs | 4 tabs (1 file) | 12+ tabs/panels (framework) |
| Cache contracts (WM §) | 2/6 | 6/6 |
| Breakpoints verified | 3 | 3 + e2e |
| Keyed gaps | DEFERRED per zero-key policy (AIS, ACLED, Finnhub, OTX, Telegram token, X, N2YO) — slots documented, code ships disabled-honest where built |
| Backend coverage | ~93% lines (unweighted mean, 35 src files) · hermetic on thoth_test · routes covered live (106 tests) instead | 90%+ |
| Tests total | 209 (106 unit/endpoints/alive + 59 collectors + 15 app vitest + 29 app e2e) | done |
| Linear-dark reskin (2026-09-14) | Inter UI font (mono kept for data) · #08090a canvas + hairline borders · ONE indigo accent, amber survives only as watch/stale data color · sentence-case chrome, dim tabular counts, dark inputs · markers slate-muted 62%, severity still shouts · ticker truncation fix (flex:none alive-fix was beating the shrink rule) · phone sheet assert 30%→25% (130px bottom clearance) | done |
| Pin-preview interaction (2026-09-14) | map click pins the rich preview and opens nothing (inspector is data sink only) · Full view + Zoom buttons inside the pin · hover stays hover: rAF-throttled, same-feature setHTML skip, pointer-events:none so hovers never block picker clicks · fixed 112px satellite slot kills the resize jump · new Panel button + `i` key (tab/phone lost their auto-open) · e2e rewritten to pin→button flow | done |
| Double-hover fix (2026-09-14) | hover + pin/picker rendered two cards for one dot · open-hover registry: map click and pinning stand all hovers down, flush keeps exactly one hover (overlapping fill+dot no longer stack), pinned feature gets no hover echo · single-popup assertions in hud e2e | done |
| 700LOC enforcement + CONVENTIONS.md (2026-09-14) | docs/CONVENTIONS.md (the bar) · MapView 983→599+map-popups 407 (muted→catalog mutedTone, one helper) · Inspector 1307→446+OsintView 506+InspectorTabs 380 · server 1301→289+routes-osint 589+routes-intel 454 (VERSION/LayerParams exported, register fns) · zero TODOs · upstream URLs already co-located as named consts · backend 106+59 green, app 15+29 green | done |
| Free-endpoint hunt #2 + hover-stranding fix (2026-09-14) | fema→disasters + ioda→cyber (new collectors, batch14 6/6) · coops tide gauges→oceans (datum=MSL) + metalerts→weather (CAP schema) · rdap/dns/reverse→routes-recon.ts (38 routes, 16 OSINT) · fema/ioda NEVER_FROZEN (sparse-by-design) · steadyHover re-attach fix (cross-layer closeHovers stranded same-key hovers; proved via MutationObserver probes) · backend 63+109 green · app e2e: polygon fix verified solo, full suite pending box load (30+ LA, browser OOMs) | done* |
| Free-endpoint hunt #3 (2026-09-14, static+live) | A: ooni→cyber (new collector, 30 confirmed/day live) + SANS infocon→cyber (batch15 6/6) · B: iss-live→satellites + snapi→news (15 live) + kalshi→markets (keyword-filtered, cents fixed by test; egress-blocked here, honest-STALE) (batch16 3/3) · C: airports 375→5280 (OurAirports PD, build-airports.ts) + datacenters +387 PDB (build-datacenters.ts, idempotent) + pickAirports/pickFacilities unit tests (import-safe mains) · D: edgar/doh/github/airspace→routes-recon.ts (42 routes, 20 OSINT; doh+github+airspace live, edgar egress-403 honest-502) + emsc→quakes (39 live rows, batch17 6/6) · backend 72+115 green · density fallout fixed in tests (readiness=presence not totals; pinPoint falls across layers; cluster tries top-4; phone drills toward data + waits for tiles) · reload-throttle (page.tsx 45s/layer: version-bump churn killed hover cards as clusters dissolved) · app e2e: all green individually; full-suite record run blocked by box (LA 50+, boots timing out) | done* |
| Preview UI (2026-09-14) | rich hover cards (severity stripe + meta grid + lazy satellite thumbnail) · icons 0.5/0.38 + ±10px pick box · click opens CompleteView (veil-less, bottom clears controls) · phone bottom sheets (inspector + fullview, map stays visible) · sticky scrollable tabs | done |
| Batch13 (2026-09-13) | fx pairs + missing-symbol skip · AQI severity bands + null skip · upstream honest failures | done |
| Airquality layer (2026-09-13) | 29th map layer, Open-Meteo, catalog-visible everywhere, feeds row in UI | done |
| Keyless expansion batch30/loop-5 (2026-09-16) | quakes+geofon-GFZ, fxdepth+bitfinex/kucoin, airquality+luftdaten, markets+npm-dl/crates-trend, social+gh-events, OSINT +3 (dailymed/holidays/npm-dl), batch30 tests 5/5 | done |
| Keyless expansion batch31/loop-6 (2026-09-16) | health+fda-510k/ndc, transit+mbta-Boston, markets+defi-llama/cg-exchanges, batch31 tests 3/3 | done |
| Keyless expansion batch32/loop-7 (2026-09-16) | satellites+amsat-tle/amsat-status (Look4Sat-digested, Maidenhead geocode), batch32 tests 3/3 | done |
| Keyless expansion batch33/loop-8 (2026-09-16) | civic+sf311 (data.sf.gov 311 cases, geo), batch33 tests 1/1 | done |
| Keyless expansion batch34/loop-9 (2026-09-24) | fires+calfire/nsw-rfs/vic-emv (new `wildfires`), weather+eccc-alerts, disasters+ea-floods/mowas (new `warnings`), lib/geo.ts (centroid moved out of weather.ts + GeometryCollection-aware pointOf), batch34 tests 7/7, collectors 249/249; first loop probed live on the production host (216 rows located) and deployed | done |
| Keyless expansion batch34/loop-9 (2026-09-16) | forecast+ipma/iss-now, social+radio-browser-geo, batch34 tests 2/2 | done |
| Keyless expansion batch35/loop-10 (2026-09-16) | cyber+feodo/dshield, social+lobsters/devto, airquality+sg-psi, fxdepth+frankfurter, energy+energy-charts, policy+govtrack, transit+septa/septa-rail, litwatch+pubmed-latest, weather+yr-nowcast — batch35 12/12 (file deleted 2026-09-17 in test refactor; suites ported per-collector) | done |
| Test refactor per-collector/per-route (2026-09-17) | 40 batch files → 49 collectors-*.test.ts (transit ×3 + collectors-lib) + 4 routes-*.test.ts; batch35 + endpoints.test.ts deleted; full collectors 166/167 (forecast/marine pre-existing), npm test 242/242 | done |
| Keyless expansion batch36/loop-11 (2026-09-16) | imf+boc-fx, markets+nbp-pln/cbr, transit+irail/digitraffic, litwatch+arbeitnow/remoteok, weather+metocean-ns, oceans+coops-temp — 9 feeds live-ok | done |
| Keyless expansion batch37/loop-12 (2026-09-16) | weather+sunsched, transit+tfl-bike/tfl-road/swiss-conn, research+2 topics, forecast+8 cities, OSINT+omgeo — batch36 12/12 | done |
| Keyless expansion batch38/loop-13 (2026-09-16) | cyber+threatfox/bazaar/dshield-top/cins, imf+worldbank, quakes-asia+jma-forecast — batch36-file 15/15 | done |
| Keyless expansion batch39/loop-14 (2026-09-16) | cyber+ransomware/msrc, markets+pypi-dl/rubygems/jsdelivr — batch36-file 17/17 | done |
| Keyless expansion batch40/loop-15 (2026-09-16) | transit+tfl-arr, energy+FR-mix, OSINT+maltiverse/urlscan — batch36-file 19/19 | done |
| Keyless expansion batch41/loop-16 (2026-09-16) | crypto+deribit, litwatch+themuse/openfood/musicbrainz, OSINT+crfunder/food/music — batch36-file 21/21 | done |
| Keyless expansion batch42/loop-17 (2026-09-16) | crypto+ETH/DVOL-split, cyber+blocklistde, energy+ES/IT (EU4) — batch36-file 24/24 | done |
| Keyless expansion batch43/loop-18 (2026-09-16) | quakes+turkey-kandilli/afad, crypto+deribit-funding, OSINT+maltsearch — batch36-file 26/26 | done |
| Keyless expansion batch44/loop-19 (2026-09-16) | energy+NL/PL (EU8), quakes+JMA-Osaka, transit+Divvy/CaBi (GBFS×3) — batch36-file 29/29 | done |
| Keyless expansion batch45/loop-20 (2026-09-16) | energy+BE/AT (EU10), transit+KX-arrivals/BE-GE, test-split batch37 — 16/16+15/15 | done |
| Keyless expansion batch46/loop-21 (2026-09-16) | energy+SE/DK (EU12), transit+Euston/GE-LS — 16/16+17/17 | done |
| Keyless expansion batch47/loop-22 (2026-09-16) | energy+PT/GR (EU14), transit+Euston/LS-GE, OSINT maltiverse-IP — 16/16+19/19 | done |
| Keyless expansion batch48/loop-23 (2026-09-16) | transit+tfl-status/irail-conn, quakes+JMA×4, oceans+coops-pred — 16/16+22/22 | done |
| Keyless expansion batch49/loop-24 (2026-09-16) | quakes+JMA×6, rivers+JP gauges, forecast+Sapporo — 16/16+23/23 | done |
| Keyless expansion batch50/loop-25 (2026-09-16) | transit+GBFS×5, weather+sunsched×4 — 16/16+25/25 | done |
| Keyless expansion batch51/loop-26 (2026-09-16) | research+2 topics, markets+Yahoo×4/nasdaq-top — 17/17+26/26 | done |
| Keyless expansion batch52/loop-27 (2026-09-16) | transit+GPK/GBFS×5, weather+sunsched×4, energy+FI/NO/CZ (EU17) — 17/17+28/28 | done |
| Keyless expansion batch53/loop-28 (2026-09-16) | transit+PAC/VIC/LS-BE, energy+HU/SI (EU19) — 17/17+28/28+3/3 | done |
| Keyless expansion batch54/loop-29 (2026-09-16) | flights+opensky-bosporus — batch39 1/1 | done |
| Keyless expansion batch55/loop-30 (2026-09-16) | flights+tokyo/sydney/mexico regions — batch39 2/2 | done |
| Keyless expansion batch56/loop-31 (2026-09-16) | transit+OVL/HSC/Fribourg×2, energy+HU/SI — 17/17+28/28+5/5 | done |
| Keyless expansion batch57/loop-32 (2026-09-16) | transit+WLO/LNB (10 boards), oceans+coops-wind/coops-pressure — batch36-40 54/54 | done |
| Keyless expansion batch58/loop-33 (2026-09-17) | transit+6 boards STD/CGT/LVT/EBY/HBN/BND + roads A1/A10/A13/A40 + 6-line status + swiss BE-ZH/GE-BE, energy-eu+8 (RO/SK/HR/IE/LU/EE/LV/LT, 25-country loop), oceans+7 CO-OPS ring — energyeu 11/11 + transit-tfl/ch/oceans 22/22 EXIT=0 | done |
| Keyless expansion batch59/loop-34 (2026-09-17) | fx+EUR-base cross, energy-uk+48h forecast peak + generation mix — fx/energyuk/sentiment 8/8 EXIT=0 | done |
| Keyless expansion batch60/loop-35 (2026-09-17) | airwx+G-AIRMET + intl SIGMETs, radar+satellite IR, quakesnz+volcano VAL + news, fires+N21/NPP rungs — 7/7 EXIT=0 | done |
| Keyless expansion batch61/fincept-1 (2026-09-17) | markets+CBOE US/EU + fiscal-rates, imf+DBnomics-BEA, research+yahoo-search — 16/16 EXIT=0 | done |
| Keyless expansion batch62/fincept-2 (2026-09-17) | health+UNESCO enrolment, symdir static + symbol route — health 4/4 EXIT=0 | done |
| Keyless expansion batch63/fincept-3 (2026-09-18) | hdx+CKAN catalog pulse (CA/Swiss/AU/SI counts) — hdx 3/3 EXIT=0 | done |
| Keyless expansion batch65 (2026-09-18) | imf+WB debt/growth source-series (USA/GBR debt, USA/CHN growth), markets+cg-movers/trending, crypto+coinbase-spot/llama-tvl — imf/markets/crypto 19/19, npm test 255/255 | done |
| Terminal pillar batch64/fincept-UI (2026-09-18) | 006_terminal (portfolios/positions/notes/screens) + 8 routes + PULSE/PORTFOLIO/SCREEN/NOTES tabs + symbol route — npm test 255/255, app 15/15 | done |
| Terminal inspection fixes (2026-09-18) | bitfinex r[7]/r[6] + fxecb/fxnbp ids + PULSE FX/EQUITIES — fxdepth/fx 7/7, browser verified | done |
| Terminal round-2: ER-API dates + Yahoo chg (2026-09-18) | RFC2822 parse, EUR USD/USD skip, chartPreviousClose fallback, fiscal titles, CmdBar pulse/portfolio/screen/notes — fxdepth/markets 17/17, app 16/16, browser verified | done |
| Phone UI refine (2026-09-18) | tab scrollIntoView, sheet grabber, 44px targets, cmdbar overflow fix — breakpoints 4/4, app 16/16 | done |
| Airwx overlap + icons round-2 (2026-09-18) | zoom wash + severity outlines, 10 Lucide icon swaps — hud polygon green, app 16/16 | done |
| Server monitor (2026-09-18) | MONITOR tab + health enrichment + Panel removal — backend 255/255, app 17/17, alive 3/3, breakpoints 4/4 | done |
| Keyless expansion batch29/loop-4 (2026-09-16) | metar wdir-VRB fix (live 80, awc-metar green — health 7→6), markets+npm-dl/crates-trend, social+gh-events, batch29 tests 2/2 | done |
| Keyless expansion batch28/loop-3 (2026-09-16) | metar obsTime epoch fix (live 40) + hans vnum-null fix (live 69), health+fda-faers, civic+austintraffic, research+openaire-OAF, batch28 tests 3/3 | done |
| Keyless expansion batch27/loop-2 (2026-09-16) | research+core/figshare, fxdepth+paprika-3coins, cyber+spamdrop-DROP60, batch27 tests 3/3 | done |
| Keyless expansion batch26/loop-1 (2026-09-16) | weather+yr-forecast/nws-obs/fmi/dwd-warn, solar+silso-daily, transit+gbfs/tfl-aq/tfl-tube, markets+moex-IMOEX, batch26 tests 4/4 | done |
| Keyless expansion batch25 (2026-09-16) | relief+ocha/ifrc, crypto+gateio/spamrep, litwatch+medrxiv, disasters+sentry, forecast+bom-4AU, OSINT 51→57 (rxnorm/chembl/sbdb/deps/nasa-img/planespotter), CmdBar+OsintView+alive wiring, batch25 tests 6/6 | done |
| Keyless expansion batch24 (2026-09-16) | 55→56 collectors (+transit: swiss-rail 6 hubs/sncf/metrotransit), forecast+brightsky/nasa-power, statics owid-energy 59 + sunspots 120 (seeded live), OSINT 49→51 (funder/museum), CmdBar+OsintView+alive+smoke wiring, transit layer catalog+intel, batch24 tests 5/5 | done |
| Keyless expansion batch23 (2026-09-16) | 54→55 collectors (+social: masto/reddit/lemmy/flickr/inat/gbif), research+zenodo/hal/inspire, fxdepth+erapi-usd/eur/coinlore, imf+bls-cpi, weather+metocean/metsun, flights+adsbfi, litwatch+stack, OSINT 40→49 (fda-drug/gene/ontology/protein/package/daylight/zip/transit/name), CmdBar+OsintView wiring, batch23 tests 7/7 | done |
| Keyless expansion batch22 (2026-09-16) | 51→54 collectors (quakes-asia JMA+BMKG, civic NYC311/Chicago/LA, energy-eu DK-spot+carbon-hist), quakes+INGV, weather+metnow/nws-fx/HKO, spacewx+scales/WWV/GOES-xray-1d, disasters+JPL-CAD, markets+global/blockchair/gold/NYFed/Fiscal, cyber+5 sec-RSS, health+FDA recalls, news+WHO-RSS, policy+UK bills, vatsim+IVAO, sats+rocketlive, rivers+OM-flood, OSINT 31→40 (robtex/fdic/doh-cf/token/wikidata/wiki/books/stack/nominatim), CmdBar+OsintView+smoke-robtex coverage, batch22 tests 15/15 | done |
| Keyless expansion batch21 (2026-09-15 #3) | 48→51 collectors (vatsim, hans, autobahn), crypto/fx/cyber/satellites/research depth, UN sanctions 1,011 rows, OSINT 29→31 (ghsa/ror), CmdBar+OsintView+smoke coverage | done |
| Keyless expansion batch20 (2026-09-15 #2) | 37→48 collectors (crypto, solar, fxdepth, quakesnz, predict, radar, energyuk, litwatch, storms, rivers, imf), OSINT 25→29 (mitre-cve/geocode/macro-imf/ports), CmdBar+OsintView+smoke coverage | done |
| Keyless expansion batch19 (2026-09-15) | 30→37 collectors (metar, forecast, sentiment, research, health-who, hdx, policy-fedreg), 28→33 layers (metar/forecast/research/health/policy), OSINT 20→25 (epss/osv/circl/doh-google/ipwhois), statics energy idempotent + ports 52→1104 + conflicts 10→70 | done |
| Macro lookup (2026-09-13) | `macro <cc>` → World Bank GDP/inflation/pop, e2e-covered | done |
| Batch11/12 (2026-09-13) | finnhub disabled + keyed earnings rows · telegram push disabled/send/4000-char cap/errors · POST /api/notify alive cover | done |
| Video wall 10 (2026-09-13) | +TRT/Euronews/ABC/AlArabiya, all oembed-verified evergreen 24/7 | done |
| Company identity (2026-09-13) | `company <name>` → GLEIF LEI via /api/osint/company, e2e-covered; exposure treemap still needs dataset | done |
| Batch10 (2026-09-13) | adsb-garbage→opensky fallthrough · disasters EONET-down honest fail · celestrak source stamp · mirror-total-failure honest fail · ingested_at last-seen refresh | done |
| Imagery (2026-09-13) | /api/imagery earth-search STAC → freshest low-cloud S2 scene · OBJECT SATELLITE block · imagery.test.ts 4/4 + alive entries | done |
| Stats-decay fix (2026-09-13) | ingested_at=now() on upsert (store + seed) — re-seen rows stay in the 24h stats window; live suite green without reseeds | done |
| HUD redesign (2026-09-11) | verbose hover · small dots · unified stack picker · rounded system · SSE status · ObjectDetail · 18 new e2e + shots | done |
| Coverage | ~93% lines backend, hermetic on thoth_test (conflicts/gdelt/otx/satellites 100%, weakest: imagery 69%, queries 78%) | done |
| Satellites fallback | CelesTrak hang/throw now falls through to tle-mirror (was !ok-only); batch8 rot-proofed with fresh-epoch TLE | done |
| Coverage hermeticity | `test:coverage` pinned to thoth_test, liveness suite out (it needs the live dev stack); batch TRUNCATEs can never wipe dev again | done |
| Trend UI | `trend <layer> [days]` SVG chart + sitrep series in Inspector | — |
| Video audit | 2/2 stream IDs exist (oembed); liveness unassertable without watching | — |
| Sitrep cron | host cron owns daily snapshot (docs/BACKUP.md), not the worker | — |
| Boot time | map-sources-ready 24s → 0.4s (loadAll pool-6 + perims 3.4MB→120KB via maxAllowableOffset) | — |
| Analytics | /api/analytics/trend (per-day series + sitrep archive, clamped 90d) | growing |
| Watch loop closed | watch-match toasts (seed-silent, new arrivals only) | — |
| Inspector | NEARBY 100km proximity (dossier-backed, self excluded) + KEV→CVE one-click NVD | — |
| Alive verification | backend alive suite (33: every collector attempted, 33 layers serve, 25+ routes answer) + app alive e2e (3 breakpoints, zero errors, no overflow) | permanent |
| Satellites | CelesTrak 403 → TLE-mirror fallback (8 curated NORAD IDs, skip-and-continue) | — |
| Responsive | ticker/tabs/cmdbar/timeline phone fixes, overflow asserted in e2e | — |
| Map layers | 33 (+metar points, +forecast cities/seas, +research/health/policy intel, +perims polygons, +airwx SIGMETs) | — |
| OSINT endpoints | 25 (+epss FIRST, +osv affected/fix, +circl failover, +doh-google, +ipwhois) + /api/search + /api/watch + /api/sitrep + /api/notify (disabled-honest) + /api/imagery + layer export | — |
| Sitrep archive | daily markdown snapshots in `sitreps` table — history clock for market HUD | growing |
| App widgets | ThreatClock + MiniMap + EntityGraph (all e2e-covered) | — |
| UI refine (2026-09-10) | status strip ZULU·DEFCON·LIVE·ENT·Kp (desk) + tab rail cleanup + dark compact attribution; 10/10 app e2e | done |
| App lint | biome.json config, `biome check` zero diagnostics | keep clean |
| API same-origin (2026-09-09) | `/api/:path*` rewrite → backend; client default `""`, SSE/export via `API` const; fixes tunnel zeros + mixed-content | done |

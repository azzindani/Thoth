# PORT — FinceptTerminal (terminal UX + market data, PARTIAL mine)

Repo: https://github.com/Fincept-Corporation/FinceptTerminal — cloned
2026-09-17 to `/workspace/.tmp/fincept` (shallow, 80M, AGPL-3.0). Native
C++20/Qt6 Bloomberg-style workstation: 54 screens, ~50 services, DataHub
pub/sub, 1,423 Python data scripts. Full architecture in `docs/ARCHITECTURE.md`.

Digest rule: endpoints keyless-first (zero-key policy holds); UX shapes
ported as doctrine (single-operator scope — no users/roles rows).

## Endpoint audit (probed live, keyless-only)

| Source (fincept script) | Probe | Verdict |
|---|---|---|
| CBOE delayed indices US/EU (`cdn.cboe.com/.../all_us_indices.json`, `.../all-indices.json`) | 200 — VIX 15.44, SPX/NDX/RUT, 6 EU flagships | SHIPPED batch61 (`cboe`, `cboe-eu` → markets) |
| FiscalData avg rates (`avg_interest_rates`) | 200 — Bills 3.788/Notes/Bonds/TIPS | SHIPPED batch61 (`fiscal-rates` → markets) |
| DBnomics BEA GDP (`api.db.nomics.world/v22/series/BEA/NIPA-T10105`) | 200 — $30.76T 2025 | SHIPPED batch61 (`dbnomics-bea` → markets) |
| Yahoo symbol search (`query2.../v1/finance/search`) | 200 — sector/industry | SHIPPED batch61 (`yahoo-search` → research) |
| UNESCO enrolment (indicator 20062, `geoUnitType=NATIONAL`) | 200 — 25/25 countries | SHIPPED batch62 (`unesco-enrol` → health) |
| NasdaqTrader SymDir (`nasdaqtraded.txt`, 12,516) | 200 | SHIPPED batch62 (static + `/api/osint/symbol`) |
| CKAN catalog pulse (CA/Swiss/AU/SI `package_search`) | 200 | SHIPPED batch63 (`ckan-*` → disasters via hdx) |
| ECB eurofxref + data-detail-api | 200 | already covered / cross-check noted, no new leg |
| Yahoo chart, Nasdaq screener, CoinGecko, FiscalData TGA | 200 | already covered |
| CBOE VIX futures curve | 403 S3-denied | dead |
| OECD SDMX dataflows | 404 (their own scripts admit drift) | dead |
| WTO Timeseries | 401 subscription key | keyed — skip |
| Congress API | API_KEY_MISSING | keyed — skip |
| FRED / BEA-direct / BLS-keyed | keys | keyed — skip (BLS no-key CPI already covered via imf) |
| WITS | 307 HTML service page | dead |
| US catalog.data.gov CKAN URL | 404 (fincept URL stale) | parked — re-add when confirmed |
| Italy dati.gov.it CKAN | 403 | dead |
| Brazil dados.gov.br CKAN | 401 | keyed — skip |
| akshare (1,200+ CN endpoints) | needs Python lib, different machine | parked — not HTTP-digestible |

## UX digestion (batch64 — this port)

Fincept shapes ported (Qt → React, same information, our primitives):

| Fincept | Thoth |
|---|---|
| `MarketPulsePanel` (fear/greed + breadth + gainers/losers + global snapshot + market hours) | `PulseTab` (VOLATILITY/EUROPE/CRYPTO/RATES/FX/EQUITIES sections over live `markets` rows + FNG header) |
| `WatchlistScreen` (SYMBOL/NAME/PRICE/CHANGE/CHG%/HIGH/LOW/VOLUME, sort-safe selection, CSV import) | `PortfolioTab` (portfolios + positions CRUD; live quotes via existing layer rows, not a quote table — no licensed feed) + `ScreenerTab` (filter + gainers/losers sort over `markets`) |
| `ScreenerScreen` (62-symbol basket, TOP GAINERS/LOSERS/VOLUME/PRICE sorts, render coalescer) | `ScreenerTab` (same two sorts; filter box; coalescing unnecessary — single fetch, not 62 topics) |
| `FinancialNote` (title/body/category/priority/tags/tickers/sentiment/favorite/archived) | `notes` table + `NotesTab` (title/tickers/category/sentiment/favorite/archived; priority + templates deferred) |
| `NotesRepository` / `BaseRepository<T>` CRUD | `/api/portfolios` `/api/notes` `/api/screens` (zod params, upsert ids, honest 400s) |
| `MarketDataService::mover_symbols` / `global_snapshot_symbols` / category baskets | documented as the watchlist-seed vocabulary; live quote tables need licensed feeds — not built |
| `RelationshipMapTypes` (NodeCategory ×14, EdgeCategory ×5) | ontology seed — recorded, not built (needs entities-table design pass) |
| `DataHub` pub/sub (one-fetch/many-subscribers, TopicStats, pattern subscribe) | recorded, not built (SSE is point-to-point; fan-out needs its own design) |

Deliberately NOT ported: live quote tables (licensed data), broker/paper-trading execution, SSO/RBAC/billing, MCP/LLM agent wiring, node-editor workflows, backtesting (needs history to Q1 2027 per OUTSTANDING).

## Verdict

Endpoints: batches 61–63 shipped the keyless cream (7 feeds + 1 static).
UX: batch64 ports the analyst-object layer (pulse/portfolio/screen/notes)
on live data. Remaining (ontology, DataHub fan-out, quote tables) are
design passes, not digests — the repo is squeezed dry at both layers.

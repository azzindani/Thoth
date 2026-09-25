# Changelog

This file lists the notable changes to Thoth. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Thoth has no
tagged releases yet, so entries are grouped by date. Changes that need
operator action are also listed in
[Upgrading](docs/operations/upgrading.md).

## [Unreleased]

### Changed
- Reorganized the documentation into a structured `docs/` tree
  (architecture, operations, reference, development). Added `CONTRIBUTING.md`,
  `SECURITY.md` and this changelog. The build ledgers and research notes
  moved to `docs/archive/`.

## 2026-09-24

### Added
- Data sources: JMA warnings (2026 "r8" system) and JMA volcano alert
  levels; IFRC GO emergencies with appeal funding; WHO Disease Outbreak
  News; abuse.ch SSLBL C2 certificates; national CERT advisories (CERT-FR,
  CERT-EU, CCCS, JPCERT/CC); BfS ODL German gamma dose-rate network;
  Pegelonline waterway gauges; Hong Kong Observatory warnings; Australian
  and US agency wildfire incidents (CAL FIRE, NSW RFS, VIC EMV, QLD, WA
  DFES, ACT ESA); Environment Canada alerts; England flood warnings;
  German civil-protection warnings (MoWaS, KATWARN, BIWAPP, LHP, police).
- Access-token gate for the app. Open `/?token=` once for a 30-day session.
  Revocable extra keys through `APP_TOKENS` and `APP_TOKENS_FILE`.

### Changed
- **Breaking:** `APP_BASIC_AUTH` replaced by `APP_ACCESS_KEY`.
- **Breaking:** the compose project is now `thoth`, which gives new
  container and volume names. See [Upgrading](docs/operations/upgrading.md).
- Outbound connects get 2.5 s per address, instead of Node's 250 ms
  default. This recovered distant upstreams that failed as "fetch failed".
- Smoother map on phones: no backdrop blur on touch devices, capped canvas
  pixel ratio, deferred live updates while the camera moves.

### Fixed
- JTWC tropical storm positions: per-item parsing, correct warning text,
  hurricanes recognized.
- News RSS feeds retry once after a connect-level failure.
- Several upstream changes: Energy-Charts windows, Copernicus EMS list path,
  adsb.lol v2 endpoint, OCHA `Accept` header, arXiv sort key, OpenAlex and
  Crossref pacing.

### Removed
- EPA Ireland radiation monitoring (upstream pages exceed its gateway
  timeout). Replaced by BfS ODL.

## 2026-09-23

### Added
- **Monitoring:** run history, per-source outcomes and an upstream HTTP call
  log; worker heartbeat and schedule; ops alerts for failing, frozen and
  mass-failing feeds, with Telegram push; run-now queue; Prometheus
  `/metrics`; batched retention; Monitor tab with data tables.
- **Viewport-aware layer slices** (`?z=&bbox=`) with spatial sampling at
  world zoom. The static catalogs are fully reachable when zoomed in.
- **Intelligence layer (no LLM):** cross-agency earthquake de-duplication,
  corroborated `incidents` (PostGIS DBSCAN), and `anomalies` against 7-day
  baselines.
- **Analyst workflow:** 72 h time replay, area watches, the
  "since you last looked" digest, country pages, saved and shareable
  workspaces, map notes, sitrep report with print/PDF/Markdown export, and
  the command palette (Ctrl/⌘+K).
- New layers: `navwarn`, `gpsjam`, `advisories`, `vessels` (Baltic AIS),
  `displacement`, `cables`. New sources: SPC, tsunami, FAA airport status,
  Copernicus EMS, ENISA EUVD, Tor exits, UK FCDO.
- Floating-panel UI redesign ("instrument on warm black"), collapsible
  chrome, pop-out windows.

### Changed
- **Production hardening:** Express 5, JSON 404/500 with request ids,
  security headers, `CORS_ORIGIN`, per-client rate limiting through
  `TRUST_PROXY`, `API_WRITE_KEY` write gate (fail closed in production),
  `livez`/`readyz` probes, shared SSE poller with resume, graceful
  shutdown, tracked transactional migrations, statement timeouts.
- **Breaking:** the database volume path changed, so dump before upgrading.
  `API_WRITE_KEY` is now required. The browser no longer calls `:4000`
  directly.
- MapLibre GL 6, which fixes a critical XSS advisory.

## 2026-09-09 to 2026-09-18

### Added
- The Next.js 16 terminal replaces the original single-file UI: globe and
  flat map, responsive desk/tablet/phone layouts, inspector tabs, command
  bar, timeline, missions and theatres.
- Grew from 6 collectors to about 70, covering more than 300 keyless
  upstream sources: aviation, maritime, seismic, weather, space weather,
  hazards, cyber, markets, research, health, policy, energy and transit.
- On-demand OSINT lookups (IP, ASN, RDAP, DNS, certificates, CVE/EPSS/OSV,
  sanctions, company registries and more).
- Static datasets: military bases, ports, airports, data centres, power
  plants, chokepoints, conflicts (UCDP), MITRE ATT&CK, UN sanctions, and a
  symbol directory.
- Analyst workspace: portfolios, notes, saved screens, and the market
  pulse.
- Freshness contracts: content timestamps, frozen and warming states,
  last-good-data serving, SSE resume.
- CI (typecheck, lint, unit, collector contracts, route and alive suites,
  Playwright e2e, Docker build) and Dependabot.

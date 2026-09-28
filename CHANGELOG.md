# Changelog

This file lists the notable changes to Thoth. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the
version is 0.x, a minor release may include breaking changes; they are
marked **Breaking** here. Changes that need operator action are also
listed in [Upgrading](docs/operations/upgrading.md).

## [Unreleased]

### Added
- **Cross-layer rules** in the intelligence pass, shown as incidents with
  their evidence linked: an internet outage in a country where submarine
  cables land, and an air traffic drop within 300 km of recent conflict
  reports.
- Workspaces save the open pop-out windows (position, minimised state,
  the object) and reopen them, shared links included. Workspaces saved
  before leave the open windows alone.
- **Paper theme.** Settings → Display → Theme: Dark, Paper (warm paper
  and ink, on the CARTO Positron basemap) or Follow system. It is a token
  swap: the same layout and components, applied before first paint.
- **Installable app.** A web app manifest, icons and a service worker
  (which caches nothing, so data is never stale) let Chrome, Edge, Android
  and iOS install Thoth as an app. Settings → Alerts → *Critical alert
  notifications* shows system notifications for new criticals while Thoth
  is in the background; tapping one opens the alert.
- **Outbound webhooks** (`WEBHOOK_URLS`, `WEBHOOK_SECRET`): each URL gets
  a signed JSON POST for every new critical alert and watch match, with
  retries and a baseline so switching them on does not replay what is
  already live. Migration `011_webhooks.sql` adds the delivery log.
- **Reader API keys** (`API_READ_KEYS`, or `API_READ_KEYS_FILE` re-read
  on change): named read-only keys that identify their caller in the access
  log and can carry their own per-minute limit. `API_READ_REQUIRED=1`
  closes `GET /api` to keyless callers; the app then sends `API_READ_KEY`
  server-side.
- **OpenAPI 3.1 document** at `GET /api/openapi.json` and in
  `docs/reference/openapi.json`, covering all 120 routes. Parameters and
  bodies come from the zod schemas the routes validate with; a unit test
  fails when a route is undocumented or the committed spec is stale.
- **Content-Security-Policy** on every app page. Scripts run only with a
  per-request nonce; styles, fonts, images, map data, frames and
  connections are limited to an audited allowlist (CARTO basemap, Esri
  imagery, Google Fonts, YouTube embeds, CCTV stills over HTTPS), and
  framing is refused. `APP_CSP=report` or `off` is there for diagnosis.

### Changed
- Pages render per request (a CSP nonce cannot be baked into prerendered
  HTML).

### Fixed
- `osint holidays` defaulted to 2026 instead of the current year.
- Switching to SAT before the basemap style had loaded (slow or blocked
  CDN) threw "Style is not done loading" and took the app down. The
  imagery is added once the style is in.

## [0.1.0] - 2026-09-28

The first tagged release. It contains all the work to date: the entries
below, and the dated pre-release entries after this section.

### Added
- **Settings** (gear in the status bar, More → Settings on phones, the
  command palette, or the `,` key), kept per browser:
  - five **layout sizes** (XS, S, M, L, XL) scaling panels, bars,
    buttons and spacing, and five independent **text sizes**; M is the
    original design;
  - solid panels (no see-through blur) and reduced motion;
  - times in UTC or local time;
  - hover previews and the overview minimap on or off, and "open where I
    left off";
  - critical and watch pop-ups on or off (the Alerts badge keeps
    counting);
  - restore defaults, and clear the saved panel layout.
- **Phone navigation.** A bottom bar (Layers · Intel · Search · Alerts ·
  More) reaches every tool on a phone. Search shows the command line on
  demand; Alerts badges new criticals; More holds map style, globe,
  cinema, missions, replay, entity graph, sitrep, area dossier, saved
  views and every command. The ticker has a ⌘K button for the command
  palette on desk and tablet, and tablet has INTEL to open the inspector.
- Phone bottom sheets (Layers, Inspector, Full view, Tools) snap between
  half and full height: swipe up on the grabber to expand, swipe down to
  step back to half and then close; a tap on the grabber toggles
  half/full. The Layers sheet has a close (✕) button.
- The tablet layer rail expands (☰) into the full panel with names,
  switches, severity filter, theater, mission and layer search; toggling
  from the folded rail says what changed.
- Long-press on the map opens the area dossier on touch screens.
- On/off switches on every layer row, plus a switch on each layer group
  header that shows or hides the whole group.
- A map legend (severity rings, grouped counts) and ‹ › arrows on the
  inspector's tab strip when tabs are hidden.
- Map preview cards show the record's telemetry and details (altitude,
  speed, heading, route, magnitude and similar fields) and the last-seen
  time in UTC. On phones the pinned card is a full-width sheet at the top
  of the screen, and the map pans so the object stays visible below it.
- **Source and verification on every object.** Map cards and popped-out
  windows have a Source ↗ button (the record's own link, or the
  publisher's site when the feed has no per-item link), show the
  record's host next to its source, and link aircraft, vessels and
  satellites to public trackers by their own identifier (ADS-B Exchange,
  FlightAware, MarineTraffic, VesselFinder, N2YO, CelesTrak). CCTV cards
  show the camera's latest still.
- The full view and inspector gained a provenance section: open the
  original report, the source feed's health (status, poll cadence, last
  successful poll, latest fetch and HTTP code), when the item was
  observed and last re-confirmed, confidence, other sources that reported
  the same event (or a clear "single source" warning), incident member
  reports with their links, OpenStreetMap/Google Maps at the spot, and
  the raw stored record.
- Alerts, nearby items, news brief items and incident timelines link each
  item to its source.
- `GET /api/event?id=` returns one event with its provenance.

### Changed
- Compose passes `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to the
  worker, so ops alerts reach Telegram without an override file.
- The changelog dialog shows the release version and links the full
  changelog (it listed build phases); Settings shows the version.
- Card and full-view imagery is Esri World Imagery centred on the object
  under a crosshair, replacing the Sentinel-2 scene thumbnail (which
  showed the whole ~110 km scene, not the point). The full view still
  links the latest Sentinel-2 pass. Moving objects show no imagery.
- VATSIM and IVAO flights are stored once per callsign and updated in
  place; pilots who disconnect or land are removed on the next poll.
- CINEMA is an on/off toggle that spins over the chosen basemap (it used
  to replace SAT/NVG and could only be left through DARK); pressing the
  map stops it.
- Every command answers: replies show on phones too (as a bubble over
  the command line), `help` is a grouped panel, and unknown input names
  the command. `sat` switches the basemap instead of toggling the
  satellites layer.
- Critical toasts can be tapped to open the event and dismissed; watch
  toasts open the watch matches; notices are neutral, not red.
- A phone on its side (≤500 px tall, <1024 px wide) keeps the phone
  layout.
- With a severity filter on, layer counts show what the map holds for
  that severity.
- `REQUESTS_PER_MIN` defaults to 300 (was 120), matching compose.
- Reorganized the documentation into a structured `docs/` tree
  (architecture, operations, reference, development). Added `CONTRIBUTING.md`,
  `SECURITY.md` and this changelog. Removed the build ledgers, the
  per-batch endpoint log and the upstream-project research notes.

### Fixed
- The card's Zoom button (and any fly-to the spot already in view) froze
  the map for good in globe view: MapLibre computed a NaN zoom. Such
  moves ease instead, and a watchdog restores the last good camera.
- Right-click on the map and `dossier lat,lng` opened an empty Area tab,
  and `sdn name` an empty sanctions search: their arguments were dropped.
  Both lookups now run and show loading, failure and no-match states.
- Layers refused by the rate limit (HTTP 429, easy to hit by reloading)
  stayed empty with no sign. Failed layers are flagged "!" in the layer
  list and retried after `Retry-After`.
- A page load toasted every critical alert of the last 24 hours at once.
- The flights layer showed every stored snapshot of an aircraft, including
  positions days old. The map and API now return each aircraft's latest
  position only, for aircraft seen in the last 45 minutes.
- "Esri World Imagery" stayed in the map credits after leaving SAT.
- Tables on phones and tablets hid their extra columns without a hint
  (they now fade at the scrollable edge); the tablet inspector covered
  the dock's REPLAY/GRAPH buttons; the Monitor was squeezed on tablet.
- The changelog and sitrep dialogs now take focus, trap Tab, close on
  Escape and hand focus back.
- The "Full view" button in map cards no longer wraps and gets cut off.

### Removed
- Dependabot version-update configuration (`.github/dependabot.yml`).

## 2026-09-24 (pre-release)

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

## 2026-09-23 (pre-release)

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

## 2026-09-09 to 2026-09-18 (pre-release)

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

[Unreleased]: https://github.com/azzindani/Thoth/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/azzindani/Thoth/releases/tag/v0.1.0

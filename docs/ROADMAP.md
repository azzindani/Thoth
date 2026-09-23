# Thoth — Roadmap (2026-09-23)

Everything agreed after the floating-UI pass, in shipping order. Each phase
lands as its own commits with CI green before the next starts; each item
names what "done" means. Status: `[ ]` open · `[~]` in progress · `[x]` shipped.

Principles that apply to every phase:
- Free and keyless first; a keyed source ships disabled-honest.
- A source isn't "live" until the monitor has seen it succeed on a
  networked host (this build sandbox has no egress — contract tests only).
- No feature without tests; no UI without the three breakpoints checked.

## P1 — Monitoring you can operate from `[x]`

The monitor shows *now*; it must also show *history*, *cadence* and *why*.

- [x] **Run log**: every collector run (duration, outcome, rows stored,
      error) and every source outcome recorded; 14-day retention.
- [x] **Endpoint log**: every upstream HTTP call (host, path, status,
      latency, bytes) captured at the fetch layer — per-endpoint health,
      not just per-source.
- [x] **Per-source stats**: success rate 24h / 7d, consecutive failures,
      p50 / p95 latency, rows per run, last HTTP status.
- [x] **Schedule**: next run due / overdue per collector.
- [x] **Worker heartbeat**: "worker down" is visible, not silent staleness.
- [x] **Source catalog**: upstream hosts (observed), collector, layer,
      cadence, key requirement — `/api/monitor/catalog`.
- [x] **Alerts**: source failing 3× in a row, or frozen → an `ops` alert
      (toast + alerts tab), cleared on recovery; Telegram push when a bot
      token is configured.
- [x] **Run now**: per collector, write-key protected, picked up by the
      worker within seconds.
- [x] **`/metrics`**: Prometheus text format for Grafana / uptime tools.
- [x] **Retention**: run/endpoint logs 14 d, raw fetch log 14 d, events
      configurable (default 180 d, 0 = forever); database size shown in the monitor.
- [x] **Monitor v2 UI**: summary header, 48-run strip per source, stats
      columns, next-due, run-now, per-source detail, endpoints view —
      as sortable data tables (DataTable primitive); the panel widens on
      desk while the monitor is open (EXPAND / COMPACT).
- [x] **Mass failure**: ≥ 25 % of feeds failing (min 10) collapses into
      one critical `ops:mass` alert; individual pushes are suppressed.

## P2 — Scale the map past 500 rows per layer `[ ]`

- [ ] Layer slices become viewport-aware: `bbox` + zoom-aware limits, with
      spatial sampling at world zoom so every region is represented.
- [ ] Client reloads layers on camera settle (debounced), keeps clustering.
- [ ] Static catalogs (airports 5,280, bases, ports…) fully reachable when
      zoomed in.

## P3 — Source batches `[ ]`

Each batch 8–10 keyless sources, contract-tested, fixtures, monitor-visible.
- [ ] Batch 32: Copernicus EMS activations, FAA airport status, Finnish
      AIS (Digitraffic marine), UNHCR displacement, FEWS NET IPC phases,
      submarine cables (static), RIPE RIS Live (BGP), ENISA EUVD, Tor exits,
      UK FCDO advisories.
- [ ] Following batches: largest remaining keyless feeds per uncovered
      theme (see ENDPOINTS.md "NOT free" list for what stays out).

## P4 — Intelligence layer (no LLM) `[ ]`

- [ ] **Incidents**: space-time clustering across layers into one incident
      card with a timeline; cross-source duplicate merge (USGS/EMSC).
- [ ] **Anomalies**: per-region/per-layer baselines; flags for sudden drops
      or spikes (airspace emptying, jamming spike, outage + cable, news
      volume surge).

## P5 — Analyst workflow `[ ]`

- [ ] **Time replay**: scrub/play the last 24–72 h on the map.
- [ ] **Area watches**: draw a circle/polygon; alert when anything enters.
- [ ] **Since you last looked**: new / escalated / resolved digest.
- [ ] **Country pages**: advisories, conflicts, hazards, outages,
      sanctions, markets, news per country.
- [ ] **Saved workspaces**: layers + camera + windows + filters, named and
      shareable by link.
- [ ] **Map notes** → sitrep export with map snapshot / PDF.
- [ ] **Command palette** (Ctrl+K) and `?` shortcut sheet.

## P6 — Thoth as a platform `[ ]`

- [ ] OpenAPI spec generated from the zod schemas; reader API keys with
      rate limits; outbound webhooks for alerts.
- [ ] MCP server so an assistant can query layers, incidents and alerts.

## P7 — Production polish `[ ]`

- [ ] Self-hosted vector basemap (PMTiles, keyless) + the warm style.
- [ ] Installable PWA; push notifications for critical alerts.
- [ ] Content-Security-Policy with an audited allowlist.
- [ ] Backups verified end to end (BACKUP.md drill).

## Already shipped (2026-09-23)

Production hardening, CI, design system, floating panels, collapsible
chrome + clear view, pop-out windows, panel-aware cards, hover fixes,
sources batch 31 (navwarn, gpsjam, advisories, SPC, tsunami, JTWC).

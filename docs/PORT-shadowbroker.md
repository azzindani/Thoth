# PORT — shadowbroker (tab-system spec + static datasets)

Stack: Next.js 16 + React 19 frontend (~100K) + Python backend (~200K: `routers/`
`services/` `analytics/` `gate_sse.py`). Rest is JSON data + lockfiles, NOT logic.

## Static datasets to vendor (keyless, immediate)

| File | Content | Thoth target |
|---|---|---|
| `backend/data/plane_alert_db.json` (129K lines) | aircraft alert DB | `intel` static layer |
| `backend/data/datacenters_geocoded.json` (53K) | geocoded datacenters | `intel` static layer |
| `backend/data/tracked_names.json` | watched entities | SDN/sanctions cross-ref |
| `frontend/src/lib/airlines.json` (60K) | airline registry | flights enrich (callsign → airline) |

## Components → our Phase 4 tabs (in priority order)

`GlobalTicker` `NewsFeed` `MarketsPanel` `CyberThreatPanel` `MapLegend` `FilterPanel`
`AdvancedFilterModal` `AlertToast` `GtTopAlertsStrip` `EntityGraphPanel`
`DatalinkMessagesBlock` `HlsVideo` `MiniMap` `FindLocateBar` `KeyboardShortcutsOverlay`
`ChangelogModal` `AisUpstreamBanner` (pattern for our STALE banners) `MeshTerminal`
(port command grammar into our cmdbar) `InfonetTerminal`.

## Backend patterns

- `gate_sse.py`: SSE gateway with resume — our `/api/stream` hardening model (Phase 2).
- `routers/ + services/ + analytics/`: per-domain service split — model for our
  `src/workers/collectors` growth past ~20 sources.
- `proxy.ts` + `ais_proxy.js`: SSRF-guarded upstream proxy — adopt for any
  browser-direct fetches (CCTV images, HLS).
- `GtAnalyticsHud` / `GtBacktestPanel`: markets analytics — Phase 6 (needs history first).

## Explicitly OUT of scope

MeshChat, mesh/, desktop-shell/, helm/, wormhole scripts, openclaw-skills.
Rationale: product suite, not god-eye. Recorded so nobody re-litigates.

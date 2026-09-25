# PORT — global-monitor (layer-primitive pattern)

Stack: Vite + React (`client/src`) + Express + WebSocket (`server/`). v1.0.0. Smallest
repo (2.4K lines) — value is architectural, not data.

## Free sources

| Source | Where | Thoth status |
|---|---|---|
| CelesTrak TLE | `SatellitesLayer.jsx` (`celestrak.org`, 4 refs) | TODO new `satellites` layer — biggest gap it fills |
| OpenSky | server | LIVE (our fallback) |
| USGS | server | LIVE |
| GDELT | server | STALE backup (ours same) |

Keyed: OpenWeatherMap. Unclear: ships layer source (client calls own server;
`server/` is only `config.js`+`index.js` — likely AISStream/keyed; mark INVESTIGATE,
do not assume free).

## Pattern to port (the reason this repo matters)

`client/src/layers/*` + `hooks/useLayerData.js` + `hooks/useWebSocket.js`:
every layer = `{ id, fetch, normalize, render, interval }` primitive with a shared
data hook and WS delta hook. This is EXACTLY our Next.js tab/layer architecture
(Phase 3): one `layer-catalog.ts`, identical lifecycle per layer.
Port the interface, not the code: `LayerControls.jsx`, `InfoPopup.jsx`,
`AnalyticsPanel.jsx` become our primitive specs.

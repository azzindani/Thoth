# PORT — world-dashboard (closest free-source god-eye)

Stack: Python server (`server/app.py` + `server/collectors/*.py` + `server/cache.py`) + vanilla JS
(`js/map.js layers.js panels.js popups.js military.js measure.js urlstate.js search.js`).
Built for wall displays. MIT.

## Free sources (all keyless — HIGHEST port value)

| Source | Endpoint | Thoth status |
|---|---|---|
| NOAA NDBC buoys | `https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt` | TODO new layer `oceans` |
| Safecast radiation | `https://api.safecast.org/measurements.json` | TODO new layer `radiation` |
| Smithsonian GVP volcanoes | `https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows` (WFS) | TODO new layer `volcanoes` |
| ReliefWeb reports | `https://api.reliefweb.int/v1/reports` | TODO extend `news` |
| GDACS RSS | `https://www.gdacs.org/xml/rss.xml` | TODO extend `gdacs` |
| USGS significant quakes atom | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.atom` | TODO extend `quakes` |
| SWPC / USGS / FIRMS / EONET | (same as ours) | LIVE — compare parsers |

Keyed (documented, NOT shipped): AISStream.io vessels, planespotters photos.
Scrapes (low priority): trends24.in trending, x.com search.

## Backend patterns to port

- `server/cache.py` `TTLCache` — per-key TTL + `cached/expired/empty` status. Our `feed_health`
  should report the same three states (matches worldmonitor "read outcome" contract).
- 12-collector layout (`buoys conflicts earthquakes fires flights hurricanes news radiation
  ships trending volcanoes weather`) — mirror as our collector registry target list.
- `conflicts.py`: USGS seismic explosions + FIRMS thermal anomalies inside war zones =
  conflict detection without any key. Port as `conflicts` collector.

## UI features to port (vanilla JS, re-implement in React)

- Wartime Mode (military-only filter), Threat Assessment composite score, day/night
  terminator overlay, measure tool (M), bookmarkable URL hash (`urlstate.js`),
  Ctrl+K search, country click-to-filter, breaking-news ticker (BBC/AJ/GDACS/USGS/ReliefWeb).

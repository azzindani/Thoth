# Thoth — Adding More Open-Source Endpoints

Thoth is designed to absorb more open-source endpoints over time. This catalog is v0 — expect it to grow as we digest new repos and public feeds.

## Rules for new endpoints

1. Keyless-first. Only add a keyed source if a keyless fallback exists or is documented as degraded.
2. Every new source gets: collector + raw_events write + normalized events mapping + `feed_health` + `layer_versions` bump + docs row below.
3. No frontend layer without a DB table + collector behind it.
4. Attribution required: keep `source`, `url`, license, credit per row.

## How to propose one

Add a row to the backlog table, then implement `workers/collectors/<name>.ts` + `GET /api/layers/<name>`:

```ts
// workers/registry.ts
myfeed: { module: './myfeed', intervalSec: 300, ttlSec: 900 },
```

```bash
GET /api/layers/myfeed?bbox=&since=
GET /api/stats   # must include myfeed count
GET /api/health  # must include myfeed lag
```

## Backlog (more open-source endpoints welcome)

| Source | Layer | Poll | Status | Notes |
|---|---|---|---|---|
| Safecast radiation | radiation | 5m | proposed | keyless, complements USGS/FIRMS |
| OpenSky OAuth2 | flights | 60s | proposed | higher limits vs adsb.lol |
| AISHub REST | ships | 5m | proposed | fallback to aisstream WS |
| ReliefWeb | disasters | 10m | proposed | needs appname |
| OpenAQ / WAQI | air-quality | 10m | proposed | free key |
| UNHCR/OCHA HAPI | displacement | daily | proposed | keyless |
| Add yours here | — | — | open | keep keyless-first |

When a source is live, move it to `ENDPOINTS.md` + `DATA_SOURCES.md` and mark `live`.

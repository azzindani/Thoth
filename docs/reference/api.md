# API reference

The Thoth API is JSON over HTTP, plus one Server-Sent Events stream.

| | |
|---|---|
| Base URL (through the app) | `https://<host>/api/…`: needs the access token if the gate is on |
| Base URL (direct) | `http://127.0.0.1:4000/api/…`: from the host only in the default compose setup |
| Route index | `GET /api/routes` returns every registered route. It is generated from the running server, so it cannot drift from the code. |

## Conventions

### Authentication

| Request | Needs |
|---|---|
| Through the app, when `APP_ACCESS_KEY` is set | `Authorization: Bearer <access key>`, or the `thoth_session` cookie |
| `GET` on the API directly | Nothing |
| `POST`, `PUT`, `PATCH`, `DELETE` | `Authorization: Bearer <API_WRITE_KEY>` or `X-Thoth-Key: <API_WRITE_KEY>`. The app adds it for signed-in users. |

### Responses

- **Lists** look like `{ "items": [...], "total": n, "serverTs": "<ISO>" }`.
  Layer slices also return `versions`.
- **Errors** look like `{ "ok": false, "error": "<reason>" }` with a proper
  status code:

  | Status | Meaning |
  |---|---|
  | `400` | Invalid parameters. Every input is validated. |
  | `401` | Missing or invalid key |
  | `404` | Unknown route or item |
  | `429` | Rate limited (`REQUESTS_PER_MIN` per client IP) |
  | `502` | The upstream behind an on-demand lookup failed. The API reports it rather than returning an empty `200`. |
  | `503` | `/api/stream` at `SSE_MAX_CLIENTS`. Honour `Retry-After`. |

- Every response carries `X-Request-Id`. Include it when you report a
  problem.

### Event object

Layer slices, alerts and search results return events in this shape:

```json
{
  "id": "usgs:us7000abcd",
  "ts": "2026-09-24T10:12:03Z",
  "source": "usgs",
  "layer": "quakes",
  "title": "M 5.8 - 120 km S of …",
  "body": "…",
  "url": "https://earthquake.usgs.gov/…",
  "severity": "watch",
  "confidence": null,
  "geom": { "type": "Point", "coordinates": [166.8, -12.3] },
  "entities": null,
  "meta": { "mag": 5.8, "depth_km": 10 }
}
```

`severity` is one of `info`, `watch` or `critical`. `geom` is GeoJSON: a
point, line or polygon, or `null` for non-geographic items. Duplicate
reports of the same real-world event (see
[intelligence pass](../architecture/overview.md#intelligence-pass-deterministic-no-llm))
are left out.

## Health and system

| Method & path | Description |
|---|---|
| `GET /api/livez` | Process liveness (no DB) |
| `GET /api/readyz` | Readiness (`SELECT 1`) |
| `GET /api/health` | Per-source freshness: `last_ok`, `content_ts`, lag, error, collector, interval |
| `GET /api/stats` | Row counts per layer (for badges) |
| `GET /api/versions` | `{ layer: version }`. Poll this to find which layers changed. |
| `GET /api/routes` | Route index |
| `GET /metrics`, `GET /api/metrics` | Prometheus text format (see [Monitoring](../operations/monitoring.md#prometheus-metrics)) |

## Layers

| Method & path | Parameters | Description |
|---|---|---|
| `GET /api/layers/:layer` | `since` (ISO), `z` (0–24), `bbox` (`w,s,e,n`; `w > e` crosses the antimeridian) | Without `z`: the newest 500 events. With `z`: a viewport slice with spatial sampling, plus `matched`, `limit` and `truncated`. |
| `GET /api/layers/:layer/history` | `bucket` = `hour`\|`day` (default `day`), `from`, `to` (ISO) | Counts per time bucket |
| `GET /api/layers/:layer/export` | `format` = `csv`\|`geojson` (default `csv`) | Download the layer |

The layer ids are the keys of `app/src/lib/layer-catalog.ts`, for example
`quakes`, `flights`, `fires`, `weather`, `disasters`, `cyber`, `markets`,
`news`, `vessels`, `incidents` and `anomalies`.

## Live stream

`GET /api/stream` is a Server-Sent Events stream.

| Event | Payload |
|---|---|
| `connected` | Server version and time |
| `snapshot` | Every layer's current version |
| `layer_changed` | The layers whose version moved since the last event |
| `heartbeat` | Keep-alive |

To resume after a disconnect, pass `?known=<base64 JSON {layer: version}>`,
or send the same payload as `Last-Event-ID`. Layers that moved in the
meantime are replayed right after the snapshot. The usual client pattern is
to listen for `layer_changed`, then re-fetch those layers with
`?since=`.

```bash
curl -N http://127.0.0.1:4000/api/stream
```

## Intelligence

| Method & path | Parameters | Description |
|---|---|---|
| `GET /api/brief` | — | Deterministic brief: counts and top items from critical down to info |
| `GET /api/alerts` | `hours` (1–168, default 24), `limit` (default 50) | Critical and watch events in the window |
| `GET /api/dossier` | `lat`, `lng` (or `lon`), `radius_km` (1–1000, default 100) | Everything near a point: events by layer, geo context, threat score |
| `GET /api/country` | `q` (name, ≥2 chars), `radius_km` (50–2000, default 500) | Country page: advisories, displacement, per-layer counts, critical and watch items, news |
| `GET /api/country/list` | — | Known country names |
| `GET /api/theaters` | — | Theatre presets (region, cities, feeds) |
| `GET /api/search` | `q`, `layer`, `limit` | Full-text search over events |
| `GET /api/imagery` | `lat`, `lon` | Freshest low-cloud Sentinel-2 scene (earth-search STAC) |
| `GET /api/analytics/trend` | `layer`, `days` (default 14, clamped to 90) | Daily series combined with the sitrep archive |

## Watches and notifications

| Method & path | Body / parameters | Description |
|---|---|---|
| `GET /api/watch` | — | List watches |
| `POST /api/watch` | `{kind: "keyword"\|"layer"\|"severity", value, note?}` or `{kind: "area", value, note?, lat, lon, radius_km}` / `{…, geom: GeoJSON Polygon}` | Create a watch |
| `DELETE /api/watch/:id` | — | Delete a watch |
| `GET /api/watch/matches` | `limit` | Recent events that match any watch |
| `POST /api/notify` | `{text}` | Send a Telegram message (disabled without a bot token) |

## Sitreps

| Method & path | Parameters | Description |
|---|---|---|
| `POST /api/sitrep` | — | Build and archive today's sitrep (daily cron) |
| `GET /api/sitrep` | — | Latest sitrep |
| `GET /api/sitrep/history` | `days` (default 30) | Archived sitreps |

## Analyst workspace

These routes serve a single operator. There is no per-user separation.

| Method & path | Description |
|---|---|
| `GET` / `POST /api/notes`, `DELETE /api/notes/:id` | Notes. `POST` takes `{title, body?, category?, tickers?, sentiment?, favorite?, lat?, lon?}`. A note with `lat` and `lon` is pinned to the map. `GET` accepts `q`. |
| `GET` / `POST /api/portfolios`, `DELETE /api/portfolios/:id` | Portfolios |
| `POST /api/portfolios/:id/positions`, `DELETE /api/portfolios/:id/positions/:sym` | Positions |
| `GET` / `POST /api/screens`, `DELETE /api/screens/:id` | Saved market screens |

## Monitor

For details, see [Monitoring](../operations/monitoring.md#monitor-tab-and-apimonitor).

| Method & path | Description |
|---|---|
| `GET /api/monitor/summary` | Totals, source states, worker, database size |
| `GET /api/monitor/sources` | Per-source statistics |
| `GET /api/monitor/sources/:source` | One source's recent runs and calls |
| `GET /api/monitor/collectors` | Schedule and next-due times |
| `GET /api/monitor/endpoints` | Upstream host statistics |
| `GET /api/monitor/catalog` | Source catalog (hosts, layer, cadence, key needed) |
| `POST /api/monitor/run/:collector` | Queue an immediate run |

## On-demand OSINT lookups

`GET /api/osint/<name>` queries an upstream service live and returns its
answer, normalized. Nothing is stored. When the upstream fails, the route
returns `502` with the reason.

| Group | Routes (main parameter) |
|---|---|
| Network | `ip` (`host`), `ipwhois` (`host`), `asn` (`q`), `rdap` (`domain`), `dns` (`q`), `reverse` (`q`), `doh` / `doh-cf` / `doh-google` (`name`, `type`), `cert` (`domain`), `ports` (`host`), `robtex` (`host`) |
| Threat intel | `cve` (`id` or `q`), `epss` (`id`), `osv` (`id`), `circl` (`id`), `mitre-cve` (`id`), `mitre` (`query`), `ghsa` (`id` or `q`), `maltiverse` (`host` or `ip`), `maltsearch` (`q`), `urlscan` (`host`), `stealers` (`email` or `username`), `gravatar` (`email`) |
| Sanctions & companies | `sanctions` (`query`), `company` (`q`, GLEIF), `sirene` (`q`), `edgar` (`q`), `fdic` (`q`), `symbol` (`q`) |
| Transport | `aircraft` (`reg`), `airport` (`code`), `vessel` (`q`), `planespotter` (`hex` or `reg`), `airspace` (`bbox`), `transit` (`station`) |
| Crypto | `btc` (`address`), `token` (`address`) |
| Geo | `geo` (`lat`, `lng`), `geocode` (`lat`, `lon`), `nominatim` (`q`), `omgeo` (`q`), `daylight` (`lat`, `lon`), `zip` (`country`, `code`), `holidays` (`country`, `year`) |
| Macro | `macro` (`country`, World Bank), `macro-imf` (`country`) |
| Research & reference | `wiki`, `wikidata`, `books`, `stack`, `ror`, `funder`, `crfunder`, `museum`, `music`, `nasa-img`, `sbdb` (all `q`) |
| Life sciences | `gene`, `protein`, `ontology`, `chembl`, `rxnorm`, `fda-drug`, `dailymed`, `food` (all `q`) |
| Software | `package` (`eco`, `name`), `deps` (`eco`, `name`, `version`), `npm-dl` (`name`), `github` (`q`), `name` (`q`) |

`GET /api/routes` returns the current list of lookup routes.

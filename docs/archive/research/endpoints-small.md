# Small repos — Endpoints (ironsight, globenewslive, global-monitor, world-dashboard)

All keyless-first. Use as Thoth free-tier reference.

## ironsight (14 routes, `src/app/api/*/route.ts`, all GET, keyless)

```bash
GET /api/news?conflict=iran-israel     # 20+ RSS deduped
GET /api/conflicts?conflict=           # Google News strike queries
GET /api/regional-alerts?conflict=     # severity per region, 12h
GET /api/alerts                        # Pikud HaOref, 15s poll
GET /api/strikes?conflict=  /api/drones?conflict=  # Neptun 20s
GET /api/flights?conflict=             # adsb.lol mil filter, 3m
GET /api/ships                         # curated naval, 5m
GET /api/fires                         # FIRMS VIIRS, 10m
GET /api/telegram?channel=&postId=     # embed scrape, 60s
GET /api/markets  /api/oil  /api/crypto  /api/polymarket  # Yahoo/CoinGecko, 10m
```
Pattern: `useDataFeed(url,60s)` + `?conflict=` theater toggle + `?_t=cachebust`, keep-old-if-empty.

## globenewslive (~49 routes, keyless + optional keys)

```bash
GET /api/conflicts  /api/signals?filter=&refresh=  /api/alerts (+POST)
GET /api/brief  /api/docs  /api/defcon  /api/rss-ticker
GET /api/flights?region=&military=  /api/ships?region=&type=  /api/military-aircraft
GET /api/missile-events  /api/fires  /api/earthquakes  /api/weather?type=
GET /api/outages?type=  /api/displacement?type=  /api/infrastructure?layer=
GET /api/supply-chain  /api/cyber?type=&realtime=  /api/cyber/kev  /api/cyber/cve
GET /api/health-outbreaks  /api/live-streams  /api/twitter
GET /api/finance  /api/markets  /api/finance/crypto|defi|energy|metals|sectors
GET /api/economic/macro|forex|risk|news?country=  /api/kalshi  /api/predictions
GET+POST /api/notify  POST /api/telegram  GET+POST+DELETE /api/push
```
SWR 10-30s flights/finance, 60s signals/military, 300s economic. Opt keys only: CoinGecko, Yahoo proxy, Telegram bot, ACLED, VAPID. Steal `lib/classify.ts` + deterministic `generateBrief()`.

## global-monitor (Express `server/routes/*.js`, all GET, WS mirror)

```bash
GET /api/flights?bbox=     # OpenSky, 10s WS
GET /api/earthquakes?minMag=  # USGS, 60s
GET /api/satellites?category= # CelesTrak, 60s
GET /api/ships  /api/weather  /api/news  # 60-120s
WS ws://:3001  # {type:'update',layer,data,timestamp} + auto-reconnect
GET /api/health  # {uptime,hitRate,successRate,memory}
```
LRU-TTL Map (100), Helmet/rate-limit/Zod. Opt `OPENSKY_USER/PASS,WEATHER_API_KEY,NEWS_API_KEY`.

## world-dashboard (FastAPI `server/app.py`, all GET)

```bash
GET /api/health  # per-collector TTL
GET /api/flights  # OpenSky OAuth 60s
GET /api/earthquakes?range=day|week  # USGS 60s
GET /api/ships  # AISStream WS 60s
GET /api/fires  # FIRMS MAP_KEY 10m
GET /api/space-weather  /api/buoys  /api/volcanoes  /api/radiation
GET /api/hurricanes  /api/news  /api/conflicts  /api/trending  /api/threat-level
```
`COLLECTORS={module,interval,ttl}` + APScheduler stagger `i*2s` → `TTLCache`. Steal registry + Wartime Mode + Ctrl+K + URL-hash state. Keys only: OpenSky, AISStream, FIRMS.

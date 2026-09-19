# worldmonitor — Endpoints (digested from `/workspace/.tmp/worldmonitor`)

Auth: default `key` (`X-WorldMonitor-Key: wm_…` / session / Clerk). `public` = no-auth RPCs + anon bootstrap weather + product-catalog/version/health-compact. `premium` = quant/LLM paths (short-circuit to `slow-browser` cache).

Cache (gateway.ts `RPC_CACHE_TIER`): `live/no-store`, `fast` ~60s, `medium` ~5m, `slow` 15-30m, `daily`, `static`.

## Pattern to steal

`POST|GET /api/<domain>/v1/<rpc>` — generated from `proto/worldmonitor/*` (39 domains) via `createDomainGateway`. GET has `.md` twin. How to use:

```bash
curl -H "X-WorldMonitor-Key: wm_xxx" "https://api.worldmonitor.app/api/market/v1/list-market-quotes"
curl -H "X-WorldMonitor-Key: wm_xxx" "https://api.worldmonitor.app/api/intelligence/v1/get-risk-scores?country=IR"
npx worldmonitor tools                 # list MCP tools, no key
worldmonitor risk IR --api-key wm_xxx  # CLI wrapper over REST
```

## Domains (key unless noted)

- **aviation:** `list-airport-delays|list-airport-flights|list-aviation-news` (static/slow), `get-airport-ops-summary|get-carrier-ops|get-flight-status|search-flight-prices` (slow/fast/medium), `track-aircraft|search-google-flights` (no-store live)
- **market:** `list-market-quotes|list-crypto-quotes|list-commodity-quotes|list-gulf-quotes|get-sector-summary` (medium), `list-crypto-sectors|get-fear-greed|analyze-stock|backtest-stock` (slow), `get-market-breadth-history` (daily). Premium: `analyze-stock|backtest-stock|get-physical-premiums|get-physical-divergence-index`
- **economic:** `get-fred-series|get-energy-prices|get-bls|get-bis-*|get-ecb-fx|get-eurostat|get-macro-signals|get-national-debt|get-china-macro|list-bigmac|list-fuel|list-grocery|get-fao|list-world-bank` (daily/slow/medium)
- **intelligence:** public `get-china-decision-signals` (fast); key `get-country-risk|get-risk-scores|search-gdelt|list-satellites|list-gps|list-oref-alerts|list-telegram|x-feed|list-advisories|get-port-activity`; premium LLM `classify-event|deduct-situation|get-country-intel-brief|get-regional-snapshot|search-intel-history|get-intel-timeline`
- **conflict/military/unrest/cyber/sanctions:** `conflict/list-acled|list-ucdp|get-humanitarian|list-iran-events`, `military/get-theater-posture|list-flights?sw_lat,sw_lon,ne_lat,ne_lon|list-bases`, `unrest/list-unrest-events`, `cyber/list-cyber-threats`, `sanctions/list-pressure|lookup-sanction-entity`
- **shipping/supply/trade:** `get-chokepoint-status|get-chokepoint-history|get-shipping-stress|list-pipelines|list-storage`, `get-shipping-rates|get-critical-minerals`, `trade/get-tariff|get-flows|get-barriers`. Premium: `get-chokepoint-index|get-bypass|get-cost-shock|get-route-impact`. `GET,POST,DELETE /api/v2/shipping/webhooks[/{id}]`
- **natural/climate/health:** `natural/list-natural-events`, `seismology/list-earthquakes`, `climate/list-anomalies|list-disasters|get-co2|list-air-quality-data`, `wildfire/list-fire-detections`, `radiation/list-observations`, `health/list-disease-outbreaks`, `infra/list-outages|list-ddos|get-cable-health|reverse-geocode`, `maritime/list-nav-warnings|get-vessel-snapshot` (live 60s)
- **forecast/prediction/resilience:** `forecast/get-scorecard|get-forecasts`, `prediction/list-markets`, `scenario/list-templates + POST run-scenario`, premium `resilience/get-score|get-ranking|get-food-stocks`, `scorecard/get-five-factor`
- **news/research/prices/imagery:** `news/list-feed-digest + POST summarize-article` (LLM quota), `research/list-arxiv|list-repos|list-hackernews`, `consumer-prices/get-overview|get-basket-series`, `imagery/search-imagery`, `webcam/list-webcams|get-webcam-image` (no-store)
- **batch:** `POST /api/batch/v1/execute` fan-out ≤20 GETs

## Platform

```bash
GET /api/bootstrap?tier=fast|slow&keys=   # hydration, &public=1 cacheable
GET /api/version|/api/product-catalog|/api/health?compact=1  # public
POST /api/cache-purge                      # bearer RELAY_SHARED_SECRET
POST /api/create-checkout  /api/customer-portal  # Clerk + Dodo
GET /api/rss-proxy|/api/oref-alerts|/api/polymarket|/api/opensky|/api/gpsjam
POST /api/oauth/token  GET /api/oauth-authorization-server
POST /api/mcp  # tools/list public, tools/call key/OAuth
```

Tools: `get_world_brief|get_country_brief|get_country_risk|get_market_data|get_conflict_events|get_cyber_threats|get_news_intelligence|get_natural_disasters|get_sanctions_data|get_forecast_predictions|get_maritime_activity`.

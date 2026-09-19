# osiris — Endpoints (68 routes, digested from `/workspace/.tmp/osiris/src/app/api/`)

All `GET` unless noted. Default **keyless** — app works with $0. Only flagged routes need keys (else 503).

## Map layers — how to use

```bash
GET /api/flights                      # adsb.lol/OpenSky 30-region sweep
GET /api/flight-route?icao24=abc123   # track + legs — params: icao24,detail,legs
GET /api/aircraft?icao24=abc123
GET /api/satellites                   # CelesTrak TLE + SGP4 (opt N2YO_API_KEY)
GET /api/satellites/orbit?id=&norad=
GET /api/maritime                     # ports/chokepoints + AIS (opt AIS_API_KEY)
GET /api/cctv?region=EU&lat=..&lng=..&radius=  # 17k cams
GET /api/cctv/proxy?url=              # CORS bypass
GET /api/cctv/stream-status?url=      # liveness probe
GET /api/cctv/resolve?url=
GET /api/earthquakes                  # USGS M2.5+
GET /api/fires                        # FIRMS + EONET (opt FIRMS_API_KEY)
GET /api/weather  /api/space-weather  /api/air-quality
GET /api/frontlines  /api/conflicts  /api/country-risk  /api/infrastructure
GET /api/gdelt  /api/gdelt-events?quad=&limit=&min_articles=
GET /api/news  /api/live-news         # RSS + 25 HLS
GET /api/cyber-attacks  /api/cyber-threats  /api/radar
GET /api/cloudflare-radar?probe=1     # NEEDS CLOUDFLARE_API_TOKEN
GET /api/crypto  /api/markets  /api/markets/history?symbol=BTC&range=7d
GET /api/chain/daily?days=7  /api/scm-suppliers  /api/malware
GET /api/malware/stream               # SSE
```

## Geo / utility

```bash
GET /api/geosearch?q=berlin          # Photon+Nominatim
GET /api/geo?lat=&lng=               # reverse-geocode
GET /api/directions?from=&to=&mode=  # OSRM/Valhalla
GET /api/arcgis?q=&service=&bbox=
GET /api/sentinel?lat=&lng=&radius=&days=  # SAR STAC
GET /api/region-dossier?lat=&lng=    # Wikipedia+Wikidata
GET /api/entity/expand?type=flight&id=
GET /api/stats  /api/health          # counts + endpoint list
POST /api/astra  # multipart image → GPU, NEEDS ASTRA_GPU_URL
POST /api/sdk/ingest  # {source,apiKey,entities[]} NEEDS SDK_INGEST_KEY
GET /api/sdk/stream                  # SSE
```

## AI (needs Gemini)

```bash
POST /api/ai/analyze   # 5/min/IP, body = already-fetched IntelligenceContext
POST /api/ai/briefing
POST /api/ai/overview
# NEEDS GEMINI_API_KEY_1..8 — post your feeds in, get correlate/brief back
```

## OSINT `/api/osint/*` (keyless unless noted)

```bash
GET /api/osint/whois?domain=example.com      # RDAP + SDN cross-check
GET /api/osint/dns?domain=example.com        # Google DoH
GET /api/osint/ip?ip=1.1.1.1                 # geo/ASN/rep + SDN
GET /api/osint/cve?cve=CVE-2024-0001         # NVD
GET /api/osint/certs?domain=example.com      # crt.sh
GET /api/osint/bgp?query=AS15169
GET /api/osint/threats?query=apt28
GET /api/osint/sanctions?query=putin&limit=20  # OpenSanctions SDN
GET /api/osint/crypto?address=..&chain=btc&probe=1  # +OFAC flag, opt ETHERSCAN/HELIUS
GET /api/osint/username?username=x&limit=20
GET /api/osint/github?user=x  /api/osint/leaks?email=x
GET /api/osint/phone?number=+..  /api/osint/mac?mac=.. 
GET /api/osint/shodan?ip=..  # InternetDB keyless
GET /api/osint/hudsonrock?query=..  /api/osint/sweep?ip=&cidr=
```

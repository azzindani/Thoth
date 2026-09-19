# PORT — osiris (GPU map + CCTV goldmine)

Stack: Next.js 16 + MapLibre GL (GPU, 60fps claim) + `intel/server.js` intel service.
Live: osirisai.live. MIT.

## Free sources (CCTV expansion is the prize)

| Source | Endpoint | Thoth status |
|---|---|---|
| TfL JamCam | `https://api.tfl.gov.uk/Place/Type/JamCam` | LIVE |
| SG LTA traffic images | `https://api.data.gov.sg/v1/transport/traffic-images` | LIVE |
| Caltrans CCTV ArcGIS | `https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/CCTV/FeatureServer/0/query?where=1%3D1&outFields=*&f=json` | TODO extend `cctv` |
| 511 Alberta / Ontario | `https://511.alberta.ca/api/v2/get/cameras`, `https://511on.ca/api/...` | TODO extend `cctv` |
| Japan river cams | `https://cam.river.go.jp/...` (image tiles) | TODO extend `cctv` (images, not API) |
| NL traffic cams | `https://api.rwsverkeersinfo.nl/api/cameras` | TODO extend `cctv` |
| USGS / FIRMS / EONET / SWPC | (same as ours) | LIVE |
| OTX AlienVault | `https://otx.alienvault.com` (4 refs) | free signup key — Phase 1 optional |
| RIPE Stat / ip-api | `stat.ripe.net`, `ip-api.com` | TODO dossier enrich (Phase 5) |
| AWS Element84 earth-search (COG) | satellite imagery search | TODO SatellitePanel imagery (Phase 4) |
| blockstream.info / Blockscout | BTC/ETH tracing (keyless) | TODO `crypto` extension (Phase 5) |
| Static: 39 ports, 10 chokepoints, 13 conflict zones | repo statics | TODO vendor (with globenewslive statics) |
| 25+ HLS news broadcasters | frontend | TODO video wall (Phase 6) |

Keyed: N2YO satellites (use CelesTrak instead), YouTube API.

## Patterns to port

- GPU-first MapLibre: single style, symbol sprites, `map.setProjection({globe})` —
  already our renderer; adopt their sprite-baking + clustering approach at zoom.
- `intel/server.js`: dedicated intel microservice (OTX + scan + SDN match) — model for
  our Phase 2 hardening (per-source workers with health contracts).
- Status strip (ZULU · LIVE · layers · entities · solar Kp) — Phase 4 chrome.
- Left icon rail + right tool rail — validated by our `tab` breakpoint scaffold.

# shadowbroker — Endpoints + AI channel (digested from `/workspace/.tmp/shadowbroker`)

Auth: `public` none; `HMAC` loopback OR `X-Admin-Key` OR OpenClaw HMAC; `local` 127.0.0.1/trusted bridge OR admin key; `admin` scoped token.

## Data layers (public)

```bash
GET /api/live-data /api/live-data/fast /api/live-data/slow /api/bootstrap/critical
GET /api/layers  POST /api/viewport       # registry + bbox query (local)
GET /api/trail/flight/{icao24}  GET /api/trail/ship/{mmsi}
GET /api/aviation/datalink/{status,messages}  POST /api/satellites/overflights
GET /api/{malware,cyber-threats,country-risk,telegram-feed,scm-suppliers}
GET /api/cctv/media  /api/radio/*  /api/route/{callsign}
GET /api/sar/{status,anomalies,scenes,coverage,near,aois}  # read public, write local
GET /api/road-corridors[/{id}]  POST .../analyze
GET /api/{region-dossier,geocode/search,geocode/reverse,wikipedia/summary}
POST /api/wikidata/sparql  GET /api/entity/expand
GET /api/analytics/{risk_heatmap,dossier/{region},backtest,alerts}
```

## OSINT (public reads, sweep gated)

```bash
GET /api/osint/{ip,dns,whois,certs,threats,bgp,sanctions,cve,mac,github,leaks,sweep}
POST /api/osint/sweep/scan
GET /api/tools/shodan/status  POST /api/tools/shodan/{search,count,host}  # local
```

## AI command channel — how to use (copy this for Thoth)

Discovery (HMAC):

```bash
curl -H "X-SB-Timestamp: $TS" -H "X-SB-Nonce: $NONCE" -H "X-SB-Signature: $SIG" \
  http://backend:8000/api/ai/tools
```

Single command:

```bash
curl -X POST http://backend:8000/api/ai/channel/command \
 -H "Content-Type: application/json" \
 -H "X-SB-Timestamp: $TS" -H "X-SB-Nonce: $NONCE" -H "X-SB-Signature: $SIG" \
 -d '{"cmd":"get_layer_slice","args":{"layers":["tracked_flights","ships"],"since_layer_versions":{"ships":42}}}'

# write (needs OPENCLAW_ACCESS_TIER=full)
{"cmd":"place_pin","args":{"lat":35.68,"lng":51.38,"label":"Tehran Activity","category":"research"}}
```

Batch (≤20, concurrent):

```bash
POST /api/ai/channel/batch {"cmds":[{"cmd":"find_flights","args":{}} , {"cmd":"search_news","args":{"q":"strait"}}]}
POST /api/ai/channel/poll    # destructive read completions
POST /api/ai/channel/task    # operator → agent push (local)
```

HMAC: `Signature=HMAC-SHA256(secret, "METHOD|path|ts|nonce|sha256(canonical_body)")`, canonical = `json.dumps(separators=(',',':'),sort_keys=True)`, 60s freshness, nonce ≥16ch anti-replay. Loopback/`X-Admin-Key` bypass. SDK: `openclaw-skills/shadowbroker/{SKILL.md,sb_query.py,sb_monitor.py}` + `verify_hmac.py`.

Read cmds (~50): `get_summary,get_layer_slice,get_telemetry,find_flights,find_ships,find_entity,correlate_entity,brief_area,what_changed,search_telemetry,search_news,entities_near,osint_lookup,entity_expand,route_query,run_playbook,sar_*,gt_*`.
Write cmds (~25): `place_pin,delete_pin,inject_data,take_snapshot,create/update/delete_layer,refresh_feed,add/track/watch_*,sar_aoi_*,osint_sweep(full-only),post_gate_message,send_dm`.

## Stream / ingest

```bash
GET /api/ai/channel/sse              # HMAC, events: connected,layer_changed,task,alert,heartbeat 15s
POST /api/ai/inject  GET /api/refresh  # HMAC/admin
POST /api/ais/feed  POST /api/mesh/infonet/ingest  # local/admin
GET /api/health  GET /api/debug-latest
```

Frontend proxy `GET|POST|PUT|DELETE /api/[...path]` → `BACKEND_URL=http://backend:8000`, injects `X-Admin-Key` server-side only for same-origin sensitive paths, `no-store` on sensitive.

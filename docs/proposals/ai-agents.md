# Proposal: AI agent surface

| | |
|---|---|
| **Status** | Proposed. **Not implemented.** |
| **Tracking** | [Roadmap › Platform and integrations](../roadmap.md#platform-and-integrations) |
| **Already in place** | Read-only REST API, SSE stream, the deterministic `/api/brief`, and the `pins` and `entity_links` tables (unused so far) |

Nothing described below exists in the codebase yet. The routes, headers
and SDK paths are a design sketch, and they may change before
implementation.

## Goal

Any compatible agent (OpenClaw reference, Claude Code, GPT, LangChain, custom TS/Py) sees what the operator sees and can act on the map. Thoth ships the surface, not the model.

## Transports

1. **Command channel (primary, from shadowbroker)**
   - `POST /api/ai/channel/command {cmd, args}` + `POST /api/ai/channel/batch` (20 concurrent)
   - `GET /api/ai/tools` + `GET /api/ai/capabilities` for discovery
   - Auth: `HMAC-SHA256(secret, METHOD|path|ts|nonce|sha256(body))` → headers `X-SB-Timestamp, X-SB-Nonce(≥16ch), X-SB-Signature`, 60s freshness, nonce cache 16k/5m. Local loopback + trusted bridge bypass; remote requires HMAC or `X-Admin-Key`.
   - Tiers: `restricted` ~55 reads, `full` +~25 writes

2. **MCP (from worldmonitor)**
   - `https://thoth.local/mcp` Streamable HTTP, `tools/list` public, `tools/call` with `X-Thoth-Key` or OAuth. Mirror every channel tool as MCP tool. Publish `llms.txt` + agent-skills manifest.

3. **Free REST for agents (from globenewslive)**
   - `GET /api/signals|/brief|/markets|/conflicts|/earthquakes|/docs` — no key, rate-limited. `/api/brief` is deterministic (no LLM cost).

## Tool list (v0)

Reads: `get_summary`, `get_layer_slice {layer,bbox,since}`, `since_layer_versions`, `search_telemetry {q}`, `search_news`, `find_flights|ships|entity`, `entities_near {lat,lng,r}`, `brief_area`, `correlate_entity`, `osint_lookup {ip|dns|whois|certs|bgp|cve|sanctions|crypto}`, `entity_expand`, `get_dossier`, `get_versions`
Writes (full tier): `place_pin {cat,lat,lng,ttl,note}`, `inject_data`, `create_layer`, `sar_focus_aoi`, `osint_sweep`, `take_snapshot`, alert to Discord/TG

Guard: `confirm_expensive` for `get_telemetry/search_telemetry` full scans (anti-pattern guard).

## Agent → map loop

Agent actions go to `agent_actions` deque (maxlen 20), polled 15-30s, destructive read. `AI-Intel` GeoJSON layer renders pins/fly-to in <15s. Every agent write is a `pins` row with TTL + `created_by`.

## Clients

- `sdk/ts/ThothClient.ts` — `ask(), run_playbook(hot_snapshot, monitor_heartbeat), send_batch()`, canonical `JSON.stringify(sort_keys)` for HMAC verify
- `sdk/py/thoth_client.py` — same
- `openclaw-skills/thoth/SKILL.md` + `sb_query.py` reference (copy shadowbroker pattern)
- `verify_hmac.ts` test vector in repo

Thoth never bundles weights. Bring OpenClaw / Claude / local Ollama, point at channel + MCP.

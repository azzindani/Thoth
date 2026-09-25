# Proposal: AI agent surface

| | |
|---|---|
| **Status** | Proposed. **Not implemented.** |
| **Tracking** | [Roadmap › Platform and integrations](../roadmap.md#platform-and-integrations) |
| **Builds on** | The read-only REST API, the SSE stream, the deterministic `/api/brief`, and the `pins` and `entity_links` tables (present in the schema, unused so far) |

Nothing on this page exists in the codebase yet. The routes and headers are
a design sketch, and they may change before implementation.

## Goal

Any compatible AI agent (Claude, GPT, LangChain, or a custom client) should
be able to see what the operator sees and act on the map. Thoth provides
the interface. It never bundles or calls a model itself.

## Transports

1. **MCP server** (`/mcp`, Streamable HTTP)
   - `tools/list` is public. `tools/call` needs an API key.
   - Every tool maps onto an existing API capability.
   - Publish `llms.txt` so agents can discover the tools.
2. **Command channel** (for clients without MCP)
   - `POST /api/ai/command {cmd, args}` and `POST /api/ai/batch`.
   - `GET /api/ai/tools` for discovery.
   - Requests are signed: HMAC-SHA256 over the method, path, timestamp,
     nonce and body hash. Signatures older than 60 s are rejected, and
     nonces are cached to block replays.
3. **Plain REST**: the existing read endpoints, rate-limited as today.

## Access tiers

| Tier | Allows |
|---|---|
| `read` | Every read tool |
| `write` | Reads plus map actions: place pins, create watches, notify |

Each key is bound to one tier. Writes by agents are recorded with the key
name (`created_by`), which also closes part of the audit-trail gap in the
[security model](../../SECURITY.md#known-limitations).

## Initial tool set

| Tool | Backed by |
|---|---|
| `get_summary` | `/api/brief`, `/api/stats` |
| `get_layer {layer, bbox?, since?}` | `/api/layers/:layer` |
| `changed_since {versions}` | `/api/versions` |
| `search {q, layer?}` | `/api/search` |
| `near {lat, lon, radius_km}` | `/api/dossier` |
| `country {q}` | `/api/country` |
| `alerts {hours?}` | `/api/alerts`, incidents and anomalies layers |
| `lookup {kind, value}` | `/api/osint/*` |
| `place_pin {cat, lat, lon, ttl, note}` (write) | `pins` table |
| `create_watch {…}` (write) | `/api/watch` |

Expensive calls, such as wide history scans, need an explicit
`confirm: true` argument.

## Agent → map loop

Pins written by agents are stored in `pins` with a TTL and `created_by`.
They are published through `layer_versions`, so the SSE stream delivers
them, and they render on a dedicated agent layer within seconds.

## Out of scope

- Hosting or proxying LLMs.
- Direct SQL access for agents. Agents only use the tools above.

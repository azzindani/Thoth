# PORT — nango (integration infrastructure, NOT sources)

Repo: https://github.com/nangohq/nango — cloned 2026-09-17 to `/workspace/.tmp/nango`
(shallow, v0.71.9). Open-source integration platform: managed auth + proxy +
sync functions for 1,000+ APIs. Used by Replit, Ramp, Mercor.

Digest rule: value is engineering doctrine + patterns for Thoth's poll/proxy
posture, NOT data. Nango's 1,009-provider catalog is keyed by design —
probed 2026-09-17, the verification endpoints answer 401 without credentials
(Clerk `v1/jwks`, Coda `v1/whoami`, EPC gov.uk 403). Only 2 `auth_mode: NONE`
entries exist (placeholder + youcanbook-me-public). No keyless stream to mine;
record the patterns, close the mine.

## Catalog (providers.yaml — the machine-readable asset)

- `packages/providers/providers.yaml`: 28,455 lines, **1,009 providers**.
  Auth modes: API_KEY 330 · OAUTH2 302 · OAUTH2_CC 103 · BASIC 98 ·
  TWO_STEP 65 · MCP_OAUTH2 29 · rest (OAUTH1/JWT/NONE/edge) ~80.
- Each entry: `display_name` + `categories` + `auth_mode` + `proxy`
  (`base_url` with `${connectionConfig.*}` templates + `headers` with
  `${apiKey}` interpolation + `verification` GET probe) + `docs` links.
  Pattern worth stealing: **a declarative YAML registry of upstreams with
  per-provider health probes** — Thoth's `registry.ts` is the same shape
  minus the probe path (our health is poll-outcome, theirs is probe-URL).
- 190 entries have static-https `base_url` + absolute-path GET verification
  (e.g. affinity `/auth/whoami`, aircall `/v1/ping`, clay `/v3/my-workspaces`).
  All probed examples 401 without a key — verification path ≠ keyless data.
- `providers.scopes.yaml`: per-provider OAuth scope catalog.
- Top categories: productivity 201 · dev-tools 136 · marketing 104 ·
  crm 90 · communication 72 · hr 68. No weather/geo/quake/energy open-data
  hosts found in base_urls (only EPC gov.uk, itself keyed).

## Proxy doctrine (packages/shared/lib/services/proxy/ + packages/egress/)

- Retry strategy (`retry.ts`): retry on 5xx + 429 + 401 (token-refresh
  window), per-provider `error_code` overrides, `Retry-After`/`Retry-At`
  header honoring with longest-wait-wins, `remaining=0` custom-header
  trigger. Compare Thoth `stealthFetch`: we retry once on 429/502/503
  only. **Adopt: honor `Retry-After` on 429** (cheap, one header read);
  **do not adopt** 401-retry (we hold no tokens to refresh).
- SSRF/egress (`packages/egress/lib/`): `OutboundUrlPolicy` —
  denylist mode default, `blockPrivateIps` + `blockLinkLinkLocal` true,
  http/https only, maxRedirects 5, DNS-pinned safe agents/lookup
  (`assertSafeOutboundUrlSync`, `getSafeHttpAgents`). Compare Thoth
  `assertSafeUrl`: same intent, less machinery. **Adopt: redirect cap +
  link-local block audit** against our fetch lib when next touched.
- Byte-metering transport + data-transfer events: every proxied byte
  attributed per connection (billing input). Overkill for Thoth; the idea
  (per-source byte counters in `feed_health`) is a cheap future tell for
  fat-feed detection (FIRMS CSVs, JMA lists).
- Pagination service (`runner-sdk/lib/paginate.service.ts`): cursor/link/
  offset generators with `on_page` hooks, response-path extraction via
  lodash get. Our collectors hand-roll `slice(0, N)` caps; **adopt the
  shape** (a shared `paginateCursor` helper) only when a collector needs
  page-walking — none do today.

## Sync doctrine (runner-sdk + jobs + scheduler + orchestrator)

- `NangoSyncBase`: `lastSyncDate` (incremental cursor) + `track_deletes`
  + `emptyCache` + variant namespacing (`model::variant`), zod-validated
  `batchSave`/`batchDelete`. Compare Thoth: `since=` slices + deterministic
  ids + upsert-refresh-`ingested_at` (stats-decay fix 2026-09-13). Same
  doctrine, different words. **No change needed** — but `track_deletes`
  is a gap we consciously keep (we never delete on absence; STALE instead).
- Scheduler (`packages/scheduler/`): knex-backed schedules + tasks with
  CREATED→STARTED→SUCCEEDED/FAILED/EXPIRED/CANCELLED callbacks, three
  daemons (scheduling/expiring/cleaning), self-healing tick option.
  Compare Thoth `run.ts`: stagger + jitter + overlap guard, no persistence.
  **Adopt only if** we outgrow in-memory scheduling (multi-host workers);
  single-host today — skip.
- Orchestrator rate limiter: Redis sliding-window per-key admission,
  `limitPerMin=0` disables. Compare our `REQUESTS_PER_MIN` env gate.
  Same shape; ours is process-local, theirs distributed. Skip until
  multi-host.
- Records store (`packages/records/lib/`): `records` + `records_data` +
  `records_seen` (100-ids-per-row TOAST comment — good Postgres lore) +
  `record_counts` + routing tables; base64 `sort||id` cursors with strict
  zod. Our `events` + `raw_events` is the same split (normalized vs raw).
  **Adopt: `record_counts`-style per-layer counters** only if `stats`
  queries get slow — they don't today.

## Webhook doctrine (packages/webhooks/)

- `forward.ts`: resolve settings → `shouldSend` → deliver with byte
  metering, unverified-signature flagging, per-connection results.
- `circuitBreaker.ts`: Redis CLOSED/OPEN/HALF_OPEN per key (failure
  threshold + window + cooldown + auto-reset), pass-through impl for
  single-host. Our Telegram `POST /api/notify` has no breaker —
  **adopt the pass-through shape** (in-memory breaker, no Redis) if
  notify starts flapping; not today.
- HMAC service (`shared/lib/services/hmac.service.ts`): sha256 over
  colon-joined values, `hmac_key` per environment. Same as our admin/HMAC
  agent channel pattern. No change.

## What we take (ordered, cheapest first)

1. Honor `Retry-After` on 429 in `stealthFetch` (one header read, matches
   our 1.5s-throttle experience on energy-charts).
2. Egress audit: redirect cap + link-local block vs `assertSafeUrl` next
   time fetch lib is touched.
3. Per-source byte counters in `feed_health` (fat-feed tell) — backlog.
4. Everything else (scheduler persistence, distributed limiter,
   record_counts, breaker): documented, deferred until the need is real.

## Dead ends (probed 2026-09-17)

- Provider catalog as keyless source list: 1,009 entries, 1,007 keyed;
  verification endpoints 401 without credentials by design.
- `auth_mode: NONE` ×2: `unauthenticated` (placeholder) +
  `youcanbook-me-public` (single booking-page API, no datastream).
- EPC gov.uk `/api/codes`: 403 without bearer — keyed despite `.gov`.
- Public-data host hunt across all base_urls: no weather/geo/seismic/
  energy open-data hosts (only keyed lookalikes: `public-api.*`,
  `api.powerbi.com`, `storecensus`).
- Nango docs (`docs/integrations/all` 757 + `api-integrations` 1,002
  pages): integration guides for keyed APIs — no keyless catalog to mine.

## Verdict

Doctrine digested, patterns cherry-picked above. As a source mine for the
keyless datastream: **dry**. Close it; next hunt stays on direct
open-data hosts (the batch51–60 pattern), not integration catalogs.

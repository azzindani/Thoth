# Roadmap

This page lists open and planned work, grouped by theme and roughly in
priority order within each group. Shipped work is recorded in the
[Changelog](../CHANGELOG.md).

Status: `[ ]` open · `[~]` in progress

## Next release: v0.2.0

Planned scope, in the order it lands (`[x]` = done). Open items also keep
their entry in the themed lists below.

1. [x] Content-Security-Policy for the app (Security and operations).
2. [x] OpenAPI specification (Platform and integrations).
3. [x] Reader API keys with per-key rate limits (Platform and integrations).
4. [x] Outbound webhooks for alerts and watch matches (Platform and
   integrations).
5. [x] Installable PWA with critical-alert notifications (Frontend).
6. [x] Light "paper" theme (Frontend).
7. [x] Pop-out windows saved with workspaces (Analyst workflow).
8. [x] Explicit cross-layer rules (Intelligence).
9. [ ] Removal of the deprecated single-file terminal, on or after
   2026-10-09 as announced (Frontend).

## Guiding principles

- Free and keyless first. A keyed integration ships disabled until it is
  configured.
- A source is not "live" until the monitor has seen it succeed from a
  production network. Contract tests alone are not enough.
- No feature ships without tests. No UI ships without checks at desk,
  tablet and phone.

## Platform and integrations

- [ ] **Agent surface.** An MCP server and a command channel so an
      assistant can query layers, incidents and alerts and place pins. See
      the [AI agents proposal](proposals/ai-agents.md).

## Security and operations

- [ ] **Per-user identity and an audit trail** for writes. Today there is a
      single shared write key.
- [ ] **Shared rate-limit and SSE state** (for example Redis) so that more
      than one API replica can run.
- [ ] **End-to-end backup drill** on the production host, repeated each
      quarter.
- [ ] **Freeze-budget review** for low-volume digest sources that show as
      frozen.

## Data coverage

- [~] **Keyless source batches**, worked from the
      [candidate queue](development/source-maintenance.md#candidate-queue).
- [ ] **Streaming sources** such as RIPE RIS Live. These need a streaming
      worker next to the poll scheduler.
- [ ] **Operator decision on host-blocked sources**: leave, drop, or
      re-route egress (see
      [Source maintenance](development/source-maintenance.md#host-blocked-operator-decision)).
- [ ] **Keyed integrations**, once keys are available: global AIS
      (AISStream), ACLED conflict events.

## Intelligence

- [ ] More cross-layer rules (`backend/src/workers/rules.ts`), for example
      GNSS jamming next to an air traffic drop, or a quake near a nuclear
      plant.
- [ ] Hour-of-week anomaly baselines, once enough history has built up.
- [ ] Market analytics HUD and backtesting. This needs several months of
      archived sitrep history first (earliest Q1 2027).
- [ ] Company exposure view. This needs a company-exposure dataset. The
      identity lookup (GLEIF) already ships.

## Analyst workflow

- [ ] Country pages: sanctions and markets per country (needs ISO codes on
      each row).

## Frontend

- [ ] Self-hosted vector basemap (PMTiles, keyless) in the warm style.
- [ ] Web Push for critical alerts while the app is closed (VAPID and a
      push-subscription store). Today notifications need Thoth running,
      and webhooks cover delivery elsewhere.
- [ ] Remove the deprecated single-file terminal (`backend/public/index.html`)
      and its e2e suite. It is scheduled for after 2026-10-09.

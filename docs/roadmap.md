# Roadmap

This page lists open and planned work, grouped by theme and roughly in
priority order within each group. Shipped work is recorded in the
[Changelog](../CHANGELOG.md).

Status: `[ ]` open · `[~]` in progress

## Guiding principles

- Free and keyless first. A keyed integration ships disabled until it is
  configured.
- A source is not "live" until the monitor has seen it succeed from a
  production network. Contract tests alone are not enough.
- No feature ships without tests. No UI ships without checks at desk,
  tablet and phone.

## Platform and integrations

- [ ] **OpenAPI specification** generated from the zod schemas and
      published with the docs.
- [ ] **Reader API keys** with per-key rate limits, separate from the
      write key.
- [ ] **Outbound webhooks** for alerts and watch matches.
- [ ] **Agent surface.** An MCP server and a command channel so an
      assistant can query layers, incidents and alerts and place pins. See
      the [AI agents proposal](proposals/ai-agents.md).

## Security and operations

- [ ] **Content-Security-Policy** for the app, with an audited allowlist
      for tiles, fonts and video embeds.
- [ ] **Per-user identity and an audit trail** for writes. Today there is a
      single shared write key.
- [ ] **Shared rate-limit and SSE state** (for example Redis) so that more
      than one API replica can run.
- [ ] **End-to-end backup drill** on the production host, repeated each
      quarter.
- [ ] **Freeze-budget review** for low-volume digest sources that show as
      frozen.
- [ ] **Telegram alert delivery under Compose:** pass the bot variables to
      the `worker` service by default (see
      [Configuration](operations/configuration.md#how-variables-reach-the-containers)).

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

- [ ] Explicit cross-layer rules, for example an internet outage near a
      cable landing, or airspace emptying near a conflict event.
- [ ] Hour-of-week anomaly baselines, once enough history has built up.
- [ ] Market analytics HUD and backtesting. This needs several months of
      archived sitrep history first (earliest Q1 2027).
- [ ] Company exposure view. This needs a company-exposure dataset. The
      identity lookup (GLEIF) already ships.

## Analyst workflow

- [ ] Country pages: sanctions and markets per country (needs ISO codes on
      each row).
- [ ] Pop-out windows saved as part of workspaces.

## Frontend

- [ ] Self-hosted vector basemap (PMTiles, keyless) in the warm style.
- [ ] Installable PWA with push notifications for critical alerts.
- [ ] Light "paper" theme, as a token swap only with no structural change.
- [ ] Remove the deprecated single-file terminal (`backend/public/index.html`)
      and its e2e suite. It is scheduled for after 2026-10-09.

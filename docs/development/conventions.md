# Conventions

The bar every change is reviewed against. For the workflow around it
(branches, gates, pull requests), see [Contributing](../../CONTRIBUTING.md).

## Size and shape

- One file, one job. Cap: **700 LOC**. Past that a file is hiding a
  second module — split by responsibility, never by length alone.
- Functions do one thing. If "and" describes it, split it.
- Dead code is deleted, not commented. LOC is a capability ratio.

## Explicit over clever

- No hardcoding: magic numbers, thresholds, copy, and upstream URLs live
  as **named constants with their caller** (a collector owns its URL;
  a component owns its labels). Nothing anonymous, nothing twice.
- No silent behavior: every fallback, retry, and default is observable —
  feed Health rows, `frozen`/`warming`/`STALE` states, honest nulls.
- Fail honest, never confident-empty. A route that cannot serve answers
  502 with the reason, not 200 with nothing.

## State & data

- One source of truth per fact; everything else derives
  (`ingested_at` = last-seen-in-poll, `content_ts` = observation time —
  never the reverse).
- Validate at the boundary (zod on inputs, guards on feed payloads),
  trust inside.
- Immutable by default; mutation is explicit and local.

## Change safety

- Every behavior has a test that breaks when the behavior breaks.
  Tests assert outcomes (one pinned card, 200 with rows), not internals.
- Green gates per merge: typecheck + lint + unit + collectors + e2e.
  Main is always shippable.
- Docs ship with the change, not after: `CHANGELOG.md`, and the reference
  pages the change touches (API, data sources, configuration, upgrading).
  No TODO without an owner and a date; longer-lived work goes on the
  [roadmap](../roadmap.md).

## Readability

- Names say what it is (`content_ts`, not `ts2`). Comments say *why*.
- Files, tests and code comments are named by function, never by the batch
  or loop that added them (`collectors-wildfires.test.ts`, not
  `collectors-batch34.test.ts`).
- Boring patterns. Frameworks over hand-rolls; services over scripts.
- UI: IBM Plex Sans for chrome, Plex Mono for every number; ONE accent
  (faience) for selection/focus/primary action only; colour on data means
  severity, healthy stays neutral; square hairline controls, no pills.
  Full rules: [UI design system §0](ui-design-system.md#0-visual-language). New colours go in the :root tokens (and
  palette.ts for map code), never inline.

## Frontend specifics

- Hover stays hover: mousemove never writes panels, selections, or URL.
- Click pins a preview and opens nothing; full views are explicit.
- Popups live outside React: one delegated listener, stored records,
  exactly one card per pixel.
- No layout shift: reserve media space before it loads; truncate live
  text, never overflow it.

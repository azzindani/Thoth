# Thoth conventions — the bar every change is judged against

## Size & shape

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
- Receipts: PHASES.md ledger + OUTSTANDING.md updated with the change,
  not after. No TODO without an owner and a date.

## Readability

- Names say what it is (`content_ts`, not `ts2`). Comments say *why*.
- Boring patterns. Frameworks over hand-rolls; services over scripts.
- UI: Inter for chrome, mono for data; one accent, sentence case,
  severity colors are data and never decoration.

## Frontend specifics

- Hover stays hover: mousemove never writes panels, selections, or URL.
- Click pins a preview and opens nothing; full views are explicit.
- Popups live outside React: one delegated listener, stored records,
  exactly one card per pixel.
- No layout shift: reserve media space before it loads; truncate live
  text, never overflow it.

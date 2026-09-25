# PORT — worldmonitor (cache contracts + catalog, NOT sources)

Stack: Vite app v2.10 + key-gated API (`api.worldmonitor.app`, `wm_xxx` key).
Value is engineering doctrine + layer catalog, NOT data (their API is keyed).

## Cache contracts to adopt (Phase 2 — highest value in this repo)

From `CONCEPTS.md` / `ARCHITECTURE.md`, mapped to our backend:

- Seed-owned keys: only the owning collector writes its rows; readers never backfill.
  (Our invariant already; enforce in review.)
- Content-age contract: freshness = newest *observation date in the payload*, not last
  run time. A frozen upstream that still 200s must alarm. Implement per-source
  `content_ts` in `feed_health` + STALE escalation.
- Read outcome (hit/miss/failure): collapse of failure→empty is forbidden. Our
  collectors already return `{ok,count,error}`; extend to UI: failure keeps last-good
  + marks STALE (never renders confident-empty).
- Activation marker: first genuine publish ends the grace period; before that,
  absence is soft (no loud alarm for a source that never succeeded once).
- Lever test: optimize only miss-rate × bytes-per-miss (payload caps, `since=` slices).
- Source tag: stamp which rung produced the payload (primary vs fallback, e.g.
  adsb.lol vs opensky) — our `meta.fallback` + feeds list already; formalize.

## Catalog value

57 map layer types / 461 feeds / 748 providers (their landing): use as the god-eye
coverage checklist — every free rung on it becomes a Thoth collector or a documented
keyed gap. Missions/workspaces (Crisis Desk, Supply-Chain, Energy…), DEFCON badge,
`feeds 114/230 partial` honesty footer → Phase 4/5 chrome specs.
Digest pipeline (seeders/relay/publish-bootstrap-tiers) → model for our Phase 7 ops.

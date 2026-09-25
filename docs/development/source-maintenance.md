# Source maintenance

Public upstreams move, rate-limit, change their payloads and go offline.
This page is the recurring routine for keeping the source estate healthy,
plus the queue of candidate sources.

## Routine: fix first, then ship

Each maintenance run starts from the monitor:

```bash
curl -s localhost:4000/api/monitor/sources | jq '.items[] | select(.state=="failing") | {source, error}'
```

While any fixable keyless source is failing, the run is a **fix-or-drop
pass**. Only when none is left does it ship a small batch of new sources
(2–6).

Runs happen on the production host, in the deployed checkout, so that
probes see the same network the worker sees. Every run ends green:
typecheck, lint and the collector and unit suites pass, and the change
passes the production check in step 6 of
[Adding data sources](adding-data-sources.md#6-verify-in-production).
A change that fails in production is fixed or reverted before it is
pushed.

### Fix-or-drop pass

1. **Diagnose inside the worker container.** Print the HTTP status or
   `err.cause.code`, since `fetch failed` hides the real error. Compare with
   `curl` from the host and with `dig @1.1.1.1` (see
   [Troubleshooting](../operations/troubleshooting.md#many-sources-fail-with-fetch-failed)).
2. **Fix** the request (a moved URL, parameters, `Accept` header, spacing
   for 429s, a timeout for slow but working upstreams), the parser, or the
   health rule (a freeze budget). The cause goes in a comment next to the
   constant that fixes it.
3. **Drop** a source only when the upstream now needs a key, is gone, or is
   redundant and cannot be fixed. Remove the leg, its entries in
   `source-map.ts` and `freeze.ts`, and its test stubs, then delete its
   `feed_health` row in production. That is the only production write this
   routine allows. Note the removal in `CHANGELOG.md`.
4. **Host-blocked sources** (IP, geo, WAF or DNS filtering confirmed from
   the host as well) are not code problems. Don't route around them. Record
   them below for an operator decision.

### Shipping a batch

Follow [Adding data sources](adding-data-sources.md) for each source. Pick
from the candidate queue below, or add new finds to the bottom of it with a
one-line probe note.

## Known upstream issues

These lists record the state at the time of writing. The live state is in
the Monitor tab.

### Host-blocked (operator decision)

Seen from the reference deployment on 2026-09-24. Other networks may
differ.

| Source(s) | Symptom |
|---|---|
| celestrak | No TCP connect. The TLE mirror fallback serves instead. |
| smithsonian | Connection reset after the TLS handshake |
| nga-msi | Akamai 503 |
| enisa-euvd | Azure WAF 403 |
| gdelt | 429 on every call, even at one request per 30 s |
| binance, kalshi, bitstamp | The local resolver returns a national content-filter page |
| govtrack | Connection closed |
| medrxiv | Timeouts |

Options for each: leave it failing (it is labelled in the UI), drop it,
or route those hosts through a different egress.

### Intermittent

| Source(s) | Notes |
|---|---|
| bbc, aljazeera, dw | Akamai edge path drops some connects from certain hosts. The news legs retry a failed connect once. Persistent failures are a network-path issue. |
| crt.sh (OSINT `cert`) | Returns 502/429 for hours at a time. The route retries once and then answers `502` honestly. |

### Open review items

- About 50 sources show as *frozen*, mostly low-volume blogs and digests on
  the default 4 h freeze budget. Their budgets need review in `freeze.ts`.

## Candidate queue

Keyless only. The queue is worked from the top down. Keyed sources stay in
[Data sources › Not supported](../reference/data-sources.md#not-supported).

| Source | Layer | Status | Notes |
|---|---|---|---|
| Vigicrues France flood vigilance (`vigicrues.gouv.fr/services/1/InfoVigiCru.jsonld`) | disasters | blocked | TCP connect times out from the reference host (2026-09-24) |
| waterlevel.ie (OPW Ireland) GeoJSON | oceans | parked | Live (464 sensors, CC BY 4.0) but has no flood thresholds, so readings can't be ranked. Needs per-station statistics first. |
| SA CFS / TAS TFS / NT PFES bushfire feeds | fires | blocked | Old paths have moved (SA returns HTML, TAS 410, NT 404). Find the current ones, then extend `wildfires`. |
| Canada CWFIS active fires | fires | blocked | Old CSV path returns 404. Find the current one. |
| JMA designated-river flood forecasts, r8 (`jma.go.jp/bosai/flood/data/r8/flood_xml.json`) | disasters | candidate | The list is empty when no forecast is in force. Build it when one is live, to learn the record shape. |
| NCSC-UK feeds | cyber | parked | Live, but only news, reports and guidance. No advisory feed to grade. |
| ACSC cyber.gov.au alerts and advisories RSS | cyber | blocked | HTTP/2 stream reset, then timeouts, from the reference host |
| JTWC disturbance summaries (ABPW10 / ABIO10) | disasters | candidate | Invests with a development chance and a free-text position. JTWC warnings already ship in `storms`. Build it when a disturbance is active to verify against. |
| FEWS NET IPC phases | disasters | candidate | The keyless API shape is unconfirmed. Verify from a networked host first. |
| RIPE RIS Live | cyber | candidate | A WebSocket stream, so it needs a streaming worker rather than a poll collector |

# PORT-NEWSOURCES — second digestion round (2026-09-09)

Four new free sources verified live from the sandbox. Replaces two dead assumptions.

## crt.sh (certificate transparency) — OSINT `cert`
- `GET https://crt.sh/?q=%25.{domain}&output=json` — keyless, instant.
- Fields: `common_name`, `name_value` (newline-separated SANs), `not_before/after`,
  `issuer_name`, `serial_number`. Wildcards included.
- Use: subdomain enumeration for dossier/OSINT. Cap output (large domains = 10k+ rows).

## RIPEstat (routing/ASN intel) — OSINT `asn`
- `as-overview` (NOT `asn-overview` — that 404s): `GET
  https://stat.ripe.net/data/as-overview/data.json?resource=AS15169` → holder,
  announced prefixes count.
- `network-info`: `GET .../network-info/data.json?resource=8.8.8.0/24`.
- `announced-prefixes` for prefix lists. All keyless, `status: ok` contract.
- Use: backs the existing `ip` lookup with ASN context.

## NIFC WFIGS current fire perimeters — layer `perims`
- Org ID MIGRATED: `T4QMspbfLgnhV5aH` is dead; current is `T4QMspbfLg3qTGWY`.
- `.../WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1=1&f=geojson`
  (193 perimeters live at digest time). Standard Esri paged query
  (`resultOffset/resultRecordCount`, `returnCountOnly` supported).
- Use: polygon twin to FIRMS hotspot dots.

## Aviation weather (AWC) — layer `airwx` (REPLACES dead FAA plan)
- `soa.smext.faa.gov` is NXDOMAIN globally (Status 3 via DoH) — the old FAA ASWS
  airport-status API is retired, not sandbox DNS. `api.faa.gov` needs a key.
- Replacement: `https://aviationweather.gov/api/data/airsigmet?format=geojson` —
  active SIGMET polygons with `hazard`, `severity` (1-6), valid windows. Keyless.
- METAR point queries were flaky in testing; SIGMETs alone carry the layer.

## Dropped / deferred
- FAA delays: no free keyless endpoint remains. Revisited if `api.faa.gov` key acquired.
- NVD CVE API: verified pattern known, deferred to keep this batch shippable.

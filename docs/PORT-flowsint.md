# PORT — flowsint (OSINT graph enrichers, PARTIAL mine)

Repo: https://github.com/reconurge/flowsint — cloned 2026-09-17 to
`/workspace/.tmp/flowsint` (shallow, 14M). Open-source OSINT graph
exploration tool (Python, Neo4j-backed, ethical-use framed). Value:
its `flowsint-enrichers` package is a catalog of per-entity upstream
calls — several are keyless hosts Thoth hadn't wired yet.

## Enricher layout (the asset)

`flowsint-enrichers/src/flowsint_enrichers/<entity>/to_<target>.py` +
`src/tools/network|organizations/<tool>.py`, registered via
`@flowsint_enricher` decorator + `ENRICHER_REGISTRY`. Entities: ip,
domain, email, crypto, asn, cidr, individual, organization, phone,
social, website. Tools are Docker binaries (subfinder, dnsx, httpx,
naabu, asnmap, mapcidr, whoisxml, whoxy) or plain `requests` calls.

## Upstream host audit (extracted 2026-09-17, probed same day)

| Host (flowsint user) | Key? | Verdict |
|---|---|---|
| `recherche-entreprises.api.gouv.fr/search` (SireneTool, org_to_infos) | none | **SHIPPED** → `GET /api/osint/sirene?q=` (renault → SIREN 982770919 live) |
| `cavalier.hudsonrock.com/.../search-by-email|username` (to_hudsonrock ×4) | none (free tier) | **SHIPPED** → `GET /api/osint/stealers?email|username=` (unknown → 200 empty stealers[]) |
| `gravatar.com/avatar/<md5>?d=404` + `<md5>.json` (email_to_gravatar) | none | **SHIPPED** → `GET /api/osint/gravatar?email=` (HEAD 200 = exists; 404 = honest false) |
| `http://ip-api.com/json/<ip>` (ip_to_infos) | none (45/min) | already covered (`/api/osint/ip`) |
| `crt.sh/?q=%25.<domain>&output=json` (domain_to_subdomains fallback) | none | already covered (`/api/osint/cert`) |
| `haveibeenpwned.com/api/v3/breachedaccount/` (email_to_breaches) | HIBP_API_KEY (vaultSecret) | keyed — skip |
| `api.dehashed.com/v2/search` (to_dehashed ×4) | key (vaultSecret) | keyed — skip |
| `api.etherscan.io/v2/api` (crypto to_transactions/to_nfts) | key (probed: `NOTOK Missing/Invalid API Key`) | keyed — skip |
| `api.whoxy.com`, `api.c99.nl`, `whois-history.whoisxmlapi.com` | keys (probed: invalid-key responses) | keyed — skip |
| `api.veriphone.io` (phone to_carrier) | key | keyed — skip |
| asnmap via `PDCP_API_KEY` (ip_to_asn) | ProjectDiscovery Cloud key | keyed — skip (our `/api/osint/asn` covers via RIPEstat) |
| subfinder/dnsx/httpx/naabu/mapcidr (Docker binaries) | local compute | ops pattern, not endpoints — skip |
| sherlock (subprocess, username_to_socials) | local compute | skip (binary scan, no HTTP contract) |
| reconcrawl (Crawler lib, emails/phones from HTML) | local compute | skip |
| tech-detect (local HTML tech fingerprint) | local compute | skip |

Keyed-but-noted: HIBP, Dehashed, Etherscan, Whoxy, c99, WhoisXML-history,
Veriphone, PDCP — all declare `vaultSecret` params; none have keyless tiers
worth polling (Etherscan's free tier is per-key, not keyless).

## What shipped (batch61, 2026-09-17)

- `GET /api/osint/sirene?q=` — French SIREN + HQ geo + activity (top-5).
- `GET /api/osint/stealers?email=|username=` — stealer infection check
  (`infected` bool + stealer list + corporate/user service counts).
- `GET /api/osint/gravatar?email=` — existence + optional profile.
- All honest-400 on bad input, honest-502 on upstream failure (no new
  shapes — plain `fetch` + `AbortSignal.timeout`, same as sibling routes).
- Wired: CmdBar regex + help line, routes-osint test (3 kinds),
  alive getRoutes (3) + 400-list (3). OSINT route count 82 → 85.

## Doctrine notes (cheap, not endpoints)

- `@flowsint_enricher` registry (name/category/key/input/output schema
  auto-derived) is the same shape as Thoth's `COLLECTORS` + per-collector
  test files — validates our layout, no change.
- Vault-secret param schema per enricher (`get_params_schema`) is how a
  keyed source *should* declare its key requirement — closest match to
  our OUTSTANDING §A keyed table; if we ever take keys, copy the shape.
- crt.sh-as-fallback (subfinder → crt.sh) matches our NVD → CIRCL
  failover doctrine. No change.

## Verdict

Unlike nango (dry), flowsint yielded **3 live keyless routes** from its
free-tier/keyless enrichers. The remaining ~15 enrichers are keyed or
local-compute. Mine exhausted at the HTTP layer; Docker-binary tools
(subfinder, sherlock) are out of scope for the datastream.

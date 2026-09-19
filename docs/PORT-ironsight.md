# PORT — ironsight (theater command center)

Stack: Next.js 16 + React 19 + Leaflet + Tailwind. Two conflict theaters
(Iran/Israel, Russia/Ukraine) behind one toggle. MIT.
NOTE: we standardize on MapLibre (globe), so port Leaflet patterns, not the library.

## Free sources

| Source | Where | Thoth status |
|---|---|---|
| Ukraine air-raid/drone alerts | `https://neptun.in.ua/api/data` (`drones` route) | TODO new `drones` collector |
| Google News RSS (9 refs) | `news` route | LIVE pattern (our `news` uses same) |
| Yahoo chart 5d | `markets`/`crypto` routes (`query1.finance.yahoo.com`) | LIVE — extend to `CL=F` oil, `BZ=F`, `DX-Y.NYB` |
| CoinGecko simple price | `crypto` route | LIVE |
| Defense RSS: presstv/haaretz/nyt/dowjones/fox-moxie/breakingdefense/warontherocks/defense.gov/militarytimes | `news` route lists | TODO extend `news` defense tier |
| t.me scrape | `telegram` route | LIVE (thin — compare selectors) |
| Polymarket | `polymarket` route | LIVE |

15 API routes mirror our layer surface: alerts conflicts crypto drones fires flights
markets news oil polymarket regional-alerts ships strikes telegram.

## Patterns to port (highest value)

- `src/lib/conflicts/`: `types.ts` + `iran-israel.ts` + `russia-ukraine.ts` (city lists,
  map center/zoom, theater label) + `context.tsx` — THE theater-toggle pattern for our
  Missions (Phase 5). Verbatim structure, our data.
- `src/lib/generateAlert.ts`: deterministic alert synthesis (no LLM) — port for our
  alerts pipeline (Phase 6).
- `ThreatClock`, `MetricsBar`, `RegionalAlertsPanel`, `StrikesPanel`, `ConflictFeed`,
  `NavalPanel`, `OilPanel`, `SatellitePanel` — panel specs for Phase 4 tab system.

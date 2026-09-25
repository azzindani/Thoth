# PORT — globenewslive (news machine + static intel)

Stack: Next.js 16 + React 19 + Tailwind, `bot.js` Telegram bot. v2.6.0.

## Free sources / static intel (HIGHEST value: vendor the statics)

| Source | Where | Thoth status |
|---|---|---|
| RSS tiers (Reuters/BBC/AJ tier1; Guardian/France24/DW tier2) | `src/lib/feeds.ts` | LIVE (ours matches; Reuters tier1 URL noted) |
| Defense RSS (Defense One, Breaking Defense) | `feeds.ts` defense | TODO extend `news` |
| `MILITARY_BASES` (~15 lat/lon/type/op) | `feeds.ts` | TODO vendor as `bases` static layer |
| `STRATEGIC_CHOKEPOINTS` (8, oilMbpd/tradePct/risk) | `feeds.ts` | TODO vendor as `chokepoints` static layer |
| `ACTIVE_CONFLICTS` (10, type/intensity) | `feeds.ts` | TODO vendor as `conflicts` static layer |
| WHO feeds | `HealthAlertPanel` | TODO `health` news tier |
| i24news + more outlets | feed lists | TODO extend `news` |
| YouTube live embeds (~25 broadcasters) | `LiveVideoPanel` | SHIPPED 2/8 (France24, NASA oEmbed-200); 6 IDs rotted 2026-09-09 — re-verify before re-adding |
| Telegram Bot API | `bot.js` + `TelegramFeed` | keyed (bot token) — Phase 6 optional |

Keyed (documented, NOT shipped): ACLED token, Anthropic API, X/Twitter.

## Libs to port

- `rssFetcher.ts` + `classify.ts`: fetch → classify → route pipeline. Compare with our
  `news.ts` regex parser; adopt their outlet-priority + classification taxonomy.
- `gloomberb/`: `market-impact`, `company-exposure`, `infrastructure-scoring`,
  `event-mapping`, `treemap` — Phase 6+ (needs company dataset first; do NOT build blind).
- `trade-routes.ts` + `supply-chain.ts` — pairs with chokepoints layer (Phase 5).
- `CountryDeepDivePanel`, `MapFocusView`, `DashboardGridLayout` — Phase 4 panel specs.
- `MobileNavEnhanced` — precedent for our `phone` breakpoint (already scaffolded).
- `rate-limit.ts`, `i18n.ts` — adopt patterns in Next.js scaffold.

# Thoth UI — responsive contract + primitive catalog

Binding rule: the terminal MUST be usable on any screen width — phone, tablet,
laptop, ultrawide. New UI work starts from primitives, never from one-off markup.
Globe + flat map (osiris-style) is the agreed renderer; everything around it is
composed from the catalog below.

## 1. Breakpoints (width-based, device-agnostic)

| Class | Width | Layout |
|---|---|---|
| `desk` | ≥1200px | 3-column: explorer 232px · map fluid · inspector 330px. Reference look. |
| `tab` | 768–1199px | Explorer collapses to 56px icon rail (icon + count, names/feeds hidden). Inspector becomes an overlay sheet, hidden until a selection/alerts tab opens it. |
| `phone` | <768px | Single column: map only. Ticker condenses (logo + clock + health; mode buttons move into a `⋯` menu). Explorer opens as a bottom sheet via `☰`; inspector opens full-screen via selection. Timeline + cmdbar stack vertically. |

Rules:
- No fixed pixel widths outside the token + breakpoint system. Panels size in `px` tokens only at `desk`; everywhere else they are overlays/sheets.
- Touch targets ≥44px on `tab`/`phone` (rails, chips, tab buttons).
- The map is never unmounted on breakpoint change — only panels reflow. Resize must not drop sources/layers.
- Ticker text scrolls on all classes; never wraps.
- `body[data-bp]` mirrors the active class for JS (`desk|tab|phone`), set by `UI.breakpoint()` on resize.

## 2. Primitive catalog (use these, nothing else)

| Primitive | Builder | Notes |
|---|---|---|
| Button | `UI.btn(label, opts)` | `.tbtn` / `.go` / `.chips button` skins via `opts.skin` |
| Chip (filter) | `UI.chip(label, active, onClick)` | severity chips, tab buttons |
| Layer row | `UI.layerRow(name, count, visible, onToggle)` | explorer rows: glyph + name + count |
| Badge | `UI.badge(text, kind)` | `critical|watch|info|stale|live` → color only, never new hues |
| Panel sheet | `UI.sheet(side)` | inspector/explorer containers; overlay behavior on `tab`/`phone` comes free |
| Popup | `UI.popup(html, lngLat)` | map hover/click cards; single instance, escaped content |
| KV grid | `UI.kv([[k,v]…])` | dossier/object detail |
| Item row | `UI.item(html, onClick)` | alerts/inspector lists |
| Field | `UI.field(placeholder)` | cmdbar + inspector inputs |

Rules:
- Glyphs: Lucide SVG paths from the `LAYERS` table only (ISC). No emoji, no new icon sets.
- Colors: CSS tokens only (`--amber --cyan --red --grn --dim --txt --panel --line`). Severity color is data, not decoration.
- Text escaping: every builder escapes via `esc()`; raw HTML is a review-flag.
- e2e-pinned selectors (`#map #tape-txt .lrow #cmd #tabs #tl-canvas #insp-body #feeds #health-pill`) MUST survive any refactor — tests assert on them.

## 3. Build order (agreed)

1. Primitives + responsive shell (this doc; desktop pixel-identical).
2. Map-first reflow (edge rails, status strip) composed from primitives.
3. Missions (layer/theater presets) — presets only, no new components.
4. Light paper mode — token swap, zero structural change.

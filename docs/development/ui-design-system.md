# UI design system

Visual language, responsive contract and primitive catalog for the web
terminal (`app/`). New UI work starts here.

## 0. Visual language

The design direction is "instrument on warm black".

Tokens live in `app/src/app/globals.css` `:root`; `app/src/lib/palette.ts`
mirrors the hex values for map/canvas/SVG code (`test/palette.test.ts` fails
if they drift). The rules, in priority order:

1. **Warm black + bone.** `--bg #0b0b0a`, text `--txt #e9e5da` → `--txt2`
   → `--dim` → `--faint`. Hierarchy comes from luminance, not hue. No pure
   `#000`/`#fff` anywhere.
2. **One accent: faience turquoise `--accent #4fbfae`.** Selection, focus,
   the active cell of a segmented control, links, and the single primary
   action (`.go`, the pinned card's "Full view"). Never data, never
   decoration. If you are reaching for it anywhere else, don't.
3. **Colour on data = severity only.** Critical `--red`, watch `--amber`.
   Healthy/OK/info is neutral (`--grn` is aliased to `--txt2` on purpose:
   healthy stays quiet, only problems get colour). Charts use `--chart`.
4. **Layers are told apart by shape, not hue.** Glyphs are monochrome
   (`currentColor`); map sprites are baked per severity (`th-<layer>`,
   `-watch`, `-crit`). Cluster discs are neutral; the ring shows the worst
   severity inside. `LAYERS[].color` is kept in the catalog for back-compat
   but is not rendered.
5. **Quiet controls.** Segmented controls (`.seg`, `.chips`) sit in a
   recessed track with the active cell raised (`--raise2` + top highlight);
   inspector tabs mark the active tab with an accent underline; ghost
   buttons (`.ghost-btn`) for secondary actions. Hover lifts luminance
   (`--hover`), press darkens (`--press`), focus is a 2px accent ring
   (`:focus-visible` only). No gradients, glows or candy colours.
6. **Type.** IBM Plex Sans for chrome, IBM Plex Mono (tabular) for every
   number, clock, code and coordinate. Section labels are 10.5px uppercase
   tracked (`h3`, `.lgroup`, `.tc-label`); body 12–13px. Four sizes, no
   half-pixel one-offs.
7. **Severity rows** (`.sev-row[data-sev]`) carry severity on a 2px left
   edge with a mono layer label — not coloured bullets.
8. **Floating panels over a full-bleed map.**
   The map fills the viewport; status bar, explorer, inspector and dock are
   glass panels (`--glass` + `--blur`, hairline border, `--hl` top
   highlight, `--shadow-panel`) inset by `--inset` from the edges and each
   other. Geometry tokens: `--bar`, `--expl`, `--insp`, `--rail`,
   `--dock-h` (measured and published by `page.tsx`; the CSS value is only
   the first-paint fallback), derived `--top`/`--lw`/`--rw`. Radius scale:
   `--r-panel 14` · `--r-card 12` · `--r-ctl 8` · `--r-cell 6` ·
   `--r-sheet 18` — pick from the scale, never a one-off. Without
   `backdrop-filter` or under `prefers-reduced-transparency` panels fall
   back to opaque `--glass2`. On touch devices (`pointer: coarse`) glass
   is near-opaque with no blur: a blur over the WebGL map is re-sampled
   every frame the map moves, which phone GPUs cannot afford.
9. **The camera knows about the panels.** `syncPadding()` in `page.tsx`
   sets `map.setPadding()` from the persistent panels' rects (ResizeObserver),
   so the globe and every `flyTo` centre in the free area. Overlay sheets
   (tablet inspector, phone sheets) are excluded: opening one never moves
   the map.
10. **Motion.** `--t-fast 120ms` (hover/press), `--t 200ms` (panels),
    `--t-sheet 260ms` (sheets), all on `--ease`. `prefers-reduced-motion`
    zeroes the tokens — never add a duration that bypasses them.
11. **One card at a time.** Hover cards are previews; a click answers with
    a pin (one hit) or the stack picker (several). After a click the
    clicked features stay hover-silent until the pointer moves on or the
    card closes; an open picker silences all hover; grabbing, zooming or
    flying the camera, or leaving the canvas, drops hover cards (they are
    anchored to the globe and would drift). All of it lives in
    `map-popups.ts` (`muted`, `moving`, `pickerOpen`), never per layer.
    Cards also anchor inside the free map area (`fitAnchor`: the camera
    padding *is* the free area), so a card near a panel opens beside it,
    never on top of it.
12. **Collapsible chrome, fixed homes.** Explorer, inspector and dock keep
    their positions but each can slide off to its edge (`body.hide-expl
    / hide-insp / hide-dock`, edge handles `#pt-*`); `\` or CLEAR hides
    all three, `/` always brings the dock back for the command line. The
    layout vars (`--lw/--rw/--dock-h`) collapse with the panel, so the
    minimap, toasts and dock follow, and the camera eases into the space
    given back. Hidden panels leave the focus order. State is per browser
    (`localStorage thoth.hidden`). Desk + tablet only; phone uses sheets.
13. **Free-floating is for objects, not chrome.** A pinned card's "Pop out"
    turns it into a window (`PopWindows.tsx`, max 4, oldest evicted):
    drag by the header, click to raise, double-click (or –) to minimise to
    the tray under the status bar, a dashed accent leader line back to its
    map point (hidden when the point is behind the globe or under chrome).
    Windows re-read their layer on SSE ticks; the arrangement is remembered
    (`thoth.pop`). Below desk they become one swipeable stack above the
    dock — no free windows where there is no room for them.

Testing rule: with panels floating over the map, a feature can be rendered
yet covered by chrome. E2e specs pick map points with
`document.elementFromPoint` and only click ones whose hit target is the map
canvas (see `firstPoint` in `breakpoints.spec.ts`, `pointOn` in
`hud.spec.ts`); never hard-code "free area" bounds.

Binding rule: the terminal MUST be usable on any screen width — phone, tablet,
laptop, ultrawide. New UI work starts from primitives, never from one-off markup.
Globe + flat map (osiris-style) is the agreed renderer; everything around it is
composed from the catalog below.

## 1. Breakpoints (width-based, device-agnostic)

| Class | Width | Layout |
|---|---|---|
| `desk` | ≥1200px | Full-bleed map; floating status bar across the top, explorer (`--expl` 264px) left, inspector (`--insp` 372px) right, dock (threat · timeline · command line) between them at the bottom. Reference look. |
| `tab` | 768–1199px | Explorer collapses to a floating 56px rail: glyph over its count (names/groups hidden; the row title carries the name). Inspector is an overlay panel below the status bar that slides in from the right, hidden until a tab/selection opens it; the dock spans rail → right edge. |
| `phone` | <768px | Map-first. Floating status bar: LAYERS button + mark + health (clock and mode controls hidden). The dock shrinks to a floating command pill. Explorer and inspector share one bottom-sheet form (`--r-sheet` top corners, grabber, 60vh cap, slides up). Inputs are 16px so iOS never zooms; safe-area insets respected. |

Rules:
- No fixed pixel widths outside the token + breakpoint system. Panels size in `px` tokens only at `desk`; everywhere else they are overlays/sheets.
- Touch targets ≥44px on `tab`/`phone` (rails, chips, tab buttons).
- The map is never unmounted on breakpoint change — only panels reflow. Resize must not drop sources/layers.
- Ticker text scrolls on all classes; never wraps.
- Frame budget on touch (keep panning at the display's refresh rate): the
  map canvas caps at 2× device pixels with no MSAA; live-data `setData`
  waits for the camera to stop; nothing re-renders the page on a timer or
  a heartbeat (clock and stream age live in their own leaf / a ref); no
  React state updates on map `move` unless something on screen follows the
  camera; chrome hidden at a breakpoint is not mounted (a second WebGL
  map costs even at `display: none`); panel scrollers use
  `overscroll-behavior: contain`.
- `body[data-bp]` mirrors the active class for JS (`desk|tab|phone`), set by `page.tsx` on resize.

## 2. Primitive catalog (use these, nothing else)

React primitives live in `app/src/lib/ui.tsx` unless noted.

| Primitive | Component | Notes |
|---|---|---|
| Glyph | `<Glyph layer size?>` | The layer's Lucide icon from the catalog, `currentColor` |
| Button | `<Btn>` | Skins via props (`.tbtn`, `.go` primary, `.ghost-btn`) |
| Chip (filter) | `<Chip>` | Severity chips, segmented cells, tab buttons |
| Layer row | `<LayerRow>` | Explorer rows: glyph + name + count + visibility |
| Badge | `<Badge text kind>` | `critical\|watch\|info\|stale\|live` → colour only, never new hues |
| KV grid | `<KV pairs>` | Dossier / object detail |
| Item row | `<ItemRow>` | Alerts and inspector lists |
| Field | `<Field>` | Command bar and inspector inputs (16px on phone) |
| Popup | `components/map-popups.ts` | Map hover/click cards; one delegated listener, escaped content |
| Command palette | `<CommandPalette actions>` (`components/Palette.tsx`) | Ctrl/⌘+K; actions are `{group, label, hint?, run}` built from page state; ranked subsequence match; Enter ranks the live input value |
| Data table | `<DataTable rows cols rowKey …>` (`components/DataTable.tsx`) | Any tabular view: sticky header, sortable columns (`aria-sort`), `num` columns right-aligned mono, `wide` columns only on a wide panel, optional expandable detail row; compact panels scroll sideways |
| Formatting | `ageStr()`, `fmtCadence()` | Relative ages and cadences, one wording everywhere |

Rules:
- Glyphs: Lucide SVG paths from the `LAYERS` table in `lib/layer-catalog.ts` only (ISC). No emoji, no new icon sets.
- Colors: CSS tokens from `:root` in `app/src/app/globals.css` only (mirrored in `lib/palette.ts` for map code; see §0). Severity colour is data, not decoration.
- Text escaping: React escapes by default; the map popups escape via `esc()`. Raw HTML (`dangerouslySetInnerHTML`, `setHTML` with unescaped input) is a review flag.
- e2e-pinned selectors (`#map #tape-txt .lrow #cmd #tabs #tl-canvas #insp-body #health-pill`) MUST survive any refactor — tests assert on them.

# thoth-app

The Thoth web terminal: Next.js 16 (App Router), React 19 and MapLibre GL 6.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server on `:3000`. Proxies `/api/*` to `THOTH_API_INTERNAL` (default `http://localhost:4000`). |
| `npm run build` / `npm start` | Production build (standalone output) and server |
| `npm run typecheck` / `npm run lint` | `tsc` / Biome |
| `npm test` | Vitest (jsdom) |
| `npm run test:e2e` | Playwright. Needs a running API and app. |

`predev` and `prebuild` copy the MapLibre worker into `public/maplibre/`.
The copy is generated and gitignored.

## Layout

```
src/proxy.ts            access-token gate + server-side write-key injection
src/app/                page.tsx (shell, layout, camera padding) · ops/ · healthz/ · globals.css (tokens)
src/components/         MapView, map-popups, Explorer, Inspector + tabs, Palette, DataTable, Replay, …
src/lib/                api.ts · auth.ts · jwt.ts · layer-catalog.ts · palette.ts · ui.tsx (primitives) · workspace.ts
e2e/                    Playwright specs (smoke, breakpoints, hud, floating, viewport, workflow, alive)
test/                   Vitest specs
restart.sh              safe rebuild and restart for non-Docker hosts
```

## Documentation

- [UI design system](../docs/development/ui-design-system.md): tokens,
  breakpoints and primitives. Read it before any UI change.
- [Architecture › App](../docs/architecture/overview.md#app-app)
- [Configuration › App](../docs/operations/configuration.md#app-web-terminal)
- [Security model](../SECURITY.md)

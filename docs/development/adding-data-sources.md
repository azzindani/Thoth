# Adding data sources

Thoth is designed to keep absorbing public data sources. This guide covers
the acceptance rules, how to build a collector, and how to verify it.
Routine upkeep of existing sources is covered in
[Source maintenance](source-maintenance.md).

## Acceptance rules

1. **Keyless first.** A source that needs a key, a signup or a paid plan is
   out of scope unless it is optional and ships disabled. Such a source
   must report `disabled: …` in health, never fail loudly or fake data.
2. **Clear terms.** The upstream's terms must allow automated access.
   Record the licence in a comment next to the URL constant.
3. **Complete pipeline.** Each source gets: a collector leg, a
   `raw_events` write, a normalized `events` mapping, `feed_health`
   updates, a `layer_versions` bump, a contract test and a docs row. No map
   layer may exist without a collector and table behind it.
4. **No duplicates.** More than 300 sources exist already. Search
   `backend/src` for the upstream host before you start.
5. **Probe from the deployment network.** Some upstreams block certain
   regions, cloud ranges or resolvers. Probe from the host *and* from
   inside the worker container before you build.

## Building a collector

### 1. Extend or create

Prefer to extend the collector that already owns the theme. For example,
a new national wildfire feed goes into `wildfires.ts`. Create a new
collector only for a new theme or cadence.

### 2. Write the leg

`backend/src/workers/collectors/<name>.ts` exports
`collect(): Promise<{ ok: boolean; count?: number; error?: string }>`. A
minimal collector looks like this:

```ts
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { dbClock, errMsg, markHealth, pruneStale, storeNormalized, storeRaw } from "../lib/store.js";

// Publisher, licence, and why this endpoint (moved paths, quirks) live here.
const SOURCE = "example-feed";
const FEED_URL = "https://data.example.org/v1/alerts.json";

export async function collect() {
	const layer = "disasters";
	try {
		const runStart = await dbClock();
		assertSafeUrl(FEED_URL);
		const res = await stealthFetch(FEED_URL, {}, 30_000);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = (await res.json()) as { alerts?: unknown[] };
		// Shape guard: a changed payload throws, it never empties the layer.
		if (!Array.isArray(body.alerts)) throw new Error("unexpected payload");
		await storeRaw(SOURCE, layer, res.status, body);
		for (const a of body.alerts as Alert[]) {
			await storeNormalized({
				id: `${SOURCE}:${a.id}`,           // stable → upserts on re-poll
				ts: a.issued,                       // observation time, not fetch time
				source: SOURCE, layer,
				title: a.headline, url: a.link,
				severity: a.level >= 3 ? "critical" : a.level === 2 ? "watch" : "info",
				lat: a.lat, lon: a.lon,             // or geomJson for polygons
				meta: { level: a.level },
			});
		}
		await pruneStale(SOURCE, runStart);     // only for "current picture" feeds
		await markHealth(SOURCE, true);
		return { ok: true, count: body.alerts.length };
	} catch (e: unknown) {
		await markHealth(SOURCE, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}
```

Rules that apply to every leg:

- **Named constants** for URLs, thresholds and windows, owned by the
  collector. The *reason* for any workaround goes in a comment next to the
  constant that implements it.
- **Timestamps.** `ts` is when the thing happened or was published. The
  store sets `ingested_at`.
- **Geometry.** Point layers take points only. Use `pointOf` from
  `lib/geo.ts` to reduce an area to a point. Polygons go through
  `geomJson`.
- **Current-picture feeds** (warnings in force, open incidents, vessel
  positions) call `pruneStale()` after a successful poll. History feeds do
  not.
- **Rate limits.** Space out requests and honour `Retry-After`. For budgeted
  APIs, use `succeededWithin()` so that worker restarts don't spend the
  budget again.
- **Size.** 700 lines or fewer per file. Split by responsibility.

### 3. Register

- For a new collector, add an entry to `src/workers/registry.ts`:

  ```ts
  example: { module: "./collectors/example.js", intervalSec: 900, ttlSec: 3600 },
  ```

  Pick `intervalSec` to match how often the upstream publishes, not
  faster.
- Add every new **source id** to `src/api/source-map.ts`, which maps it to
  its collector for the monitor and `/api/health`.
- If the feed can legitimately be empty or silent for a long time, add it
  to `NEVER_FROZEN` in `src/api/freeze.ts`. If it publishes on a known slow
  schedule, add a `BUDGET` entry there.
- For a new map layer, add it to `app/src/lib/layer-catalog.ts` with a
  Lucide glyph (see [UI design system](ui-design-system.md)).
- If the source needs new tables, add a new numbered migration.

### 4. Test

Add contract tests to `test/collectors-<collector>.test.ts`. Name the file
and its `describe` blocks after what they collect. Use the stubs in
`test/helpers/collector-stubs.ts`:

- a normal payload stores rows with the expected ids, severities and
  geometry;
- a changed or empty payload throws, or stores nothing, without wiping the
  existing rows;
- an HTTP error marks health as failed.

Then run the real collector once against the **test database only**:

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:collectors
DATABASE_URL=$TEST_DATABASE_URL npx tsx src/workers/run.ts --once <collector>
```

For more, see [Testing](testing.md).

### 5. Document

- Add a row to [Data sources](../reference/data-sources.md), or extend
  one.
- Add an **Added** line to `CHANGELOG.md` under *Unreleased*.
- Remove the source from the [candidate queue](source-maintenance.md#candidate-queue)
  if it was listed there.

### 6. Verify in production

After you deploy (`docker compose up -d --build worker`, plus `api` if
routes changed and `app` if the catalog changed), confirm in read-only
mode that the new sources have a `feed_health` row with `last_ok` set and
no error, and that their events landed with geometry. A source that fails
in production gets fixed or reverted.

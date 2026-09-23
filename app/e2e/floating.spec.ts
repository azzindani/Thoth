// Floating UI: collapsible panels (edge tabs, clear view, persistence),
// pop-out object windows (drag, minimise tray, restore, close, remembered
// layout) and cards that keep clear of the panels.
// Serial + one shared desk page (boot once), like hud.spec.ts.
import { expect, type Page, test } from "./fixtures";

type MLMap = {
	jumpTo: (o: { center: [number, number]; zoom: number }) => void;
	once: (ev: string, cb: () => void) => void;
	project: (ll: [number, number] | number[]) => { x: number; y: number };
	getPadding: () => { left: number; right: number; top: number };
	getContainer: () => HTMLElement;
	panBy: (d: [number, number], o: { animate: boolean }) => void;
	queryRenderedFeatures: (
		g?: unknown,
		o?: unknown,
	) => {
		layer: { id: string };
		geometry: { type: string; coordinates: number[] };
	}[];
	querySourceFeatures: (id: string) => unknown[];
};

// Panels slide, then flip visibility after the transition — which needs
// animation frames. CI renders the globe in software GL, where a frame can
// take 1–2 s under two workers, so panel visibility gets frame-time room.
// (State is asserted separately, via the body.hide-* classes.)
const SLIDE = { timeout: 15000 };

async function boot(page: Page) {
	await page.goto("/");
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const m = (window as unknown as { __thothMap?: MLMap }).__thothMap;
					try {
						return (m?.querySourceFeatures("flights").length ?? 0) > 0;
					} catch {
						return false;
					}
				}),
			{ timeout: 120000 },
		)
		.toBe(true);
}

async function jumpTo(page: Page, center: [number, number], zoom: number) {
	await page.evaluate(
		([c, z]) =>
			new Promise<void>((r) => {
				const m = (window as unknown as { __thothMap: MLMap }).__thothMap;
				m.jumpTo({ center: c as [number, number], zoom: z as number });
				m.once("idle", () => r());
				setTimeout(r, 4000);
			}),
		[center, zoom] as const,
	);
}

/** A reachable, unstacked point of one of `layers` in the current view. */
async function lonePoint(page: Page, layers: string[]) {
	return page.evaluate((layers) => {
		const m = (window as unknown as { __thothMap: MLMap }).__thothMap;
		const r = m.getContainer().getBoundingClientRect();
		// Our data layers only (mirrors pickBase): no chrome, no clusters.
		const ours = (id: string) =>
			!["routes", "terminator", "sat", "bg"].includes(id) &&
			/^[a-z]+(-p|-o.*)?$/.test(id);
		for (const l of layers)
			for (const f of m.queryRenderedFeatures(undefined, { layers: [l] })) {
				if (f.geometry.type !== "Point") continue;
				const s = m.project(f.geometry.coordinates);
				const x = s.x + r.left;
				const y = s.y + r.top;
				if (document.elementFromPoint(x, y)?.tagName !== "CANVAS") continue;
				const near = m
					.queryRenderedFeatures([
						[s.x - 10, s.y - 10],
						[s.x + 10, s.y + 10],
					])
					.filter((h) => ours(h.layer.id) && !/-(c|n)$/.test(h.layer.id));
				if (near.length === 1) return { x, y };
			}
		return null;
	}, layers);
}

/** Pin one object (through the picker if the pixel is stacked). */
async function pinSomething(page: Page) {
	for (const [c, z, layers] of [
		[[-0.1, 51.5], 10, ["cctv", "flights", "news", "transit", "metar"]],
		[[139.7, 35.7], 9, ["forecast", "quakes", "radiation"]],
	] as const) {
		await jumpTo(page, c as unknown as [number, number], z);
		const p = await lonePoint(page, [...layers]);
		if (!p) continue;
		await page.mouse.click(p.x, p.y);
		const pick = page.locator(".pick-pop .pick-row");
		if (
			await pick
				.first()
				.isVisible({ timeout: 800 })
				.catch(() => false)
		)
			await pick.first().click();
		if (
			await page
				.locator(".pin-pop")
				.first()
				.isVisible({ timeout: 3000 })
				.catch(() => false)
		)
			return;
	}
	throw new Error("no pinnable object found");
}

test.describe
	.serial("floating desk", () => {
		let page: Page;
		test.beforeAll(async ({ browser }) => {
			test.setTimeout(240000);
			page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
			await boot(page);
		});
		test.afterAll(async () => {
			await page.close();
		});

		test("clear view hides every panel and gives the camera the space", async () => {
			const pad = () =>
				page.evaluate(() =>
					(window as unknown as { __thothMap: MLMap }).__thothMap.getPadding(),
				);
			expect((await pad()).right).toBeGreaterThan(300);
			await page.keyboard.press("Backslash");
			for (const id of ["#explorer", "#inspector", "#bottom"])
				await expect(page.locator(id)).toBeHidden(SLIDE);
			await expect(page.locator("#clear-btn")).toHaveClass(/mode-on/);
			await expect.poll(async () => (await pad()).right).toBe(0);
			expect((await pad()).left).toBe(0);
			await page.screenshot({ path: "e2e/shots/desk-clear.png" });

			// Edge tab brings one panel back, the others stay out of the way.
			const tab = page.locator("#pt-expl");
			await expect(tab).toHaveClass(/is-hidden/);
			await expect(tab).toContainText("Layers");
			await tab.click();
			await expect(page.locator("#explorer")).toBeVisible(SLIDE);
			await expect(page.locator("#inspector")).toBeHidden(SLIDE);

			// "/" always reaches the command line: a hidden dock slides back.
			await page.keyboard.press("/");
			await expect(page.locator("#bottom")).toBeVisible(SLIDE);
			await expect(page.locator("#cmd")).toBeFocused();
			await page.locator("#cmd").blur();
			// \ is ignored while typing: make sure focus really left the input.
			await expect
				.poll(() => page.evaluate(() => document.activeElement?.tagName))
				.toBe("BODY");

			// Not everything hidden → \ hides all; again → shows all.
			const body = page.locator("body");
			await page.keyboard.press("Backslash");
			await expect(body).toHaveClass(/hide-expl/);
			await expect(body).toHaveClass(/hide-insp/);
			await expect(body).toHaveClass(/hide-dock/);
			await expect(page.locator("#explorer")).toBeHidden(SLIDE);
			await page.keyboard.press("Backslash");
			await expect(body).not.toHaveClass(/hide-(expl|insp|dock)/);
			for (const id of ["#explorer", "#inspector", "#bottom"])
				await expect(page.locator(id)).toBeVisible(SLIDE);
			await expect.poll(async () => (await pad()).right).toBeGreaterThan(300);
		});

		test("panel state is remembered across reloads", async () => {
			await page.locator("#pt-insp").click();
			// State first, then the panel: a recurrence names which one failed.
			await expect(page.locator("body")).toHaveClass(/hide-insp/);
			await expect(page.locator("#inspector")).toBeHidden(SLIDE);
			await boot(page);
			await expect(page.locator("body")).toHaveClass(/hide-insp/);
			await expect(page.locator("#inspector")).toBeHidden(SLIDE);
			await page.locator("#pt-insp").click();
			await expect(page.locator("#inspector")).toBeVisible(SLIDE);
		});

		test("pop-out windows: open, drag, minimise, restore, full view, close", async () => {
			await pinSomething(page);
			await page.locator('.pin-pop [data-act^="pop:"]').click();
			const win = page.locator(".popwin");
			await expect(win).toHaveCount(1);
			await expect(page.locator(".pin-pop")).toHaveCount(0);

			// Drag by the header.
			const head = win.locator(".popwin-head");
			const a = await win.boundingBox();
			if (!a) throw new Error("no window box");
			await page.mouse.move(a.x + 80, a.y + 18);
			await page.mouse.down();
			await page.mouse.move(a.x + 80 - 220, a.y + 18 + 90, { steps: 8 });
			await page.mouse.up();
			// The window's own position (style), not its box: the open
			// animation scales the box for a moment.
			const at = () =>
				win.evaluate((e) => ({
					x: Number.parseFloat((e as HTMLElement).style.left),
					y: Number.parseFloat((e as HTMLElement).style.top),
				}));
			const b = await at();
			expect(Math.round(b.x - a.x)).toBeLessThan(-150);
			expect(Math.round(b.y - a.y)).toBeGreaterThan(60);

			// Minimise to the tray (double-click header) and restore.
			await head.dblclick();
			await expect(win).toHaveCount(0);
			await expect(page.locator(".pop-chip")).toHaveCount(1);
			await page.locator(".pop-chip").click();
			await expect(win).toHaveCount(1);
			expect((await at()).x).toBe(b.x);

			// Remembered across a reload, position included.
			await boot(page);
			await expect(win).toHaveCount(1);
			expect(await at()).toEqual(b);

			// Full view opens the complete card; the window stays.
			await win.locator('[data-pop-act="full"]').click();
			await expect(page.locator("#fullview")).toBeVisible();
			await page.locator("#fullview .fv-close").click();
			await expect(win).toHaveCount(1);

			await win.locator('[data-pop-act="close"]').click();
			await expect(win).toHaveCount(0);
		});

		test("cards open inside the free map area, never over a panel", async () => {
			const inspLeft = await page.evaluate(
				() =>
					document.getElementById("inspector")?.getBoundingClientRect().left ??
					0,
			);
			// A rendered, reachable point in the band just left of the
			// inspector (the camera is left alone: on the globe a forced pan
			// lands imprecisely and the new tiles aren't drawn yet). Several
			// views are tried; statics make the band dense in CI and live.
			let pt: { x: number; y: number } | null = null;
			for (const c of [
				[60, 40],
				[20, 30],
				[100, 20],
				[-20, 45],
			] as [number, number][]) {
				await jumpTo(page, c, 3);
				pt = await page.evaluate(
					({ inspLeft }) => {
						const m = (window as unknown as { __thothMap: MLMap }).__thothMap;
						const r = m.getContainer().getBoundingClientRect();
						for (const l of ["airports", "bases", "energy", "datacenters"])
							for (const f of m.queryRenderedFeatures(undefined, {
								layers: [l],
							})) {
								if (f.geometry.type !== "Point") continue;
								const s = m.project(f.geometry.coordinates);
								const x = s.x + r.left;
								const y = s.y + r.top;
								if (x < inspLeft - 110 || x > inspLeft - 20) continue;
								if (y < 160 || y > r.height - 200) continue;
								if (document.elementFromPoint(x, y)?.tagName !== "CANVAS")
									continue;
								return { x, y };
							}
						return null;
					},
					{ inspLeft },
				);
				if (pt) break;
			}
			test.skip(!pt, "no point feature in view");
			if (!pt) return;
			await page.waitForTimeout(400);
			await page.mouse.move(pt.x - 40, pt.y);
			await page.mouse.move(pt.x, pt.y, { steps: 4 });
			const pop = page.locator("#map .maplibregl-popup").last();
			await expect(pop).toBeVisible({ timeout: 5000 });
			const hb = await pop.boundingBox();
			expect((hb?.x ?? 0) + (hb?.width ?? 0)).toBeLessThanOrEqual(inspLeft + 1);
			await page.mouse.click(pt.x, pt.y);
			const pin = page.locator(".pin-pop, .pick-pop").first();
			await expect(pin).toBeVisible({ timeout: 5000 });
			const pb = await pin.boundingBox();
			expect((pb?.x ?? 0) + (pb?.width ?? 0)).toBeLessThanOrEqual(inspLeft + 1);
			await page.screenshot({ path: "e2e/shots/desk-card-avoid.png" });
			await page.locator("#map .maplibregl-popup-close-button").first().click();
		});
	});

test.describe
	.serial("floating phone", () => {
		test("popped-out cards stack above the command line", async ({
			browser,
		}) => {
			test.setTimeout(240000);
			const page = await browser.newPage({
				viewport: { width: 390, height: 844 },
				hasTouch: true,
				isMobile: true,
			});
			await boot(page);
			await pinSomething(page);
			await page.locator('.pin-pop [data-act^="pop:"]').click();
			const card = page.locator(".pop-stack .popwin");
			await expect(card).toHaveCount(1);
			// Stacked form: no free-window chrome, and it sits above the pill.
			await expect(card.locator('[data-pop-act="min"]')).toHaveCount(0);
			const cb = await card.boundingBox();
			const dock = await page.locator("#bottom").boundingBox();
			expect((cb?.y ?? 0) + (cb?.height ?? 0)).toBeLessThanOrEqual(
				(dock?.y ?? 0) + 1,
			);
			await page.screenshot({ path: "e2e/shots/phone-popstack.png" });
			await card.locator('[data-pop-act="close"]').click();
			await expect(card).toHaveCount(0);
			await page.close();
		});
	});

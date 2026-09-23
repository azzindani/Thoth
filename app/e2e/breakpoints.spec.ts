// Thoth rail + phone suites: the UX that used to swallow map taps.
// Serial + one shared page per breakpoint (slow CDN boot happens once).
// Screenshots kept in e2e/shots/.
import { expect, type Page, test } from "./fixtures";

async function boot(page: Page) {
	await page.goto("/");
	await expect(page.locator("#layer-rows")).toContainText("bases", {
		timeout: 30000,
	});
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
	// Map data readiness: clustered sources wrap data, count via
	// querySourceFeatures (see hud.spec.ts). Phone tests tap airports, so
	// wait for that source too — loadAll pool order + big statics (airports
	// 5280) land late on a loaded box, and drilling into unloaded data
	// finds nothing at any zoom.
	await expect
		.poll(
			async () =>
				await page.evaluate((): boolean => {
					const m = (
						window as unknown as { __thothMap?: Record<string, never> }
					).__thothMap as unknown as {
						querySourceFeatures: (id: string) => unknown[];
					};
					return ["bases", "airports"].every((l) => {
						try {
							return (m?.querySourceFeatures(l)?.length ?? 0) > 0;
						} catch {
							return false;
						}
					});
				}),
			{ timeout: 180000 },
		)
		.toBe(true);
}

async function firstPoint(page: Page, layer: string) {
	const p = await page.evaluate((layer) => {
		const m = (window as unknown as { __thothMap?: Record<string, never> })
			.__thothMap as unknown as {
			queryRenderedFeatures: (o: unknown) => {
				geometry: { type: string; coordinates: number[] };
				properties: Record<string, string>;
			}[];
			project: (c: number[]) => { x: number; y: number };
			getContainer: () => HTMLElement;
		};
		const f = m
			.queryRenderedFeatures({ layers: [layer] })
			.find((x) => x.geometry?.type === "Point");
		if (!f) return null;
		const s = m.project(f.geometry.coordinates);
		const r = m.getContainer().getBoundingClientRect();
		return { x: s.x + r.left, y: s.y + r.top, title: f.properties.title };
	}, layer);
	if (!p) throw new Error(`no ${layer} point rendered`);
	return p as { x: number; y: number; title: string };
}

/** Dense layers cluster below z12 (airports 375→5280): drill toward the
 * data — free point wins, else jump onto a cluster and go deeper.
 * Instant jumpTo, no tap side-effects to fight the picker. Each level polls
 * briefly: tiles re-resolve async after a jump, and an immediate query on
 * a starved compositor sees the old viewport (or nothing). */
async function zoomForFreePoint(
	page: Page,
	layer: string,
	center: [number, number],
	baseZoom: number,
): Promise<{ x: number; y: number; title: string } | null> {
	let c: [number, number] = center;
	for (let z = baseZoom; z <= baseZoom + 10; z += 2) {
		await jumpTo(page, c, z);
		const deadline = Date.now() + 10000;
		for (;;) {
			try {
				return await firstPoint(page, layer);
			} catch {
				/* tiles still resolving */
			}
			if (Date.now() > deadline) break;
			await page.waitForTimeout(500);
		}
		const cluster = await page.evaluate(
			({ layer }) => {
				const m = (window as unknown as { __thothMap?: Record<string, never> })
					.__thothMap as unknown as {
					queryRenderedFeatures: (o: unknown) => {
						geometry: { type: string; coordinates: number[] };
					}[];
				};
				const f = m
					.queryRenderedFeatures({ layers: [`${layer}-c`] })
					.find((x) => x.geometry?.type === "Point");
				return f ? (f.geometry.coordinates as [number, number]) : null;
			},
			{ layer },
		);
		if (!cluster) return null;
		c = cluster;
	}
	return null;
}

async function jumpTo(page: Page, center: [number, number], zoom: number) {
	await page.evaluate(
		({ center, zoom }) => {
			(
				window as unknown as {
					__thothMap?: { jumpTo: (o: unknown) => void };
				}
			).__thothMap?.jumpTo({ center, zoom });
		},
		{ center, zoom },
	);
	// Idle-gated (see hud.spec.ts): coords valid only after render settles.
	await page.evaluate(
		() =>
			new Promise((res) => {
				const m = (window as unknown as { __thothMap?: Record<string, never> })
					.__thothMap as unknown as {
					isMoving: () => boolean;
					loaded: () => boolean;
					once: (e: string, f: () => void) => void;
				};
				let done = false;
				const fin = () => {
					if (!done) {
						done = true;
						res(1);
					}
				};
				try {
					if (m && !m.isMoving() && m.loaded()) return fin();
					m?.once("idle", fin);
				} catch {
					fin();
				}
				setTimeout(fin, 30000);
			}),
	);
	await page.waitForTimeout(1500);
}

test.describe
	.serial("tab 900x900", () => {
		let page: Page;

		test.beforeAll(async ({ browser }) => {
			page = await browser.newPage({ viewport: { width: 900, height: 900 } });
			await boot(page);
		});

		test.afterAll(async () => {
			await page.close();
		});

		test("rail is icons-only, tap pins preview, Full view opens card", async () => {
			await jumpTo(page, [10, 50], 4);
			await expect(page.locator("#explorer .findbox")).toBeHidden();
			await expect(page.locator("#explorer .theater")).toBeHidden();
			await expect(page.locator(".lrow .nm").first()).toBeHidden();
			const pinned = () =>
				page.locator(".maplibregl-popup-content .hov", {
					has: page.locator(".hov-act"),
				});
			let ok = false;
			for (let i = 0; i < 5 && !ok; i++) {
				const p = await firstPoint(page, "bases");
				await page.mouse.click(p.x, p.y);
				await page.waitForTimeout(1200);
				if (await page.locator(".maplibregl-popup-content .pick").isVisible()) {
					await page
						.locator(".maplibregl-popup-content .pick-row")
						.first()
						.click();
				}
				try {
					await expect(pinned().first()).toBeVisible({ timeout: 3000 });
					ok = true;
				} catch {
					/* tile churn; fresh coords next round */
				}
			}
			expect(ok, "tab tap pin converges").toBe(true);
			// The tap opens nothing else: no full view, no inspector sheet.
			await expect(page.locator("#fullview")).toBeHidden();
			await expect(page.locator("#inspector.open")).toBeHidden();
			await pinned().first().locator('button[data-act^="full:"]').click();
			await expect(page.locator("#fullview")).toContainText("Full view", {
				timeout: 10000,
			});
			await page.screenshot({ path: "e2e/shots/tab-object.png" });
			await page.locator("#fullview .fv-close").click();
			await expect(page.locator("#fullview")).toBeHidden({ timeout: 5000 });
		});

		test("tabs + timeline work on the rail", async () => {
			// Inspector tabs open from the ☰ sheet, health pill, or cmdbar
			// (the floating Panel button was removed 2026-09-18). On the
			// rail the inspector is display:none until a tab opens it, so
			// open via the health pill (visible in the ticker), not the
			// hidden tab strip — then switch to alerts.
			await page.locator("#health-pill").click();
			await expect(page.locator("#inspector.open")).toBeVisible({
				timeout: 10000,
			});
			await page.locator('#tabs button[data-tab="alerts"]').click();
			await expect(page.locator("#insp-body")).toContainText("Alerts", {
				timeout: 15000,
			});
			await page.locator(".tl-layer").selectOption("fires");
			await expect(page.locator("#tl-info")).toContainText("fires", {
				timeout: 15000,
			});
			await page.screenshot({ path: "e2e/shots/tab-full.png" });
		});
	});

test.describe
	.serial("phone 390x844", () => {
		let page: Page;

		test.beforeAll(async ({ browser }) => {
			page = await browser.newPage({
				viewport: { width: 390, height: 844 },
				hasTouch: true,
				isMobile: true,
			});
			await boot(page);
		});

		test.afterAll(async () => {
			await page.close();
		});

		test("sheet opens, layer toggles, tap selects", async () => {
			await expect(page.locator("#explorer.open")).toBeHidden();
			await page.locator(".sheet-toggle").click();
			await expect(page.locator("#explorer.open")).toBeVisible({
				timeout: 5000,
			});
			const news = page.locator(".lrow", { hasText: "news" }).first();
			await news.click();
			await expect(news).toHaveClass(/off/);
			await page.screenshot({ path: "e2e/shots/phone-sheet.png" });
			await page.locator(".sheet-toggle").click();
			const pinned = () =>
				page.locator(".maplibregl-popup-content .hov", {
					has: page.locator(".hov-act"),
				});
			let ok = false;
			// Prefer the boot view: it is already rendered (probes show fresh
			// jumps can outrun tile re-resolve for a minute on a loaded box).
			// Fall back to the cluster drill only when nothing is tappable.
			let anchor: { x: number; y: number; title: string } | null = null;
			try {
				anchor = await firstPoint(page, "airports");
			} catch {
				await jumpTo(page, [10, 50], 4);
				anchor = await zoomForFreePoint(page, "airports", [10, 50], 4);
			}
			if (!anchor) throw new Error("no airports point rendered");
			for (let i = 0; i < 5 && !ok; i++) {
				let p = anchor;
				try {
					p = await firstPoint(page, "airports");
				} catch {
					/* churned under us; tap the anchor coords */
				}
				await page.touchscreen.tap(p.x, p.y);
				await page.waitForTimeout(1200);
				if (await page.locator(".maplibregl-popup-content .pick").isVisible()) {
					await page
						.locator(".maplibregl-popup-content .pick-row")
						.first()
						.click();
				}
				try {
					await expect(pinned().first()).toBeVisible({ timeout: 3000 });
					ok = true;
				} catch {
					/* tile churn; fresh coords next round */
				}
			}
			expect(ok, "phone tap pin converges").toBe(true);
			await expect(page.locator("#fullview")).toBeHidden();
			await pinned().first().locator('button[data-act^="full:"]').click();
			await expect(page.locator("#fullview")).toContainText("Full view", {
				timeout: 10000,
			});
			// Bottom sheet, not a fullscreen takeover: map stays visible above.
			// Sheet top clears 25% (not 30%: the wrap sits 130px above the
			// bottom bar, and tall content rests on the 56vh cap).
			const box = await page.locator("#fullview .fullview").boundingBox();
			const vp = page.viewportSize() ?? { height: 844 };
			expect(box, "sheet has geometry").toBeTruthy();
			if (!box) throw new Error("fullview sheet has no geometry");
			expect(box.y).toBeGreaterThan(vp.height * 0.25);
			expect(box.height).toBeLessThan(vp.height * 0.7);
			await page.screenshot({ path: "e2e/shots/phone-object.png" });
			await page.locator("#fullview .fv-close").click();
			await expect(page.locator("#fullview")).toBeHidden({ timeout: 5000 });
		});

		test("cmdbar + pill stay compact", async () => {
			await expect(page.locator("#health-pill")).toContainText("LIVE");
			// Extras are desk-only CSS (display:none still carries text content).
			await expect(page.locator("#health-pill .pill-ext")).toBeHidden();
			await page.fill("#cmd", "trend quakes 7");
			await page.keyboard.press("Enter");
			await expect(page.locator("#insp-body")).toContainText("daily counts", {
				timeout: 20000,
			});
			const over = await page.evaluate(() => ({
				body: document.body.scrollWidth,
				inner: window.innerWidth,
			}));
			expect(over.body).toBeLessThanOrEqual(over.inner);
			await page.screenshot({ path: "e2e/shots/phone-full.png" });
		});
	});

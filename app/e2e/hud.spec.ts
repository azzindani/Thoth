// Thoth HUD deep suite (desk 1600x900): hover verbosity, selection,
// stacked-point picker, clusters, polygons, panels, timeline, minimap,
// SSE status + kept screenshots in e2e/shots/.
// Serial + shared page (one slow-CDN boot), explicit views per test.
// Overlapping layers each fire their own hover card, so card assertions
// match as sets (filtered .first()), never a bare multi-match locator.
// Pointer tests re-query fresh coords + retry: tiles re-resolve async.
import { expect, type Page, test } from "playwright/test";
import { LAYER_NAMES } from "../src/lib/layer-catalog";

test.describe
	.serial("hud desk", () => {
		let page: Page;

		test.beforeAll(async ({ browser }) => {
			page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
			await page.goto("/");
			await expect(page.locator("#layer-rows")).toContainText("bases", {
				timeout: 30000,
			});
			await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
			// Map data readiness (slow CDN in sandbox): the interaction layers
			// must serve features. NOTE: clustered sources wrap data as
			// {_data:{geojson}}, so count via querySourceFeatures, not _data.
			// NOTE 2026-09-14: assert PRESENCE per layer, never a total — dense
			// layers (airports 375→5280) merge into fewer, bigger clusters, so
			// any absolute total rots as data grows.
			await expect
				.poll(
					async () =>
						await page.evaluate((): boolean => {
							const m = (
								window as unknown as { __thothMap?: Record<string, never> }
							).__thothMap as unknown as {
								querySourceFeatures: (id: string) => unknown[];
							};
							return ["airports", "datacenters", "cctv"].every((l) => {
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
		});

		test.afterAll(async () => {
			await page.close();
		});

		interface ScreenPt {
			x: number;
			y: number;
			title: string;
		}

		type MLMap = {
			queryRenderedFeatures: (
				g: unknown,
				o?: unknown,
			) => {
				geometry: { type: string; coordinates: number[] };
				properties: Record<string, string | number>;
			}[];
			project: (c: number[]) => { x: number; y: number };
			getContainer: () => HTMLElement;
			jumpTo: (o: unknown) => void;
			isMoving: () => boolean;
			loaded: () => boolean;
			once: (e: string, f: () => void) => void;
			getZoom: () => number;
		};

		async function jumpTo(center: [number, number], zoom: number) {
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
			// Idle-gated: projected coords are valid only after render settles.
			await page.evaluate(
				() =>
					new Promise((res) => {
						const m = (
							window as unknown as { __thothMap?: Record<string, never> }
						).__thothMap as unknown as MLMap;
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

		async function pointOn(layer: string, overlap = false): Promise<ScreenPt> {
			const scr = await page.evaluate(
				({ layer, overlap }) => {
					const mm = (
						window as unknown as { __thothMap?: Record<string, never> }
					).__thothMap as unknown as MLMap;
					const rr = mm.getContainer().getBoundingClientRect();
					const feats = mm
						.queryRenderedFeatures({ layers: [layer] })
						.filter((f) => f.geometry?.type === "Point");
					const pts = feats.map((f) => {
						const s = mm.project(f.geometry.coordinates);
						return {
							x: s.x + rr.left,
							y: s.y + rr.top,
							title: String(f.properties.title ?? ""),
						};
					});
					if (!overlap) return pts[0] ?? null;
					for (let i = 0; i < pts.length; i++)
						for (let j = i + 1; j < pts.length; j++) {
							const dx = pts[i].x - pts[j].x;
							const dy = pts[i].y - pts[j].y;
							if (dx * dx + dy * dy < 49) return pts[i];
						}
					return null;
				},
				{ layer, overlap },
			);
			if (!scr)
				throw new Error(
					`no ${overlap ? "stacked " : ""}point rendered for ${layer}`,
				);
			return scr;
		}

		/** Titles of every rendered feature at a viewport pixel (one layer ok). */
		async function titlesAt(x: number, y: number, layers?: string[]) {
			return page.evaluate(
				({ x, y, layers }) => {
					const mm = (
						window as unknown as { __thothMap?: Record<string, never> }
					).__thothMap as unknown as MLMap;
					const r = mm.getContainer().getBoundingClientRect();
					return mm
						.queryRenderedFeatures(
							[x - r.left, y - r.top],
							layers ? { layers } : {},
						)
						.map((f) => String(f.properties.title ?? f.properties.id ?? ""))
						.filter(Boolean);
				},
				{ x, y, layers },
			);
		}

		const pointCards = () =>
			page.locator(".maplibregl-popup-content .hov", {
				hasText: "Click to pin preview",
			});
		// Click pins the rich preview (hover stays hover): actions live inside.
		const pinnedCards = () =>
			page.locator(".maplibregl-popup-content .hov", {
				has: page.locator(".hov-act"),
			});
		async function dismissPin() {
			await page
				.locator(".maplibregl-popup .maplibregl-popup-close-button")
				.click();
		}
		const clusterCards = () =>
			page.locator(".maplibregl-popup-content .hov", {
				hasText: "click to zoom",
			});

		test("hover card is verbose", async () => {
			await jumpTo([10, 50], 4);
			let at: ScreenPt | null = null;
			for (let i = 0; i < 4 && !at; i++) {
				const p = await pointOn("bases");
				// Jiggle first: a move to identical coords fires no mouseover.
				await page.mouse.move(p.x + 40, p.y + 40);
				await page.mouse.move(p.x, p.y, { steps: 3 });
				try {
					await expect(pointCards().first()).toBeVisible({ timeout: 2500 });
					at = p;
				} catch {
					/* tiles churned under us; fresh coords next round */
				}
			}
			expect(at, "hover card converges").toBeTruthy();
			await expect(pointCards().first()).toContainText("ago");
			// Rich preview: structured card + lazy satellite thumbnail.
			await expect(
				page.locator(".maplibregl-popup-content .hov-grid").first(),
			).toBeVisible({ timeout: 5000 });
			await expect(
				page
					.locator(
						".maplibregl-popup-content .hov-shot img.on, .maplibregl-popup-content .hov-shot.empty",
					)
					.first(),
			).toBeVisible({ timeout: 25000 });
			// Exactly one hover card: overlapping layers must not stack two.
			await expect(page.locator("#map .maplibregl-popup")).toHaveCount(1);
			// Every open card must name a feature actually under the cursor.
			const shown = await page
				.locator(".maplibregl-popup-content .hov-t")
				.allTextContents();
			const candidates = await titlesAt(at.x, at.y);
			expect(shown.some((t) => candidates.includes(t.trim()))).toBe(true);
			await page.screenshot({ path: "e2e/shots/desk-hover.png" });
		});

		/** Click a map point until the preview pins — directly, or via the
		 * picker when the pixel is stacked (first row, like a user).
		 * Falls across layers: a fully-clustered layer has no free points. */
		async function pinPoint(...layers: string[]): Promise<void> {
			let lastErr: unknown = null;
			for (const layer of layers) {
				for (let i = 0; i < 4; i++) {
					let p: ScreenPt;
					try {
						p = await pointOn(layer);
					} catch (e) {
						lastErr = e;
						break;
					}
					await page.mouse.click(p.x, p.y);
					await page.waitForTimeout(1200);
					if (
						await page.locator(".maplibregl-popup-content .pick").isVisible()
					) {
						await page
							.locator(".maplibregl-popup-content .pick-row")
							.first()
							.click();
					}
					try {
						await expect(pinnedCards().first()).toBeVisible({
							timeout: 3000,
						});
						return;
					} catch {
						/* missed (tile churn / cluster zoomed); retry fresh */
					}
				}
			}
			throw new Error(`pin never converged (${String(lastErr)})`);
		}

		test("click pins preview, inspector sinks the selection", async () => {
			await jumpTo([10, 50], 4);
			await pinPoint("airports", "bases");
			// The pin carries the rich card + actions, and opens nothing else.
			await expect(pinnedCards().first()).toContainText("AGE");
			await expect(pinnedCards().first()).toContainText("SRC");
			await expect(
				pinnedCards().first().locator('button[data-act^="full:"]'),
			).toBeVisible();
			await expect(page.locator("#fullview")).toBeHidden();
			// No double hover: the pin stands alone, hover stood down.
			await expect(page.locator("#map .maplibregl-popup")).toHaveCount(1);
			// The inspector is only the data sink now (desk always shows it).
			await expect(page.locator("#insp-body")).toContainText("Object");
			await page.screenshot({ path: "e2e/shots/desk-object.png" });
			// Dismiss the pin: later tests share this page and click the map.
			await dismissPin();
		});

		test("Full view button opens the complete preview, close dismisses it", async () => {
			await jumpTo([10, 50], 4);
			await pinPoint("airports", "bases");
			await pinnedCards().first().locator('button[data-act^="full:"]').click();
			const fv = page.locator("#fullview");
			await expect(fv).toBeVisible({ timeout: 10000 });
			await expect(fv).toContainText("Full view");
			await expect(fv).toContainText("AGE");
			// Veil-less: the map stays interactive underneath the card.
			await expect(page.locator("#map canvas")).toBeVisible();
			await fv.locator(".fv-close").click();
			await expect(fv).toBeHidden({ timeout: 5000 });
			// Inspector keeps the selection after dismiss.
			await expect(page.locator("#insp-body")).toContainText("Object");
		});

		test("stacked points open the picker, every dot reachable", async () => {
			// London at z7 packs unclustered symbols tightly: find a pixel where
			// ≥2 of our features truly overlap (the exact picker condition —
			// same-layer or cross-layer, clusters excluded like the app does).
			await jumpTo([-0.1, 51.5], 7);
			async function stackPixel(): Promise<ScreenPt | null> {
				return page.evaluate(
					({ names }) => {
						const mm = (
							window as unknown as { __thothMap?: Record<string, never> }
						).__thothMap as unknown as MLMap;
						const rr = mm.getContainer().getBoundingClientRect();
						// Mirror the app's pickBase(): only OUR data layers count —
						// basemap fills (landuse_*, water, …) are not a stack.
						const ours = (id: string) =>
							names.includes(id) ||
							(id.endsWith("-o") && names.includes(id.slice(0, -2)));
						for (const l of ["datacenters", "airports", "cctv", "bases"]) {
							const feats = mm
								.queryRenderedFeatures({ layers: [l] })
								.filter((f) => f.geometry?.type === "Point")
								.slice(0, 80);
							for (const f of feats) {
								const s = mm.project(f.geometry.coordinates);
								const hit = mm
									.queryRenderedFeatures([s.x, s.y], {})
									.filter((h) =>
										ours((h as { layer?: { id?: string } }).layer?.id ?? ""),
									);
								if (hit.length >= 2)
									return {
										x: s.x + rr.left,
										y: s.y + rr.top,
										title: String(hit[0].properties.title ?? ""),
									};
							}
						}
						return null;
					},
					{ names: LAYER_NAMES },
				);
			}
			let sawPicker = false;
			for (let i = 0; i < 5 && !sawPicker; i++) {
				const p = await stackPixel();
				if (!p) {
					await page.waitForTimeout(2000);
					continue;
				}
				await page.mouse.click(p.x, p.y);
				await page.waitForTimeout(1200);
				if (await page.locator(".maplibregl-popup-content .pick").isVisible())
					sawPicker = true;
			}
			expect(sawPicker, "picker opens on a real stack").toBe(true);
			await expect(
				page.locator(".maplibregl-popup-content .pick"),
			).toContainText("stacked — pick one");
			await page.screenshot({ path: "e2e/shots/desk-picker.png" });
			const first = await page
				.locator(".maplibregl-popup-content .pick-row b")
				.first()
				.textContent();
			await page.locator(".maplibregl-popup-content .pick-row").first().click();
			await expect(page.locator("#insp-body")).toContainText(
				(first ?? "").slice(0, 24),
				{ timeout: 10000 },
			);
			// Pick-row pins the preview (full view stays shut) — dismiss it.
			await expect(pinnedCards().first()).toBeVisible({ timeout: 5000 });
			await expect(page.locator("#fullview")).toBeHidden();
			await dismissPin();
		});

		test("cluster hover summarizes, click zooms in", async () => {
			await jumpTo([20, 30], 1.6);
			const cands = await page.evaluate(() => {
				const m = (window as unknown as { __thothMap?: Record<string, never> })
					.__thothMap as unknown as MLMap;
				const found: { n: number; c: number[] }[] = [];
				for (const l of ["datacenters-c", "cctv-c", "flights-c", "news-c"]) {
					for (const x of m.queryRenderedFeatures({ layers: [l] })) {
						const n = Number(x.properties.point_count ?? 0);
						if (x.geometry?.type === "Point" && n > 5)
							found.push({ n, c: x.geometry.coordinates });
					}
				}
				found.sort((a, b) => b.n - a.n);
				const r = m.getContainer().getBoundingClientRect();
				return found.slice(0, 4).map((b) => {
					const s = m.project(b.c);
					return { x: s.x + r.left, y: s.y + r.top, z: m.getZoom(), n: b.n };
				});
			});
			if (!cands.length) throw new Error("no cluster renders");
			let c = cands[0];
			let ok = false;
			for (const cand of cands) {
				if (ok) break;
				c = cand;
				for (let i = 0; i < 2 && !ok; i++) {
					await page.mouse.move(c.x + 40, c.y + 40);
					await page.mouse.move(c.x, c.y, { steps: 3 });
					try {
						await expect(clusterCards().first()).toContainText("points", {
							timeout: 2500,
						});
						ok = true;
					} catch {
						/* stacked pixel or churn; next candidate */
					}
				}
			}
			expect(ok, "cluster card converges").toBe(true);
			await page.mouse.click(c.x, c.y);
			await expect
				.poll(
					async () =>
						await page.evaluate(
							() =>
								(
									window as unknown as {
										__thothMap?: { getZoom: () => number };
									}
								).__thothMap?.getZoom() ?? 0,
						),
					{ timeout: 25000 },
				)
				.toBeGreaterThan(c.z);
		});

		test("polygon hover + select (airwx SIGMET)", async () => {
			// Fly to a live SIGMET (coordinates from the API itself), then
			// exercise hover + select on its rendered fill.
			const target = await page.evaluate(async () => {
				const j = (await fetch("/api/layers/airwx").then((r) => r.json())) as {
					items: { geom?: { type?: string; coordinates?: unknown } }[];
				};
				for (const it of j.items ?? []) {
					const g = it.geom;
					if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon"))
						continue;
					const coords = g.coordinates as number[][][] | number[][][][];
					const ring = (
						g.type === "Polygon"
							? (coords as number[][][])[0]
							: (coords as number[][][][])[0][0]
					) as number[][];
					if (ring?.length > 3) {
						const mid = ring[Math.floor(ring.length / 2)];
						if (Array.isArray(mid) && Number.isFinite(mid[0]))
							return { lon: mid[0], lat: mid[1] };
					}
				}
				return null;
			});
			test.skip(!target, "no airwx polygon in the live feed");
			await jumpTo([target.lon, target.lat], 4);
			const p = await page.evaluate(() => {
				const m = (window as unknown as { __thothMap?: Record<string, never> })
					.__thothMap as unknown as MLMap & {
					queryRenderedFeatures: (
						o: unknown,
					) => { geometry: { type: string; coordinates: number[][][] } }[];
				};
				const W = window.innerWidth;
				const H = window.innerHeight;
				const r = m.getContainer().getBoundingClientRect();
				// Prefer screen center: a SIGMET covering it is the common case.
				const cx = r.left + r.width / 2;
				const cy = r.top + r.height / 2;
				const atCenter = m.queryRenderedFeatures([cx - r.left, cy - r.top], {
					layers: ["airwx"],
				});
				if (atCenter.length > 0) return { x: cx, y: cy };
				for (const f of m.queryRenderedFeatures({ layers: ["airwx"] })) {
					const ring = f.geometry?.coordinates?.[0] ?? [];
					for (let i = 0; i < ring.length; i += 3) {
						const s = m.project(ring[i]);
						const vx = s.x + r.left;
						const vy = s.y + r.top;
						if (vx > 250 && vx < W - 350 && vy > 60 && vy < H - 160)
							return { x: vx, y: vy };
					}
				}
				return null;
			});
			test.skip(!p, "no airwx polygon vertex on screen");
			let ok = false;
			for (let i = 0; i < 3 && !ok; i++) {
				await page.mouse.move(p.x + 40, p.y + 40);
				await page.mouse.move(p.x, p.y, { steps: 3 });
				try {
					await expect(pointCards().first()).toBeVisible({ timeout: 2500 });
					ok = true;
				} catch {
					/* retry */
				}
			}
			expect(ok, "polygon hover converges").toBe(true);
			// The airwx card must be among the open cards.
			const shown = await page
				.locator(".maplibregl-popup-content .hov-t")
				.allTextContents();
			const airwxTitles = await titlesAt(p.x, p.y, ["airwx"]);
			expect(shown.some((t) => airwxTitles.includes(t.trim()))).toBe(true);
			await page.mouse.click(p.x, p.y);
			await page.waitForTimeout(1200);
			// A point stacked over the fill routes through the picker instead.
			if (await page.locator(".maplibregl-popup-content .pick").isVisible()) {
				await page
					.locator(".maplibregl-popup-content .pick-row")
					.first()
					.click();
			}
			await expect(page.locator("#insp-body")).toContainText("Object", {
				timeout: 10000,
			});
			// Polygon click pins the preview — dismiss for later tests.
			await expect(page.locator("#fullview")).toBeHidden();
			await dismissPin();
		});

		test("layer toggle + sev chips + mission presets", async () => {
			const news = page.locator(".lrow", { hasText: "news" }).first();
			await news.click();
			await expect(news).toHaveClass(/off/);
			await news.click();
			await expect(news).not.toHaveClass(/off/);
			await page.locator("#sev-chips button", { hasText: "WATCH" }).click();
			await expect(
				page.locator("#sev-chips button", { hasText: "WATCH" }),
			).toHaveClass(/on/);
			await page.locator("#explorer .mission select").selectOption("crisis");
			await expect(
				page.locator(".lrow", { hasText: "markets" }).first(),
			).toHaveClass(/off/, { timeout: 10000 });
			await page.locator("#explorer .mission select").selectOption("");
			// Reset the sev filter: later map tests need the full point set.
			await page.locator("#sev-chips button", { hasText: "ALL" }).click();
		});

		test("theater fly-to updates share hash", async () => {
			await page
				.locator("#explorer .theater select")
				.selectOption({ index: 1 });
			await expect
				.poll(async () => page.evaluate(() => window.location.hash), {
					timeout: 30000,
				})
				.toContain("c=");
		});

		test("all eight tabs open with content", async () => {
			const wants: [string, string][] = [
				["area", "right-click the map"],
				["sdn", "Go"],
				["alerts", "Alerts"],
				["news", "News wire"],
				["markets", "Markets"],
				["cyber", "Known exploited"],
				["video", "Live video"],
				["object", "click a dot"],
			];
			for (const [t, txt] of wants) {
				await page.locator(`#tabs button[data-tab="${t}"]`).click();
				if (t === "object") {
					// Shared page: earlier tests may leave a selection behind —
					// both the empty hint and a selected object are correct.
					await expect
						.poll(async () => await page.locator("#insp-body").textContent(), {
							timeout: 15000,
						})
						.toMatch(/Object|click a dot/);
				} else {
					await expect(page.locator("#insp-body")).toContainText(txt, {
						timeout: 15000,
					});
				}
			}
			await page.locator('#tabs button[data-tab="video"]').click();
			await expect(
				page.locator('#insp-body iframe[src*="youtube"]'),
			).toBeAttached({ timeout: 15000 });
			await page.screenshot({ path: "e2e/shots/desk-video.png" });
		});

		test("timeline filter + clear", async () => {
			await page.locator(".tl-layer").selectOption("fires");
			await expect(page.locator("#tl-info")).toContainText("fires", {
				timeout: 15000,
			});
			const box = await page.locator("#tl-canvas").boundingBox();
			if (!box) throw new Error("timeline canvas has no box");
			await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
			await expect(page.locator("#tl-info")).toContainText("since", {
				timeout: 10000,
			});
			await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
			await expect(page.locator("#tl-info")).not.toContainText("since", {
				timeout: 10000,
			});
		});

		test("graph overlay opens with selection context", async () => {
			await jumpTo([10, 50], 4);
			await pinPoint("ports", "airports", "bases");
			await dismissPin();
			await page.locator('button[title*="entity graph"]').click();
			await expect(page.locator(".entitygraph")).toBeVisible({
				timeout: 10000,
			});
			await page.screenshot({ path: "e2e/shots/desk-graph.png" });
			await page.locator('button[title*="entity graph"]').click();
			await expect(page.locator(".entitygraph")).toBeHidden();
		});

		test("minimap click flies the main map", async () => {
			await jumpTo([20, 30], 1.6);
			const before = await page.evaluate(() =>
				(
					window as unknown as {
						__thothMap?: { getCenter: () => { lng: number; lat: number } };
					}
				).__thothMap?.getCenter(),
			);
			const box = await page.locator(".minimap canvas").boundingBox();
			if (!box) throw new Error("minimap has no box");
			await page.mouse.click(
				box.x + box.width * 0.75,
				box.y + box.height * 0.3,
			);
			await page.waitForTimeout(2500);
			const after = await page.evaluate(() =>
				(
					window as unknown as {
						__thothMap?: { getCenter: () => { lng: number; lat: number } };
					}
				).__thothMap?.getCenter(),
			);
			expect(
				Math.abs((after?.lng ?? 0) - (before?.lng ?? 0)) +
					Math.abs((after?.lat ?? 0) - (before?.lat ?? 0)),
			).toBeGreaterThan(1);
		});

		test("status strip: SSE state, monitor rows, cadence hints", async () => {
			await expect(page.locator("#health-pill")).toHaveAttribute(
				"title",
				/server monitor · SSE (connected|RECONNECTING)/,
				{ timeout: 20000 },
			);
			await expect(page.locator("#health-pill")).toContainText("ENT");
			await expect(page.locator("#health-pill")).toContainText(/Kp/);
			// Feed health moved to the MONITOR tab 2026-09-18 (tabular,
			// grouped by collector): pill opens it, rows carry poll tips.
			await page.locator("#health-pill").click();
			await expect(page.locator("#insp-body")).toContainText("MONITOR ·", {
				timeout: 15000,
			});
			const feedTips = await page
				.locator('#insp-body .mon-row[title*="polled"]')
				.count();
			expect(feedTips).toBeGreaterThan(5);
			const rowTips = await page
				.locator('.lrow[title*="refresh every"]')
				.count();
			expect(rowTips).toBeGreaterThan(20);
		});

		test("cmdbar depth commands", async () => {
			await page.fill("#cmd", "mitre phishing");
			await page.keyboard.press("Enter");
			await expect(page.locator("#insp-body")).toContainText("MITRE", {
				timeout: 20000,
			});
			await page.fill("#cmd", "trend quakes 7");
			await page.keyboard.press("Enter");
			await expect(page.locator("#insp-body")).toContainText("daily counts", {
				timeout: 20000,
			});
			await page.fill("#cmd", "sitrep show");
			await page.keyboard.press("Enter");
			await expect(page.locator("#insp-body")).toContainText("SITREP", {
				timeout: 20000,
			});
		});

		test("desk full view", async () => {
			await jumpTo([20, 30], 1.6);
			await page.screenshot({ path: "e2e/shots/desk-full.png" });
		});
	});

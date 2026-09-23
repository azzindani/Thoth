// Viewport-aware layer slices (ROADMAP P2): the world view carries a
// region-sampled slice; zooming in re-slices big layers for the view, so
// the 5,280-airport catalog is fully reachable where you look.
import { expect, type Page, test } from "./fixtures";

type MLMap = {
	getSource: (
		id: string,
	) => { getData: () => Promise<{ features: unknown[] }> } | undefined;
	jumpTo: (o: { center: [number, number]; zoom: number }) => void;
};

const count = (page: Page, layer: string) =>
	page.evaluate(async (layer) => {
		const m = (window as unknown as { __thothMap?: MLMap }).__thothMap;
		const src = m?.getSource(layer);
		if (!src) return -1;
		return (await src.getData()).features.length;
	}, layer);

test("zooming in fills a truncated layer for the view", async ({ page }) => {
	test.setTimeout(180000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
	// World: a sampled slice, capped well under the catalog size.
	await expect
		.poll(() => count(page, "airports"), { timeout: 120000 })
		.toBe(1000);

	const sliced = page.waitForResponse(
		(r) => /\/api\/layers\/airports\?.*bbox=/.test(r.url()) && r.ok(),
		{ timeout: 30000 },
	);
	await page.evaluate(() =>
		(window as unknown as { __thothMap: MLMap }).__thothMap.jumpTo({
			center: [10, 48],
			zoom: 6,
		}),
	);
	const res = await sliced;
	const j = (await res.json()) as { total: number; truncated: boolean };
	expect(j.truncated).toBe(false);
	expect(j.total).toBeGreaterThan(0);
	await expect.poll(() => count(page, "airports")).toBe(j.total);
});

// Thoth alive e2e — every breakpoint boots with zero page errors,
// zero failed API responses, and no horizontal overflow.
// Needs backend on :4000 (REQUESTS_PER_MIN=2000) + app on :3000.
import { expect, test } from "playwright/test";

const BPS = [
	{ name: "desk", w: 1600, h: 900 },
	{ name: "tab", w: 900, h: 900 },
	{ name: "phone", w: 390, h: 844 },
];

for (const bp of BPS) {
	test(`alive@${bp.name}: boots clean, fits viewport`, async ({ page }) => {
		await page.setViewportSize({ width: bp.w, height: bp.h });
		const bad: string[] = [];
		page.on("pageerror", (e) => bad.push(`PAGE: ${e.message.slice(0, 120)}`));
		page.on("response", (r) => {
			if (r.url().includes("/api/") && r.status() >= 400)
				bad.push(`${r.status()} ${r.url().slice(-80)}`);
		});
		await page.goto("/");
		await expect(page.locator("#tape-txt")).toContainText("NEWS", {
			timeout: 30000,
		});
		await expect(page.locator("#layer-rows")).toContainText("airwx", {
			timeout: 30000,
		});
		await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
		await expect(page.locator("#health-pill")).toContainText("LIVE", {
			timeout: 30000,
		});
		await page.waitForTimeout(8000);
		const overflow = await page.evaluate(() => ({
			body: document.body.scrollWidth,
			inner: window.innerWidth,
			ticker: document.querySelector("#ticker")?.scrollWidth ?? 0,
		}));
		expect(overflow.body, `body overflow @${bp.name}`).toBeLessThanOrEqual(
			overflow.inner,
		);
		expect(overflow.ticker, `ticker overflow @${bp.name}`).toBeLessThanOrEqual(
			overflow.inner,
		);
		expect(bad, `errors @${bp.name}`).toEqual([]);
	});
}

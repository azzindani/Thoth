// Thoth alive e2e — every breakpoint boots with zero page errors,
// zero failed API responses, and no horizontal overflow.
// Needs backend on :4000 (REQUESTS_PER_MIN=2000) + app on :3000.
import { expect, test } from "./fixtures";

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
		// Anything the Content-Security-Policy blocks (lib/csp.ts) is a bug:
		// either the allowlist missed an origin or code went inline.
		await page.addInitScript(() => {
			const w = window as unknown as { __csp: string[] };
			w.__csp = [];
			document.addEventListener("securitypolicyviolation", (e) =>
				w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
			);
		});
		const res = await page.goto("/");
		expect(res?.headers()["content-security-policy"]).toContain(
			"'strict-dynamic'",
		);
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
		expect(
			await page.evaluate(
				() => (window as unknown as { __csp: string[] }).__csp,
			),
			`CSP violations @${bp.name}`,
		).toEqual([]);
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

test("paper theme: switches live, remounts the map, survives a reload", async ({
	page,
}) => {
	const bad: string[] = [];
	page.on("pageerror", (e) => bad.push(e.message.slice(0, 120)));
	await page.goto("/");
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
	await page.waitForFunction(() => !!document.body.dataset.bp);
	await page.keyboard.press(",");
	await page.getByRole("button", { name: "Paper" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
	const bg = await page.evaluate(() =>
		getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
	);
	expect(bg).toBe("#f3efe6");
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
	await page.reload();
	// applied before paint by the early script in layout.tsx
	await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
	expect(bad).toEqual([]);
});

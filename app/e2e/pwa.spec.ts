// Installable app: manifest, icons and the service worker are served
// (outside the access gate) and the worker registers.
import { expect, test } from "./fixtures";

test("manifest, icons and service worker", async ({ page, request }) => {
	const m = await request.get("/manifest.webmanifest");
	expect(m.status()).toBe(200);
	const manifest = await m.json();
	expect(manifest.display).toBe("standalone");
	for (const icon of manifest.icons as { src: string }[])
		expect((await request.get(icon.src)).status(), icon.src).toBe(200);
	const sw = await request.get("/sw.js");
	expect(sw.status()).toBe(200);
	expect(sw.headers()["cache-control"]).toContain("no-cache");

	await page.goto("/");
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
		"href",
		/manifest\.webmanifest/,
	);
	const scope = await page.evaluate(async () => {
		const reg = await navigator.serviceWorker.ready;
		return reg.scope;
	});
	expect(new URL(scope).pathname).toBe("/");
});

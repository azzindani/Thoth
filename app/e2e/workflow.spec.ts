// Analyst workflow (ROADMAP P5): "since you last looked" and area watches.
import { expect, test } from "./fixtures";

type WatchMap = {
	getSource: (
		id: string,
	) => { getData: () => Promise<{ features: unknown[] }> } | undefined;
};

test("since you last looked: a digest of what changed while away", async ({
	page,
}) => {
	test.setTimeout(120000);
	await page.addInitScript(() => {
		// Only the first load: the card is about the visit before this one.
		if (sessionStorage.getItem("seeded")) return;
		sessionStorage.setItem("seeded", "1");
		const hr = 3600e3;
		localStorage.setItem(
			"thoth.lastLooked",
			JSON.stringify({
				at: Date.now() - 3 * hr,
				items: [
					[
						"gone:warning",
						"watch",
						Date.now() - 2 * hr,
						"Cleared warning",
						"navwarn",
					],
				],
			}),
		);
	});
	await page.goto("/");
	const card = page.locator("#since");
	await expect(card).toBeVisible({ timeout: 30000 });
	await expect(card).toContainText("Since you last looked");
	await expect(card).toContainText("1 resolved");
	await expect(card.locator("tbody")).toContainText("Cleared warning");
	await card.getByRole("button", { name: "dismiss digest" }).click();
	await expect(card).toHaveCount(0);
	// The snapshot now reflects this visit: a reload shows no digest.
	await page.reload();
	await page.waitForTimeout(3000);
	await expect(page.locator("#since")).toHaveCount(0);
});

test("area watch: save the dossier circle and draw it on the map", async ({
	page,
}) => {
	test.setTimeout(120000);
	await page.goto("/");
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
	await page.locator('#tabs button[data-tab="area"]').click();
	const body = page.locator("#insp-body");
	await body.locator("input").nth(0).fill("38.4");
	await body.locator("input").nth(1).fill("142.4");
	await body.locator("#ar-go").click();
	await expect(body).toContainText("AREA · 38.4,142.4", { timeout: 20000 });
	await body.locator(".watch-area input").fill("e2e area watch");
	await body.locator("#watch-area").click();
	await expect(body.locator("#watch-area")).toHaveText("WATCHING");
	try {
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const m = (window as unknown as { __thothMap: WatchMap }).__thothMap;
					const src = m.getSource("watch-areas");
					return src ? (await src.getData()).features.length : 0;
				}),
			)
			.toBeGreaterThan(0);
		// Live events inside the circle match (the fixture quakes sit there).
		const m = await page.evaluate(() =>
			fetch("/api/watch/matches?limit=200").then((r) => r.json()),
		);
		expect(
			(m.items as { layer: string }[]).some((i) => i.layer === "quakes"),
		).toBe(true);
	} finally {
		await page.evaluate(() =>
			fetch(`/api/watch/${encodeURIComponent("w:area:e2e area watch")}`, {
				method: "DELETE",
			}),
		);
	}
});

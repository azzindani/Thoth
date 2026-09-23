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

test("country page from the command line", async ({ page }) => {
	test.setTimeout(120000);
	await page.goto("/");
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
	await page.locator("#cmd").fill("country Japan");
	await page.locator("#cmd").press("Enter");
	await expect(page.locator("#country-name")).toHaveText("Japan", {
		timeout: 20000,
	});
	const body = page.locator("#insp-body");
	await expect(body.locator("table").first()).toContainText("quakes");
	await expect(body.locator(".country-row").first()).toBeVisible();
});

test("workspaces: save a view, change it, reopen it; open a shared link", async ({
	page,
}) => {
	test.setTimeout(150000);
	await page.goto("/");
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
	const quakes = page.locator(".lrow", { hasText: "quakes" }).first();
	await expect(quakes).not.toHaveClass(/off/);
	// Save through the palette (the name comes from a prompt).
	page.once("dialog", (d) => d.accept("e2e desk"));
	await page.locator("body").click({ position: { x: 5, y: 5 } });
	await page.keyboard.press("Control+k");
	await page.keyboard.type("save this view");
	await page.keyboard.press("Enter");
	await expect(
		page.locator(".toast", { hasText: "Workspace saved" }),
	).toBeVisible();
	// Change the view, then reopen the workspace.
	await quakes.click();
	await expect(quakes).toHaveClass(/off/);
	await page.keyboard.press("Control+k");
	await page.keyboard.type("open e2e desk");
	await page.keyboard.press("Enter");
	await expect(quakes).not.toHaveClass(/off/);

	// A shared link carries the whole view in the URL.
	const ws = {
		v: 1,
		name: "shared",
		hidden: ["quakes"],
		camera: { c: [21.5, 57.2], z: 4 },
		mission: "",
		sev: "",
		mode: "default",
		globe: true,
		tab: "incidents",
		panels: { expl: false, insp: false, dock: false },
	};
	const token = Buffer.from(JSON.stringify(ws))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	await page.goto(`/#ws=${token}`);
	await page.reload();
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
	await expect(page.locator('#tabs button[data-tab="incidents"]')).toHaveClass(
		/on/,
		{ timeout: 20000 },
	);
	await expect(
		page.locator(".lrow", { hasText: "quakes" }).first(),
	).toHaveClass(/off/);
});

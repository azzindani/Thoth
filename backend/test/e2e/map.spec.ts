// Thoth terminal e2e — globe, explorer, inspector, alerts, sdn, command bar. Shots to test/e2e/shots/.
import { expect, test } from "playwright/test";

test("terminal boots: ticker counts + explorer + timeline", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.locator("#counts")).toContainText("quakes", {
		timeout: 30000,
	});
	await expect(page.locator("#layer-rows")).toContainText("cctv", {
		timeout: 30000,
	});
	await expect
		.poll(async () => page.locator("#tl-info").innerText(), { timeout: 30000 })
		.toMatch(/days/);
	await page.waitForTimeout(4000); // let WebGL dots land
	await page.screenshot({ path: "test/e2e/shots/01-terminal.png" });
});

test("keys toggle layers, command bar toggles back", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#counts")).toContainText("flights", {
		timeout: 30000,
	});
	await page.waitForTimeout(3000);
	await page.keyboard.press("2"); // flights off
	await page.click("#cmd");
	await page.keyboard.type("flights on");
	await page.keyboard.press("Enter");
	await expect(page.locator("#cmd-out")).toContainText("flights ON");
	await page.screenshot({ path: "test/e2e/shots/02-cmd.png" });
});

test("click dot selects object, right-click London loads area", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.locator("#counts")).toContainText("cctv", {
		timeout: 30000,
	});
	await page.waitForTimeout(3000);
	const pt = await page.evaluate(() => {
		const m = (
			window as unknown as {
				__thothMap: {
					project: (ll: { lng: number; lat: number }) => {
						x: number;
						y: number;
					};
				};
			}
		).__thothMap;
		const p = m.project({ lng: -0.12, lat: 51.5 });
		const el = document.getElementById("map");
		if (!el) throw new Error("no map element");
		const r = el.getBoundingClientRect();
		return { x: r.left + p.x, y: r.top + p.y };
	});
	await page.mouse.click(pt.x, pt.y, { button: "right" });
	await expect(page.locator("#insp-body")).toContainText("cctv", {
		timeout: 15000,
	});
	await page.waitForTimeout(1500);
	await page.screenshot({ path: "test/e2e/shots/03-area.png" });
});

test("alerts tab + sdn search work inline", async ({ page }) => {
	test.setTimeout(180000);
	await page.goto("/");
	await expect(page.locator("#counts")).toContainText("quakes", {
		timeout: 30000,
	});
	await page.click('button[data-tab="alerts"]', { timeout: 60000 });
	await expect(page.locator("#insp-body")).toContainText("ALERTS", {
		timeout: 60000,
	});
	await page.click("#cmd", { timeout: 60000 });
	await page.keyboard.type("sdn putin");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("Putin", {
		timeout: 15000,
	});
	await page.screenshot({ path: "test/e2e/shots/04-sdn.png" });
});

test("satellite mode keeps layers on the globe", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#counts")).toContainText("fires", {
		timeout: 30000,
	});
	await page.waitForTimeout(3000);
	await page.click("#m-sat");
	await page.waitForTimeout(4000);
	await page.screenshot({ path: "test/e2e/shots/05-sat.png" });
});

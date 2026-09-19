// Thoth app smoke: boots, counts, tabs, OSINT command. Needs backend on :4000 + app on :3000.
import { expect, test } from "playwright/test";

test("terminal boots with counts + globe", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#tape-txt")).toContainText("NEWS", {
		timeout: 30000,
	});
	await expect(page.locator("#layer-rows")).toContainText("quakes", {
		timeout: 30000,
	});
	await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30000 });
});

test("tabs + osint command work", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#layer-rows")).toContainText("satellites", {
		timeout: 30000,
	});
	await page.click('button[data-tab="video"]');
	await expect(page.locator("#insp-body")).toContainText("Live video", {
		timeout: 15000,
	});
	await page.click('button[data-tab="cyber"]');
	await expect(page.locator("#insp-body")).toContainText("Known exploited", {
		timeout: 15000,
	});
	await page.click('button[data-tab="object"]');
	await page.fill("#cmd", "airport SIN");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("Changi", {
		timeout: 15000,
	});
	await page.fill("#cmd", "changelog");
	await page.keyboard.press("Enter");
	await expect(page.locator(".modal")).toContainText("Phase 4", {
		timeout: 15000,
	});
});

test("ops route shows feeds + versions", async ({ page }) => {
	await page.goto("/ops");
	await expect(page.locator("body")).toContainText("FEEDS", {
		timeout: 30000,
	});
	await expect(page.locator("body")).toContainText("quakes", {
		timeout: 30000,
	});
});

test("new widgets render: threatclock + minimap + graph", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator(".threatclock")).toBeVisible({ timeout: 30000 });
	await expect(page.locator(".minimap")).toBeVisible({ timeout: 30000 });
	await page.keyboard.press("e");
	await expect(page.locator(".entitygraph")).toBeVisible({ timeout: 15000 });
});

test("new osint + search + watch commands work", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#layer-rows")).toContainText("perims", {
		timeout: 30000,
	});
	await page.fill("#cmd", "cert example.com");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("example.com", {
		timeout: 20000,
	});
	await page.fill("#cmd", "asn AS15169");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("GOOGLE", {
		timeout: 20000,
	});
	await page.fill("#cmd", "company Siemens");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("LEI", {
		timeout: 20000,
	});
	await page.fill("#cmd", "macro DEU");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("GDP_USD", {
		timeout: 25000,
	});
	await page.fill("#cmd", "search earthquake");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("hits", {
		timeout: 20000,
	});
	await page.fill("#cmd", "watch add keyword e2e-graphite-xyz");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("WATCHES", {
		timeout: 20000,
	});
	await page.fill("#cmd", "watch del e2e-graphite-xyz");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("deleted", {
		timeout: 20000,
	});
	await page.fill("#cmd", "notify hello from smoke");
	await page.keyboard.press("Enter");
	await expect(page.locator("#cmd-out")).toContainText(
		/disabled|notified|not sent|failed|sending/,
		{ timeout: 20000 },
	);
});

test("cve + sitrep views work", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#layer-rows")).toContainText("airwx", {
		timeout: 30000,
	});
	await page.fill("#cmd", "cve CVE-2024-3094");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("CVE-2024-3094", {
		timeout: 25000,
	});
	await page.fill("#cmd", "epss CVE-2024-3094");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText(
		/EPSS|epss|exploit|unavailable/i,
		{
			timeout: 25000,
		},
	);
	await page.fill("#cmd", "ports 8.8.8.8");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText(
		/PORTS|ports|unavailable/i,
		{
			timeout: 25000,
		},
	);
	await page.fill("#cmd", "museum war");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText(
		/MUSEUM|museum|unavailable/i,
		{
			timeout: 25000,
		},
	);
	await page.fill("#cmd", "robtex 1.1.1.1");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText(
		/ROBTEX|robtex|unavailable/i,
		{
			timeout: 25000,
		},
	);
	await page.fill("#cmd", "sitrep save");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("THOTH SITREP", {
		timeout: 20000,
	});
});

test("trend chart renders", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#layer-rows")).toContainText("quakes", {
		timeout: 30000,
	});
	await page.fill("#cmd", "trend quakes 7");
	await page.keyboard.press("Enter");
	await expect(page.locator("#insp-body")).toContainText("since", {
		timeout: 20000,
	});
	await expect(page.locator("#insp-body svg rect").first()).toBeVisible({
		timeout: 20000,
	});
});

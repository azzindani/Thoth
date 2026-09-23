import { defineConfig } from "playwright/test";
export default defineConfig({
	testDir: "./e2e",
	timeout: 120000,
	// CI: one retry separates a flaky render from a real regression (the
	// retried test is reported as flaky, never silently green).
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: process.env.E2E_URL ?? "http://localhost:3000",
		trace: "retain-on-failure",
		// Optional preinstalled Chromium (sandboxes that cannot download one).
		launchOptions: process.env.PW_CHROMIUM_PATH
			? { executablePath: process.env.PW_CHROMIUM_PATH }
			: {},
	},
});

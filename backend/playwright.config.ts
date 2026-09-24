import { defineConfig } from "playwright/test";

export default defineConfig({
	testDir: "test/e2e",
	timeout: 60000,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL: process.env.E2E_URL ?? "http://localhost:4000",
		viewport: { width: 1600, height: 900 },
		trace: "on-first-retry",
		launchOptions: process.env.PW_CHROMIUM_PATH
			? { executablePath: process.env.PW_CHROMIUM_PATH }
			: {},
	},
});

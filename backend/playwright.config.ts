import { defineConfig } from "playwright/test";

export default defineConfig({
	testDir: "test/e2e",
	timeout: 60000,
	use: {
		baseURL: process.env.E2E_URL ?? "http://localhost:4000",
		viewport: { width: 1600, height: 900 },
	},
});

import { type BrowserContext, test as base } from "playwright/test";

// Shared e2e fixtures. With E2E_STUB_BASEMAP=1 the CARTO basemap style is
// served locally as a blank dark style, so map specs exercise *our* layers
// without depending on a third-party CDN (CI, sandboxes, offline runs).
// Every page is covered — including ones specs open via browser.newPage()
// in beforeAll, which bypass the page/context fixtures.

const STUB = process.env.E2E_STUB_BASEMAP === "1";
const BASEMAP = "https://basemaps.cartocdn.com/**";
const BLANK_STYLE = {
	version: 8,
	glyphs: "https://basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
	sources: {},
	layers: [
		{ id: "bg", type: "background", paint: { "background-color": "#0b0b0a" } },
	],
};

async function stubBasemap(ctx: BrowserContext) {
	await ctx.route(BASEMAP, (route) =>
		route.request().url().endsWith("style.json")
			? route.fulfill({
					contentType: "application/json",
					body: JSON.stringify(BLANK_STYLE),
				})
			: // glyphs/sprites: absent is fine, labels just don't draw
				route.fulfill({ status: 404, body: "" }),
	);
}

export const test = base.extend<object, object>({
	browser: [
		async ({ browser }, use) => {
			if (STUB) {
				const newPage = browser.newPage.bind(browser);
				browser.newPage = async (opts) => {
					const page = await newPage(opts);
					await stubBasemap(page.context());
					return page;
				};
				const newContext = browser.newContext.bind(browser);
				browser.newContext = async (opts) => {
					const ctx = await newContext(opts);
					await stubBasemap(ctx);
					return ctx;
				};
			}
			await use(browser);
		},
		{ scope: "worker" },
	],
	context: async ({ context }, use) => {
		if (STUB) await stubBasemap(context);
		await use(context);
	},
});

export { expect, type Page } from "playwright/test";

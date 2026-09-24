// Collector contract tests, outbreaks: WHO Disease Outbreak News.
// Upstream stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as outbreaks from "../src/workers/collectors/outbreaks.js";
import {
	eventsOf,
	healthOf,
	json,
	resetTables,
	restoreFetch,
	stubFetch,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

const don = (id: string, title: string, at: string) => ({
	Title: title,
	UrlName: id,
	DonId: id,
	PublicationDateAndTime: at,
	Summary: `<p>Summary of ${id}&nbsp;report.</p>`,
});

describe("outbreaks parsing", () => {
	it("splits disease from the named places", () => {
		assert.deepEqual(outbreaks.splitDonTitle("Nipah virus disease - India"), {
			disease: "Nipah virus disease",
			places: ["India"],
		});
		assert.deepEqual(
			outbreaks.splitDonTitle(
				"Ebola disease caused by Bundibugyo virus, Democratic Republic of the Congo & Uganda",
			),
			{
				disease: "Ebola disease caused by Bundibugyo virus",
				places: ["Democratic Republic of the Congo", "Uganda"],
			},
		);
		assert.deepEqual(
			outbreaks.splitDonTitle("Marburg virus disease- Ethiopia").places,
			["Ethiopia"],
		);
		assert.deepEqual(
			outbreaks.splitDonTitle(
				"Ebola disease caused by Bundibugyo virus – Democratic Republic of the Congo",
			).places,
			["Democratic Republic of the Congo"],
		);
		assert.deepEqual(
			outbreaks.splitDonTitle("Crimean-Congo haemorrhagic fever - Iraq"),
			{ disease: "Crimean-Congo haemorrhagic fever", places: ["Iraq"] },
		);
		assert.deepEqual(
			outbreaks.splitDonTitle("Dengue - Trinidad and Tobago").places,
			["Trinidad and Tobago"],
		);
		assert.deepEqual(outbreaks.splitDonTitle("Cholera"), {
			disease: "Cholera",
			places: [],
		});
	});
	it("grades high-consequence pathogens critical", () => {
		assert.equal(
			outbreaks.donSeverity("Marburg virus disease - Rwanda"),
			"critical",
		);
		assert.equal(outbreaks.donSeverity("Cholera - Sudan"), "watch");
	});
});

describe("outbreaks", () => {
	it("stores reports placed at the first named country", async () => {
		const calls = stubFetch([
			[
				/who\.int\/api\/news\/diseaseoutbreaknews/,
				json({
					value: [
						don(
							"2026-DON617",
							"Ebola disease caused by Bundibugyo virus, Democratic Republic of the Congo & Uganda",
							"2026-09-10T08:16:08Z",
						),
						don(
							"2026-DON600",
							"Avian Influenza A(H5N5)- United States of America",
							"2026-05-01T12:00:00Z",
						),
						don(
							"2026-DON609",
							"Cholera - Kingdom of Saudi Arabia",
							"2026-06-25T18:00:00Z",
						),
						don(
							"2026-DON611",
							"Hantavirus outbreak linked to cruise ship travel, Multi-locations",
							"2026-07-02T18:00:00Z",
						),
					],
				}),
			],
		]);
		assert.deepEqual(await outbreaks.collect(), { ok: true, count: 4 });
		assert.match(calls[0], /\$orderby=PublicationDateAndTime%20desc/);
		const rows = await eventsOf("who-don");
		assert.deepEqual(
			rows.map((r) => [r.id, r.severity, r.lat, r.lon, r.meta.placedAt]),
			[
				[
					"who-don:2026-DON600",
					"critical",
					38.9,
					-77.04,
					"United States of America",
				],
				[
					"who-don:2026-DON609",
					"watch",
					24.71,
					46.68,
					"Kingdom of Saudi Arabia",
				],
				["who-don:2026-DON611", "watch", null, null, null],
				[
					"who-don:2026-DON617",
					"critical",
					-4.32,
					15.31,
					"Democratic Republic of the Congo",
				],
			],
		);
		assert.equal(
			rows[3].url,
			"https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON617",
		);
		assert.equal(rows[3].ts, "2026-09-10 08:16:08+00");
		assert.equal((await healthOf("who-don")).ok, true);
	});
	it("fails honestly on an empty or changed page", async () => {
		stubFetch([[/who\.int/, json({ value: [] })]]);
		assert.equal((await outbreaks.collect()).ok, false);
		assert.match((await healthOf("who-don")).error ?? "", /no reports parsed/);
		stubFetch([[/who\.int/, json({ error: "moved" })]]);
		assert.equal((await outbreaks.collect()).ok, false);
	});
});

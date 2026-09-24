// Collector contract tests, sslbl: abuse.ch SSLBL C2 certificate blacklist.
// Upstream stubbed at fetch. Run: npm run test:collectors (needs thoth_test DB)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as sslbl from "../src/workers/collectors/sslbl.js";
import {
	eventsOf,
	healthOf,
	resetTables,
	restoreFetch,
	stubFetch,
	text,
} from "./helpers/collector-stubs.js";

before(resetTables);
after(restoreFetch);

const SHA_A = "fd081cbaf79596b443b9d591f9dd1390268db7f0";
const SHA_B = "9780ED18B0A63E77E19611E7F46F640A64C1AD5E";
const SHA_OLD = "cadf6b3f7ceb64de2253e8c0734b867a2762987a";

// UTC stamps in the feed's "YYYY-MM-DD HH:MM:SS" form, relative to now.
const daysAgo = (d: number) =>
	new Date(Date.now() - d * 86400_000)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");

const csv = (rows: string[]) =>
	[
		"################################################################",
		"# abuse.ch SSLBL SSL Certificate Blacklist (SHA1 Fingerprints)  #",
		"################################################################",
		"#",
		"# Listingdate,SHA1,Listingreason",
		...rows,
	].join("\n");

describe("sslbl parsing", () => {
	it("keeps well-formed rows listed inside the week", () => {
		const rows = sslbl.sslblRows(
			csv([
				`${daysAgo(0.1)},${SHA_A},Vidar C&C`,
				`${daysAgo(2)},${SHA_B},AsyncRAT C&C`,
				`${daysAgo(9)},${SHA_OLD},QuasarRAT C&C`,
				`${daysAgo(1)},not-a-hash,Junk`,
			]),
		);
		assert.deepEqual(
			rows.map((r) => [r.sha1, r.reason]),
			[
				[SHA_A, "Vidar C&C"],
				[SHA_B.toLowerCase(), "AsyncRAT C&C"],
			],
		);
	});
});

describe("sslbl", () => {
	it("stores the week's certificates and prunes older listings", async () => {
		stubFetch([
			[
				/sslbl\.abuse\.ch/,
				text(
					csv([
						`${daysAgo(0.1)},${SHA_A},Vidar C&C`,
						`${daysAgo(2)},${SHA_OLD},QuasarRAT C&C`,
					]),
				),
			],
		]);
		assert.deepEqual(await sslbl.collect(), { ok: true, count: 2 });
		stubFetch([
			[/sslbl\.abuse\.ch/, text(csv([`${daysAgo(0.1)},${SHA_A},Vidar C&C`]))],
		]);
		assert.deepEqual(await sslbl.collect(), { ok: true, count: 1 });
		const rows = await eventsOf("sslbl");
		assert.deepEqual(
			rows.map((r) => [r.id, r.severity, r.title, r.lon]),
			[
				[
					`sslbl:${SHA_A}`,
					"watch",
					"Vidar C2 TLS certificate fd081cbaf79596b4…",
					null,
				],
			],
		);
		assert.equal(
			rows[0].url,
			`https://sslbl.abuse.ch/ssl-certificates/sha1/${SHA_A}/`,
		);
		assert.equal((await healthOf("sslbl")).ok, true);
	});
	it("a quiet week is healthy, a foreign payload is not", async () => {
		stubFetch([[/sslbl\.abuse\.ch/, text(csv([]))]]);
		assert.deepEqual(await sslbl.collect(), { ok: true, count: 0 });
		assert.equal((await eventsOf("sslbl")).length, 0);
		stubFetch([[/sslbl\.abuse\.ch/, text("<html>maintenance</html>")]]);
		assert.equal((await sslbl.collect()).ok, false);
		assert.match((await healthOf("sslbl")).error ?? "", /unexpected payload/);
	});
});

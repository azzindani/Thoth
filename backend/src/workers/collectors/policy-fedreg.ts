// US Federal Register (keyless, US-gov public domain) → `policy` layer.
// Presidential documents + security-term search, daily poll. ts =
// publication_date, so the digest freeze budget covers the cadence.
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

const BASE = "https://www.federalregister.gov/api/v1/documents.json";

const Doc = z
	.object({
		title: z.string().optional(),
		document_number: z.string().optional(),
		html_url: z.string().optional(),
		publication_date: z.string().optional(),
		type: z.string().optional(),
		abstract: z.string().nullable().optional(),
	})
	.passthrough();

const Resp = z.object({
	count: z.number().optional(),
	results: z.array(Doc).optional(),
});

async function pull(url: string, tag: string): Promise<number> {
	assertSafeUrl(url);
	const res = await stealthFetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} ${tag}`);
	const docs = Resp.parse(await res.json()).results ?? [];
	await storeRaw("fedreg", "policy", res.status, { tag, n: docs.length });
	let n = 0;
	for (const d of docs) {
		if (!d.document_number || !d.title) continue;
		const pub = Date.parse(d.publication_date ?? "");
		await storeNormalized({
			id: `fedreg:${d.document_number}`,
			ts: Number.isNaN(pub)
				? new Date().toISOString()
				: new Date(pub).toISOString(),
			source: "fedreg",
			layer: "policy",
			title: d.title.slice(0, 280),
			body: (d.abstract ?? "").slice(0, 300) || undefined,
			url: d.html_url,
			severity: "info",
			confidence: 0.9,
			entities: {},
			meta: { doc: d.document_number, kind: d.type, tag },
		});
		n++;
	}
	return n;
}

export async function collect() {
	let n = 0;
	const errors: string[] = [];

	try {
		n += await pull(
			`${BASE}?per_page=20&order=newest&format=json&conditions%5Btype%5D%5B%5D=PRESDOCU`,
			"presdocu",
		);
	} catch (e: unknown) {
		errors.push(`presdocu: ${errMsg(e)}`);
	}
	try {
		n += await pull(
			`${BASE}?per_page=20&order=newest&format=json&conditions%5Bterm%5D=${encodeURIComponent("sanctions export control defense")}`,
			"security",
		);
	} catch (e: unknown) {
		errors.push(`security: ${errMsg(e)}`);
	}

	// UK Parliament bills (keyless): newest-changed first page. No sort param
	// (SortOrder enum rejects free text — default order is update-desc).
	try {
		const url = "https://bills-api.parliament.uk/api/v1/Bills?PageSize=15";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status} ukbills`);
		const j = (await res.json()) as {
			items?: {
				billId?: number;
				shortTitle?: string;
				currentHouse?: string;
				lastUpdate?: string;
				isAct?: boolean;
				isDefeated?: boolean;
				currentStage?: { description?: string; house?: string };
			}[];
		};
		const items = j.items ?? [];
		await storeRaw("ukbills", "policy", res.status, { n: items.length });
		for (const b of items) {
			if (!b.billId || !b.shortTitle) continue;
			const ts = Date.parse(b.lastUpdate ?? "");
			await storeNormalized({
				id: `ukbill:${b.billId}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "ukbills",
				layer: "policy",
				title:
					`${b.shortTitle} — ${b.currentStage?.description ?? "?"} (${b.currentHouse ?? "?"})${b.isAct ? " [ACT]" : ""}`.slice(
						0,
						280,
					),
				url: `https://bills.parliament.uk/bills/${b.billId}`,
				severity: "info",
				confidence: 0.85,
				entities: {},
				meta: {
					house: b.currentHouse,
					stage: b.currentStage?.description,
					isAct: b.isAct,
				},
			});
			n++;
		}
		await markHealth("ukbills", true);
	} catch (e: unknown) {
		errors.push(`ukbills: ${errMsg(e)}`);
		await markHealth("ukbills", false, errors[errors.length - 1]);
	}

	// GovTrack recent bills (keyless): latest congressional actions with
	// status + chamber — the legislative-activity leg next to fedreg/ukbills.
	try {
		const url =
			"https://www.govtrack.us/api/v2/bill?limit=5&order_by=-current_status_date";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			objects?: {
				display_number?: string;
				title?: string;
				current_status?: string;
				current_status_date?: string;
				current_chamber?: string;
				congress?: number;
				link?: string;
			}[];
		};
		const bills = j.objects ?? [];
		await storeRaw("govtrack", "policy", res.status, { n: bills.length });
		for (const b of bills) {
			if (!b.display_number) continue;
			await storeNormalized({
				id: `govtrack:${b.display_number.replace(/[^A-Za-z0-9]+/g, "-")}`,
				ts: b.current_status_date ?? new Date().toISOString(),
				source: "govtrack",
				layer: "policy",
				title:
					`${b.display_number}: ${(b.title ?? "").slice(0, 160)} [${b.current_status ?? "?"}]`.slice(
						0,
						280,
					),
				url: b.link ?? undefined,
				severity: "info",
				confidence: 0.8,
				entities: {},
				meta: {
					status: b.current_status,
					chamber: b.current_chamber,
					congress: b.congress,
				},
			});
			n++;
		}
		await markHealth("govtrack", true);
	} catch (e: unknown) {
		errors.push(`govtrack: ${errMsg(e)}`);
		await markHealth("govtrack", false, errors[errors.length - 1]);
	}

	await markHealth("fedreg", n > 0, n > 0 ? undefined : errors.join("; "));
	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

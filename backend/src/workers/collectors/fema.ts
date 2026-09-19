import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// FEMA OpenFEMA v2, keyless: federal disaster declarations (DR/EM/FM).
// Public domain, update freq 20min, no key. Feeds the `disasters` layer
// alongside EONET with official declaration + assistance-program context.
const FEMA_URL =
	"https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$format=json&$top=100&$orderby=declarationDate%20desc";

const Decl = z.object({
	femaDeclarationString: z.string(),
	disasterNumber: z.number().optional(),
	state: z.string().optional(),
	declarationType: z.string().optional(),
	declarationDate: z.string().optional(),
	incidentType: z.string().optional(),
	declarationTitle: z.string().optional(),
	designatedArea: z.string().optional(),
	ihProgramDeclared: z.boolean().optional(),
	iaProgramDeclared: z.boolean().optional(),
	paProgramDeclared: z.boolean().optional(),
});

export function femaSeverity(
	declarationType?: string,
	incidentType?: string,
): "watch" | "info" {
	// Major Disaster (DR) + Emergency (EM) outrank Fire Management (FM).
	if (declarationType === "DR" || declarationType === "EM") return "watch";
	if (
		/hurricane|earthquake|tornado|severe storm|typhoon/i.test(
			incidentType ?? "",
		)
	)
		return "watch";
	return "info";
}

export async function collect() {
	const source = "fema";
	const layer = "disasters";
	try {
		assertSafeUrl(FEMA_URL);
		const res = await stealthFetch(FEMA_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as {
			DisasterDeclarationsSummaries?: unknown;
		};
		const rows = z.array(Decl).parse(json.DisasterDeclarationsSummaries ?? []);
		await storeRaw(source, layer, res.status, { n: rows.length });
		let n = 0;
		for (const d of rows.slice(0, 100)) {
			const ts = Date.parse(d.declarationDate ?? "");
			const title = `${d.declarationTitle ?? d.incidentType ?? "Disaster"} — ${d.state ?? "?"} (${d.incidentType ?? d.declarationType ?? "?"})`;
			await storeNormalized({
				id: `fema:${d.femaDeclarationString}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source,
				layer,
				title: title.slice(0, 300),
				body: d.designatedArea ?? undefined,
				url: "https://www.fema.gov/disasters",
				severity: femaSeverity(d.declarationType, d.incidentType),
				confidence: 0.95,
				entities: {},
				meta: {
					state: d.state,
					incidentType: d.incidentType,
					declarationType: d.declarationType,
					disasterNumber: d.disasterNumber,
					ih: d.ihProgramDeclared,
					ia: d.iaProgramDeclared,
					pa: d.paProgramDeclared,
				},
			});
			n++;
		}
		await markHealth(source, true);
		return { ok: true, count: n };
	} catch (e: unknown) {
		await markHealth(source, false, errMsg(e));
		return { ok: false, error: errMsg(e) };
	}
}

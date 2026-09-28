// Writes the OpenAPI document to docs/reference/openapi.json (npm run
// openapi). test/openapi.test.ts fails when the committed copy is stale.
import { writeFileSync } from "node:fs";
import { buildOpenApi } from "../api/openapi.js";

export const OPENAPI_FILE = new URL(
	"../../../docs/reference/openapi.json",
	import.meta.url,
);

if (import.meta.url === `file://${process.argv[1]}`) {
	writeFileSync(OPENAPI_FILE, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
	console.log(`wrote ${OPENAPI_FILE.pathname}`);
}

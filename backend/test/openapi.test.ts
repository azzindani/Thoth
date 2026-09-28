// OpenAPI document: complete (every registered route documented), well
// formed, and the committed docs/reference/openapi.json is current.
// Run: npm run test:unit

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { z } from "zod";
import { createApp } from "../src/api/app.js";
import {
	buildOpenApi,
	openApiPath,
	registeredRoutes,
	toJsonSchema,
} from "../src/api/openapi.js";
import { ROUTE_DOCS } from "../src/api/openapi-routes.js";
import { closePool } from "../src/db/client.js";
import { OPENAPI_FILE } from "../src/scripts/openapi.js";

after(() => closePool());

type Op = {
	operationId: string;
	parameters?: { name: string; in: string; required: boolean }[];
	security?: unknown[];
};

describe("openapi", () => {
	it("documents every registered route, and nothing else", () => {
		const served = registeredRoutes(createApp()).map(
			(r) => `${r.method} ${r.path}`,
		);
		const documented = ROUTE_DOCS.map(
			(r) => `${r.method.toUpperCase()} ${r.path}`,
		);
		const missing = served.filter((r) => !documented.includes(r));
		const stale = documented.filter((r) => !served.includes(r));
		assert.deepEqual(missing, [], "add these to src/api/openapi-routes.ts");
		assert.deepEqual(stale, [], "these are documented but not served");
		assert.equal(new Set(documented).size, documented.length, "duplicates");
	});

	it("builds a well-formed 3.1 document", () => {
		const doc = buildOpenApi() as {
			openapi: string;
			paths: Record<string, Record<string, Op>>;
		};
		assert.equal(doc.openapi, "3.1.0");
		const ids = new Set<string>();
		for (const [path, ops] of Object.entries(doc.paths))
			for (const [method, op] of Object.entries(ops)) {
				assert.ok(!ids.has(op.operationId), `dup ${op.operationId}`);
				ids.add(op.operationId);
				// every {param} in the path is declared as a path parameter
				for (const m of path.matchAll(/\{(\w+)\}/g))
					assert.ok(
						op.parameters?.some((p) => p.in === "path" && p.name === m[1]),
						`${method} ${path}: ${m[1]}`,
					);
				const write = method !== "get";
				assert.equal(!!op.security, write, `${method} ${path} security`);
			}
	});

	it("takes parameters from the validating zod schemas", () => {
		const doc = buildOpenApi() as {
			paths: Record<string, Record<string, Op>>;
		};
		const layer = doc.paths[openApiPath("/api/layers/:layer")]?.get;
		const names = layer?.parameters?.map((p) => `${p.in}:${p.name}`);
		assert.deepEqual(names, [
			"path:layer",
			"query:since",
			"query:z",
			"query:bbox",
		]);
		const dossier = doc.paths["/api/dossier"]?.get?.parameters ?? [];
		assert.equal(dossier.find((p) => p.name === "lat")?.required, true);
		assert.equal(dossier.find((p) => p.name === "radius_km")?.required, false);
	});

	it("converts the zod subset the routes use", () => {
		assert.deepEqual(
			toJsonSchema(z.coerce.number().int().min(1).max(100).default(20)),
			{ type: "integer", minimum: 1, maximum: 100, default: 20 },
		);
		assert.deepEqual(toJsonSchema(z.string().datetime({ offset: true })), {
			type: "string",
			format: "date-time",
		});
		assert.deepEqual(toJsonSchema(z.number().positive()), {
			type: "number",
			exclusiveMinimum: 0,
		});
		assert.deepEqual(
			toJsonSchema(z.object({ a: z.string(), b: z.boolean().optional() })),
			{
				type: "object",
				properties: { a: { type: "string" }, b: { type: "boolean" } },
				required: ["a"],
			},
		);
		assert.deepEqual(toJsonSchema(z.string().transform(Number).describe("n")), {
			type: "string",
			description: "n",
		});
	});

	it("committed docs/reference/openapi.json is current (npm run openapi)", () => {
		const committed = JSON.parse(readFileSync(OPENAPI_FILE, "utf8"));
		assert.deepEqual(committed, buildOpenApi());
	});
});

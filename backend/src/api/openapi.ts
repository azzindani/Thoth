import type express from "express";
import type { z } from "zod";
import { ROUTE_DOCS, type RouteDoc } from "./openapi-routes.js";
import { VERSION } from "./shared.js";

// OpenAPI 3.1 document built from the route catalog (openapi-routes.ts)
// and its zod schemas. Served at GET /api/openapi.json and committed as
// docs/reference/openapi.json (`npm run openapi`); a unit test fails when
// a registered route has no catalog entry, or the committed copy is stale.

type Json = Record<string, unknown>;
type Def = {
	typeName?: string;
	description?: string;
	checks?: {
		kind: string;
		value?: number;
		inclusive?: boolean;
		regex?: RegExp;
	}[];
	[k: string]: unknown;
};

const defOf = (s: z.ZodTypeAny) => s._def as Def;

/** JSON Schema (2020-12, as OpenAPI 3.1 uses) for the zod subset the
 * routes use. Transforms and refinements document their input type. */
export function toJsonSchema(s: z.ZodTypeAny): Json {
	const d = defOf(s);
	const out = convert(s, d);
	if (d.description && out.description === undefined)
		out.description = d.description;
	return out;
}

function convert(s: z.ZodTypeAny, d: Def): Json {
	switch (d.typeName) {
		case "ZodString": {
			const o: Json = { type: "string" };
			for (const c of d.checks ?? []) {
				if (c.kind === "min") o.minLength = c.value;
				else if (c.kind === "max") o.maxLength = c.value;
				else if (c.kind === "regex" && c.regex) o.pattern = c.regex.source;
				else if (c.kind === "datetime") o.format = "date-time";
				else if (c.kind === "email") o.format = "email";
				else if (c.kind === "url") o.format = "uri";
			}
			return o;
		}
		case "ZodNumber": {
			const o: Json = { type: "number" };
			for (const c of d.checks ?? []) {
				if (c.kind === "int") o.type = "integer";
				else if (c.kind === "min")
					o[c.inclusive === false ? "exclusiveMinimum" : "minimum"] = c.value;
				else if (c.kind === "max")
					o[c.inclusive === false ? "exclusiveMaximum" : "maximum"] = c.value;
			}
			return o;
		}
		case "ZodBoolean":
			return { type: "boolean" };
		case "ZodEnum":
			return { type: "string", enum: [...(d.values as string[])] };
		case "ZodLiteral":
			return { const: d.value };
		case "ZodOptional":
			return toJsonSchema(d.innerType as z.ZodTypeAny);
		case "ZodNullable":
			return {
				anyOf: [toJsonSchema(d.innerType as z.ZodTypeAny), { type: "null" }],
			};
		case "ZodDefault":
			return {
				...toJsonSchema(d.innerType as z.ZodTypeAny),
				default: (d.defaultValue as () => unknown)(),
			};
		case "ZodEffects":
			return toJsonSchema(d.schema as z.ZodTypeAny);
		case "ZodArray": {
			const o: Json = {
				type: "array",
				items: toJsonSchema(d.type as z.ZodTypeAny),
			};
			const min = d.minLength as { value: number } | null;
			const max = d.maxLength as { value: number } | null;
			if (min) o.minItems = min.value;
			if (max) o.maxItems = max.value;
			return o;
		}
		case "ZodObject": {
			const shape = (s as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
			const properties: Json = {};
			const required: string[] = [];
			for (const [k, v] of Object.entries(shape)) {
				properties[k] = toJsonSchema(v);
				if (!v.isOptional()) required.push(k);
			}
			return {
				type: "object",
				properties,
				...(required.length ? { required } : {}),
			};
		}
		case "ZodRecord":
			return {
				type: "object",
				additionalProperties: toJsonSchema(d.valueType as z.ZodTypeAny),
			};
		case "ZodUnion":
			return {
				anyOf: (d.options as z.ZodTypeAny[]).map((o) => toJsonSchema(o)),
			};
		case "ZodDiscriminatedUnion":
			return {
				oneOf: [...(d.options as z.ZodTypeAny[])].map((o) => toJsonSchema(o)),
			};
		default:
			// ZodUnknown / ZodAny: anything
			return {};
	}
}

/** "/api/layers/:layer" → "/api/layers/{layer}" */
export const openApiPath = (p: string) => p.replace(/:(\w+)/g, "{$1}");
const pathParams = (p: string) =>
	[...p.matchAll(/:(\w+)/g)].map((m) => m[1] as string);

const WRITE = new Set(["post", "put", "patch", "delete"]);

/** "get" + path words: GET /api/layers/:layer → getLayersLayer; paths
 * outside /api get "Root" (GET /metrics → getRootMetrics). */
const operationId = (r: RouteDoc) =>
	`${r.method}${r.path.startsWith("/api/") ? "" : "Root"}${r.path
		.replace(/^\/api/, "")
		.split(/[/:.-]+/)
		.filter(Boolean)
		.map((w) => w[0]?.toUpperCase() + w.slice(1))
		.join("")}`;

function operation(r: RouteDoc): Json {
	const parameters: Json[] = [];
	const inPath = pathParams(r.path);
	for (const name of inPath)
		parameters.push({
			name,
			in: "path",
			required: true,
			schema: { type: "string" },
		});
	if (r.query) {
		const shape = r.query.shape as Record<string, z.ZodTypeAny>;
		for (const [name, v] of Object.entries(shape)) {
			if (inPath.includes(name)) continue;
			const schema = toJsonSchema(v);
			const { description, ...rest } = schema;
			parameters.push({
				name,
				in: "query",
				required: !v.isOptional(),
				...(description ? { description } : {}),
				schema: rest,
			});
		}
	}
	const ok: Json = r.stream
		? { "text/event-stream": { schema: { type: "string" } } }
		: r.text
			? { "text/plain": { schema: { type: "string" } } }
			: { "application/json": { schema: { type: "object" } } };
	const responses: Json = {
		"200": { description: "OK", content: ok },
		"429": { $ref: "#/components/responses/RateLimited" },
	};
	if (parameters.some((p) => p.in === "query" && p.required) || r.body)
		responses["400"] = { $ref: "#/components/responses/BadRequest" };
	if (r.upstream)
		responses["502"] = { $ref: "#/components/responses/Upstream" };
	const write = WRITE.has(r.method);
	if (write) responses["403"] = { $ref: "#/components/responses/Forbidden" };
	return {
		operationId: operationId(r),
		tags: [r.tag],
		summary: r.summary,
		...(r.description ? { description: r.description } : {}),
		...(parameters.length ? { parameters } : {}),
		...(r.body
			? {
					requestBody: {
						required: true,
						content: { "application/json": { schema: toJsonSchema(r.body) } },
					},
				}
			: {}),
		responses,
		...(write
			? { security: [{ bearerWriteKey: [] }, { headerWriteKey: [] }] }
			: {}),
	};
}

const ERROR = {
	type: "object",
	properties: { ok: { const: false }, error: { type: "string" } },
	required: ["ok", "error"],
};
const errorResponse = (description: string) => ({
	description,
	content: {
		"application/json": { schema: { $ref: "#/components/schemas/Error" } },
	},
});

export function buildOpenApi(routes: RouteDoc[] = ROUTE_DOCS): Json {
	const paths: Record<string, Json> = {};
	for (const r of routes) {
		const p = openApiPath(r.path);
		paths[p] = { ...(paths[p] ?? {}), [r.method]: operation(r) };
	}
	return {
		openapi: "3.1.0",
		info: {
			title: "Thoth API",
			version: VERSION,
			description:
				"Live OSINT layers, intelligence, watches and on-demand lookups. See docs/reference/api.md for conventions (authentication, list and error shapes, the event object).",
			license: { name: "MIT", identifier: "MIT" },
		},
		servers: [
			{ url: "http://127.0.0.1:4000", description: "API, direct (host only)" },
			{ url: "/", description: "Through the app (access token when gated)" },
		],
		tags: [...new Set(routes.map((r) => r.tag))].map((name) => ({ name })),
		paths,
		components: {
			schemas: { Error: ERROR },
			responses: {
				BadRequest: errorResponse("Invalid parameters"),
				Forbidden: errorResponse("Missing or invalid write key"),
				RateLimited: {
					...errorResponse("Rate limited: retry after `Retry-After` seconds"),
					headers: { "Retry-After": { schema: { type: "integer" } } },
				},
				Upstream: errorResponse("The upstream behind this lookup failed"),
			},
			securitySchemes: {
				bearerWriteKey: {
					type: "http",
					scheme: "bearer",
					description: "API_WRITE_KEY, for POST and DELETE",
				},
				headerWriteKey: { type: "apiKey", in: "header", name: "X-Thoth-Key" },
			},
		},
	};
}

/** Every method + path the Express app serves, from its router stack. */
export function registeredRoutes(
	app: express.Express,
): { method: string; path: string }[] {
	const routes: { method: string; path: string }[] = [];
	const stack =
		(app as unknown as { router?: { stack?: unknown[] } }).router?.stack ?? [];
	for (const l of stack) {
		const r = (l as { route?: { path?: unknown; methods?: unknown } }).route;
		if (typeof r?.path !== "string") continue;
		const methods = r.methods as Record<string, unknown> | undefined;
		for (const [m, on] of Object.entries(methods ?? {}))
			if (on && !m.startsWith("_"))
				routes.push({ method: m.toUpperCase(), path: r.path });
	}
	return routes.sort(
		(a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
	);
}

export function registerOpenApi(app: express.Express): void {
	let spec: string | null = null;
	app.get("/api/openapi.json", (_req, res) => {
		spec ??= JSON.stringify(buildOpenApi());
		res.type("application/json").send(spec);
	});
}

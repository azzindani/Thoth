import { readFileSync } from "node:fs";
import { z } from "zod";

// Leaf module for values several route files need. Kept apart from server.ts
// so route modules never import the process entrypoint (circular import).
export const VERSION: string =
	JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	).version ?? "0.0.0";

export const LayerParams = z.object({
	layer: z.string().min(1).max(64),
	since: z.string().datetime({ offset: true }).optional(),
});

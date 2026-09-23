import express from "express";
import { config } from "../config.js";
import {
	cors,
	errorHandler,
	notFound,
	rateLimit,
	requestLog,
	requireWriteKey,
	securityHeaders,
} from "./middleware.js";
import { registerCore } from "./routes-core.js";
import { registerIntel } from "./routes-intel.js";
import { registerMonitor } from "./routes-monitor.js";
import { registerOsint } from "./routes-osint.js";
import { registerRecon } from "./routes-recon.js";

/** "true"/"false"/hop count/comma list → Express `trust proxy` value. */
export function trustProxyValue(v: string): boolean | number | string {
	const s = v.trim();
	if (s === "true") return true;
	if (s === "false" || s === "") return false;
	if (/^\d+$/.test(s)) return Number(s);
	return s;
}

/**
 * Builds the API app without listening, so tests and tooling can mount it.
 * Order matters: observability → headers → CORS → rate limit → write gate
 * (before body parsing, so rejected writes cost nothing) → body → routes →
 * JSON 404 → error handler.
 */
export function createApp(): express.Express {
	const app = express();
	app.disable("x-powered-by");
	app.set("trust proxy", trustProxyValue(config.TRUST_PROXY));

	app.use(requestLog);
	app.use(securityHeaders);
	app.use("/api", cors());
	app.use("/api", rateLimit());
	app.use("/api", requireWriteKey());
	app.use("/api", express.json({ limit: "100kb" }));

	app.use(express.static(new URL("../../public", import.meta.url).pathname));

	registerCore(app);
	registerOsint(app);
	registerRecon(app);
	registerIntel(app);
	registerMonitor(app);

	app.use("/api", notFound);
	app.use(errorHandler);
	return app;
}

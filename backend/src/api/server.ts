import { config } from "../config.js";
import { closePool } from "../db/client.js";
import { log } from "../lib/logger.js";
import { configureNetwork } from "../lib/net.js";
import { createApp } from "./app.js";
import { VERSION } from "./shared.js";
import { closeAllStreams } from "./stream.js";

// Process entrypoint: listen, tune socket timeouts, shut down gracefully.
const SHUTDOWN_GRACE_MS = 10_000;

configureNetwork();
const server = createApp().listen(config.PORT, () =>
	log.info("thoth api up", {
		port: config.PORT,
		version: VERSION,
		env: config.NODE_ENV,
	}),
);
// Keep-alive must outlive any proxy's idle timeout in front of us (Next,
// nginx, cloud LBs default ~60s), else the proxy reuses a socket we just
// closed and the client sees a random 502. Headers timeout must exceed it.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
// Upper bound for a full request; slow OSINT upstreams cap at ~25s. SSE is
// unaffected (requestTimeout covers receiving the request, not the response).
server.requestTimeout = 30_000;

let stopping = false;
function shutdown(sig: string) {
	if (stopping) return;
	stopping = true;
	log.info("shutdown", { sig });
	// SSE sockets never finish on their own; end them so close() can drain.
	closeAllStreams();
	server.close(() => {
		closePool().then(
			() => process.exit(0),
			() => process.exit(1),
		);
	});
	server.closeIdleConnections();
	setTimeout(() => {
		log.warn("shutdown grace expired, forcing exit");
		process.exit(1);
	}, SHUTDOWN_GRACE_MS).unref();
}
for (const sig of ["SIGTERM", "SIGINT"] as const)
	process.on(sig, () => shutdown(sig));

process.on("unhandledRejection", (e) =>
	log.error("unhandled rejection", { error: String(e) }),
);

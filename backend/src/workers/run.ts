import { config } from "../config.js";
import { log } from "../lib/logger.js";
import { COLLECTORS, type CollectorName } from "./registry.js";

// BP7: staggered + jittered intervals, overlap guard, --once mode for cron/CI.
// Usage: npm run dev:worker | node dist/workers/run.js --once quakes
const running = new Set<string>();

function jittered(ms: number): number {
	const pct = config.POLL_JITTER_PCT / 100;
	return Math.floor(ms * (1 - pct + Math.random() * 2 * pct));
}

async function runOnce(name: CollectorName): Promise<void> {
	if (running.has(name)) {
		log.warn("collector overlap skipped", { collector: name });
		return;
	}
	running.add(name);
	try {
		const mod = (await import(COLLECTORS[name].module)) as {
			collect: () => Promise<unknown>;
		};
		const res = (await mod.collect()) as Record<string, unknown>;
		log.info("collector tick", {
			collector: name,
			...(typeof res === "object" ? res : { res }),
		});
	} catch (e: unknown) {
		log.error("collector crashed", { collector: name, error: String(e) });
	} finally {
		running.delete(name);
	}
}

async function main() {
	const once = process.argv.indexOf("--once");
	if (once >= 0) {
		const name = process.argv[once + 1] as CollectorName;
		if (!COLLECTORS[name]) {
			log.error("unknown collector", { name, known: Object.keys(COLLECTORS) });
			process.exit(2);
		}
		await runOnce(name);
		process.exit(0);
	}
	const names = Object.keys(COLLECTORS) as CollectorName[];
	names.forEach((n, i) => {
		setTimeout(() => {
			runOnce(n);
			setInterval(() => runOnce(n), jittered(COLLECTORS[n].intervalSec * 1000));
		}, i * 2000);
	});
	log.info("worker up", { collectors: names });
}

process.on("unhandledRejection", (e) =>
	log.error("unhandled rejection", { error: String(e) }),
);
main();

import { config } from "../config.js";
import { closePool } from "../db/client.js";
import { log } from "../lib/logger.js";
import { errMsg, flushVersions } from "./lib/store.js";
import { COLLECTORS, type CollectorName } from "./registry.js";

// BP7: staggered + jittered intervals, overlap guard, --once mode for cron/CI.
// Usage: npm run dev:worker | node dist/workers/run.js --once quakes
//        node dist/workers/run.js --all-once [width]   (every collector, then exit)
//
// Lifecycle: SIGTERM/SIGINT stop scheduling, let in-flight collectors finish
// (bounded by DRAIN_MS), flush pending layer versions, close the pool. A
// collector still running past its interval is logged as stuck — the overlap
// guard would otherwise skip it forever without a word.
const STAGGER_MS = 2000;
const DRAIN_MS = 25_000; // under docker's default 30s stop timeout
const running = new Map<CollectorName, number>(); // name → start ms
const timers: NodeJS.Timeout[] = [];
let stopping = false;

function jittered(ms: number): number {
	const pct = config.POLL_JITTER_PCT / 100;
	return Math.floor(ms * (1 - pct + Math.random() * 2 * pct));
}

async function runOnce(name: CollectorName): Promise<void> {
	if (stopping) return;
	const started = running.get(name);
	if (started !== undefined) {
		const ageSec = Math.round((Date.now() - started) / 1000);
		const stuck = ageSec > COLLECTORS[name].intervalSec;
		(stuck ? log.error : log.warn)("collector overlap skipped", {
			collector: name,
			running_sec: ageSec,
			stuck,
		});
		return;
	}
	const t0 = Date.now();
	running.set(name, t0);
	try {
		const mod = (await import(COLLECTORS[name].module)) as {
			collect: () => Promise<unknown>;
		};
		const res = (await mod.collect()) as Record<string, unknown>;
		log.info("collector tick", {
			collector: name,
			ms: Date.now() - t0,
			...(typeof res === "object" ? res : { res }),
		});
	} catch (e: unknown) {
		log.error("collector crashed", { collector: name, error: errMsg(e) });
	} finally {
		// Safety net for collectors that store without a trailing markHealth.
		await flushVersions().catch((e: unknown) =>
			log.error("version flush failed", { collector: name, error: errMsg(e) }),
		);
		running.delete(name);
	}
}

async function shutdown(sig: string) {
	if (stopping) return;
	stopping = true;
	for (const t of timers) clearTimeout(t);
	log.info("worker stopping", { sig, in_flight: [...running.keys()] });
	const deadline = Date.now() + DRAIN_MS;
	while (running.size && Date.now() < deadline)
		await new Promise((r) => setTimeout(r, 250));
	if (running.size)
		log.warn("worker drain timed out", { in_flight: [...running.keys()] });
	await flushVersions().catch(() => {});
	await closePool().catch(() => {});
	process.exit(0);
}

/** One pass over every collector, `width` at a time (CI warm-up, backfill). */
async function runAllOnce(width: number) {
	const queue = Object.keys(COLLECTORS) as CollectorName[];
	const t0 = Date.now();
	await Promise.all(
		Array.from({ length: width }, async () => {
			for (let n = queue.shift(); n; n = queue.shift()) await runOnce(n);
		}),
	);
	log.info("all collectors attempted", {
		collectors: Object.keys(COLLECTORS).length,
		ms: Date.now() - t0,
	});
}

async function main() {
	const all = process.argv.indexOf("--all-once");
	if (all >= 0) {
		const width = Number(process.argv[all + 1]) || 4;
		await runAllOnce(Math.min(Math.max(width, 1), 16));
		await closePool();
		process.exit(0);
	}
	const once = process.argv.indexOf("--once");
	if (once >= 0) {
		const name = process.argv[once + 1] as CollectorName;
		if (!COLLECTORS[name]) {
			log.error("unknown collector", { name, known: Object.keys(COLLECTORS) });
			process.exit(2);
		}
		await runOnce(name);
		await closePool();
		process.exit(0);
	}
	const names = Object.keys(COLLECTORS) as CollectorName[];
	names.forEach((n, i) => {
		timers.push(
			setTimeout(() => {
				runOnce(n);
				timers.push(
					setInterval(
						() => runOnce(n),
						jittered(COLLECTORS[n].intervalSec * 1000),
					),
				);
			}, i * STAGGER_MS),
		);
	});
	log.info("worker up", { collectors: names.length, env: config.NODE_ENV });
}

for (const sig of ["SIGTERM", "SIGINT"] as const)
	process.on(sig, () => void shutdown(sig));
process.on("unhandledRejection", (e) =>
	log.error("unhandled rejection", { error: String(e) }),
);
main();

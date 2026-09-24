import { config } from "../config.js";
import { closePool } from "../db/client.js";
import { log } from "../lib/logger.js";
import { configureNetwork } from "../lib/net.js";
import { intelPass } from "./intel.js";
import { errMsg, flushVersions } from "./lib/store.js";
import { instrumentFetch, withRun } from "./lib/telemetry.js";
import {
	checkAlerts,
	claimRequests,
	finishRequests,
	heartbeat,
	prune,
	scheduleEnd,
	scheduleInit,
	scheduleStart,
} from "./ops.js";
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
// Jittered period each collector actually runs on (for next-due times).
const period = new Map<CollectorName, number>();
const HEARTBEAT_MS = 15_000;
const REQUEST_POLL_MS = 5_000;
const ALERT_MS = 60_000;
const PRUNE_MS = 3_600_000;
const INTEL_MS = 300_000;
let stopping = false;

function jittered(ms: number): number {
	const pct = config.POLL_JITTER_PCT / 100;
	return Math.floor(ms * (1 - pct + Math.random() * 2 * pct));
}

async function runOnce(
	name: CollectorName,
	trigger: "schedule" | "manual" | "once" = "schedule",
): Promise<void> {
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
	if (trigger !== "once") await scheduleStart(name);
	try {
		const mod = (await import(COLLECTORS[name].module)) as {
			collect: () => Promise<unknown>;
		};
		// Recorded run: timing, outcome, every upstream call (monitor P1).
		const res = (await withRun(name, trigger, mod.collect)) as Record<
			string,
			unknown
		>;
		log.info("collector tick", {
			collector: name,
			trigger,
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
		if (trigger !== "once") {
			const p = period.get(name);
			await scheduleEnd(name, p ? new Date(t0 + p) : null);
		}
		if (trigger === "manual") await finishRequests(name);
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
			for (let n = queue.shift(); n; n = queue.shift())
				await runOnce(n, "once");
		}),
	);
	log.info("all collectors attempted", {
		collectors: Object.keys(COLLECTORS).length,
		ms: Date.now() - t0,
	});
}

async function main() {
	configureNetwork();
	instrumentFetch();
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
		await runOnce(name, "once");
		await closePool();
		process.exit(0);
	}
	const names = Object.keys(COLLECTORS) as CollectorName[];
	const boot = Date.now();
	for (const [i, n] of names.entries()) {
		const every = jittered(COLLECTORS[n].intervalSec * 1000);
		period.set(n, every);
		await scheduleInit(
			n,
			COLLECTORS[n].intervalSec,
			new Date(boot + i * STAGGER_MS),
		);
		timers.push(
			setTimeout(() => {
				runOnce(n);
				timers.push(setInterval(() => runOnce(n), every));
			}, i * STAGGER_MS),
		);
	}
	// Ops loops: liveness, "run now" requests, feed alerts, retention.
	void heartbeat(names.length);
	timers.push(setInterval(() => void heartbeat(names.length), HEARTBEAT_MS));
	timers.push(
		setInterval(async () => {
			if (stopping) return;
			for (const n of await claimRequests())
				if (n in COLLECTORS) void runOnce(n as CollectorName, "manual");
				else await finishRequests(n);
		}, REQUEST_POLL_MS),
	);
	timers.push(
		setInterval(() => {
			checkAlerts()
				.then((r) => {
					if (r.raised.length || r.cleared.length) log.info("ops alerts", r);
				})
				.catch((e: unknown) =>
					log.warn("ops alerts failed", { error: errMsg(e) }),
				);
		}, ALERT_MS),
	);
	// Intelligence layer (P4): duplicates, incidents, anomaly samples.
	const doIntel = () =>
		intelPass()
			.then((r) => log.info("intel pass", r))
			.catch((e: unknown) => log.warn("intel failed", { error: errMsg(e) }));
	timers.push(setTimeout(doIntel, 90_000));
	timers.push(setInterval(doIntel, INTEL_MS));
	const doPrune = () =>
		prune()
			.then((r) => log.info("retention prune", r))
			.catch((e: unknown) => log.warn("prune failed", { error: errMsg(e) }));
	timers.push(setTimeout(doPrune, 120_000));
	timers.push(setInterval(doPrune, PRUNE_MS));
	log.info("worker up", { collectors: names.length, env: config.NODE_ENV });
}

for (const sig of ["SIGTERM", "SIGINT"] as const)
	process.on(sig, () => void shutdown(sig));
process.on("unhandledRejection", (e) =>
	log.error("unhandled rejection", { error: String(e) }),
);
main();

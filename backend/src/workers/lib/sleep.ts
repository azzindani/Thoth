// Politeness gaps and retry backoff between upstream calls. One helper so the
// delay is observable and tunable: THOTH_DELAY_SCALE=0 collapses every wait
// (collector contract tests stub fetch, so waiting on them is pure overhead).
const raw = Number(process.env.THOTH_DELAY_SCALE ?? "1");
const SCALE = Number.isFinite(raw) && raw >= 0 ? raw : 1;

export function sleep(ms: number): Promise<void> {
	const wait = Math.round(ms * SCALE);
	return wait > 0 ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve();
}

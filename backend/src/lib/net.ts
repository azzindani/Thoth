import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

// Node's "happy eyeballs" (autoSelectFamily) gives each resolved address
// 250 ms to finish the TCP handshake before moving on, and fails the whole
// connect once every attempt has missed. From this VPS the handshake alone
// to NASA, USGS, Treasury, Tor and ReliefWeb takes 260–460 ms, so those
// feeds died in under a second as "fetch failed" (ETIMEDOUT) while curl on
// the same host connected fine. 2.5 s per attempt keeps the dual-stack
// fallback and still fails fast on a genuinely dead address.
export const CONNECT_ATTEMPT_MS = 2500;

/** Call once at process start, before any outbound request. */
export function configureNetwork() {
	setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_MS);
}

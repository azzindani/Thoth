import { z } from "zod";

// Central config (BP3): everything operational comes from env with sane defaults.
// Provider URLs stay as documented constants in collectors — changing them is a code change.
const DEV_DATABASE_URL = "postgres://thoth:thoth@localhost:5432/thoth";
const Env = z.object({
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default("development"),
	DATABASE_URL: z.string().default(DEV_DATABASE_URL),
	PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
	// Per-statement ceiling so one runaway query cannot pin a pool slot
	// forever. Migrations opt out (see scripts/migrate.ts).
	PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(60000),
	PORT: z.coerce.number().int().min(1).max(65535).default(4000),
	// Comma-separated allowlist, or "*" for any origin.
	CORS_ORIGIN: z.string().default("*"),
	// Express "trust proxy" value. Default trusts private-network hops only
	// (Next rewrite proxy, docker network, cloudflared on loopback), so the
	// rate limiter keys on the real client IP instead of the proxy's.
	TRUST_PROXY: z.string().default("loopback, linklocal, uniquelocal"),
	// Shared secret for mutating /api routes (POST/PUT/PATCH/DELETE), sent as
	// `Authorization: Bearer <key>` or `X-Thoth-Key`. Unset in production =
	// writes refused (fail closed); unset in dev = writes open.
	API_WRITE_KEY: z.string().default(""),
	REQUESTS_PER_MIN: z.coerce.number().int().min(10).default(120),
	POLL_JITTER_PCT: z.coerce.number().min(0).max(50).default(10),
	TELEGRAM_CHANNELS: z
		.string()
		.default("osintdefender,war_monitor,clashreport"),
	// Keyed slots (all free-signup, all honest-disabled when unset — never
	// crash, never fake data). OTX was first (Phase 1); Finnhub earnings and
	// Telegram push followed the same contract. Documented in docs/operations/configuration.md.
	OTX_API_KEY: z.string().default(""),
	FINNHUB_KEY: z.string().default(""),
	TELEGRAM_BOT_TOKEN: z.string().default(""),
	TELEGRAM_CHAT_ID: z.string().default(""),
	// Retention (worker prune job, hourly). Monitor history and the raw
	// fetch log are operational and short-lived; events are intelligence,
	// kept longer, and only pruned when neither observed nor re-seen within
	// the window (static catalogs are never pruned). 0 = keep forever.
	MONITOR_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
	RAW_RETENTION_DAYS: z.coerce.number().int().min(0).default(14),
	EVENTS_RETENTION_DAYS: z.coerce.number().int().min(0).default(180),
	// Consecutive failed runs before a source raises an ops alert.
	ALERT_FAIL_STREAK: z.coerce.number().int().min(1).default(3),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
	console.error(
		JSON.stringify({
			level: "fatal",
			msg: "invalid env",
			issues: parsed.error.issues,
		}),
	);
	process.exit(1);
}
// Production must never silently fall back to the dev credentials.
if (parsed.data.NODE_ENV === "production" && !process.env.DATABASE_URL) {
	console.error(
		JSON.stringify({
			level: "fatal",
			msg: "DATABASE_URL is required when NODE_ENV=production",
		}),
	);
	process.exit(1);
}
export const config = parsed.data;
export const isProduction = config.NODE_ENV === "production";
export const telegramChannels = () =>
	config.TELEGRAM_CHANNELS.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 5);

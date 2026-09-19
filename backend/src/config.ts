import { z } from "zod";

// Central config (BP3): everything operational comes from env with sane defaults.
// Provider URLs stay as documented constants in collectors — changing them is a code change.
const Env = z.object({
	DATABASE_URL: z
		.string()
		.default("postgres://thoth:thoth@localhost:5432/thoth"),
	PORT: z.coerce.number().int().min(1).max(65535).default(4000),
	CORS_ORIGIN: z.string().default("*"),
	REQUESTS_PER_MIN: z.coerce.number().int().min(10).default(120),
	POLL_JITTER_PCT: z.coerce.number().min(0).max(50).default(10),
	TELEGRAM_CHANNELS: z
		.string()
		.default("osintdefender,war_monitor,clashreport"),
	// Keyed slots (all free-signup, all honest-disabled when unset — never
	// crash, never fake data). OTX was first (Phase 1); Finnhub earnings and
	// Telegram push followed the same contract. Documented in OUTSTANDING.md A.
	OTX_API_KEY: z.string().default(""),
	FINNHUB_KEY: z.string().default(""),
	TELEGRAM_BOT_TOKEN: z.string().default(""),
	TELEGRAM_CHAT_ID: z.string().default(""),
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
export const config = parsed.data;
export const telegramChannels = () =>
	config.TELEGRAM_CHANNELS.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 5);

// BP6: structured JSON-line logs. Levels: debug, info, warn, error.
type Fields = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";
const rank: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function parseLevel(v: string | undefined): Level {
	return v === "debug" || v === "info" || v === "warn" || v === "error"
		? v
		: "info";
}
const threshold = rank[parseLevel(process.env.LOG_LEVEL)];

function emit(lvl: Level, msg: string, fields: Fields = {}) {
	if (rank[lvl] < threshold) return;
	console.log(
		JSON.stringify({
			ts: new Date().toISOString(),
			level: lvl,
			msg,
			...fields,
		}),
	);
}

export const log = {
	debug: (msg: string, f?: Fields) => emit("debug", msg, f),
	info: (msg: string, f?: Fields) => emit("info", msg, f),
	warn: (msg: string, f?: Fields) => emit("warn", msg, f),
	error: (msg: string, f?: Fields) => emit("error", msg, f),
};

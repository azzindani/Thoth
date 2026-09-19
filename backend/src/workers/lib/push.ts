// Telegram push delivery (Phase 6 alerts leg). Bot token + chat id come from
// env; unset → honest disabled, never throws, never fakes a send.

import { config } from "../../config.js";

export async function sendTelegram(
	token: string,
	chat: string,
	text: string,
	fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const r = await fetchImpl(
			`https://api.telegram.org/bot${token}/sendMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000) }),
				signal: AbortSignal.timeout(15000),
			},
		);
		if (!r.ok) return { ok: false, error: `telegram HTTP ${r.status}` };
		return { ok: true };
	} catch (e: unknown) {
		return {
			ok: false,
			error:
				e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120),
		};
	}
}

export async function pushTelegram(
	text: string,
): Promise<{ ok: boolean; error?: string }> {
	const token = config.TELEGRAM_BOT_TOKEN;
	const chat = config.TELEGRAM_CHAT_ID;
	if (!token || !chat)
		return { ok: false, error: "disabled: TELEGRAM_BOT_TOKEN/CHAT_ID unset" };
	return sendTelegram(token, chat, text);
}

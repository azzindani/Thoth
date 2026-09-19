import { createHash } from "node:crypto";
import { telegramChannels } from "../../config.js";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";

// Keyless web-preview scrape (osiris pattern): https://t.me/s/<channel>, regex posts, no MTProto.
const CHANNELS = telegramChannels();

// Tiny multilingual place dictionary for v0 geoparsing (expand in docs/ADDING_ENDPOINTS.md)
const PLACES: Array<{ name: string; lon: number; lat: number }> = [
	{ name: "kyiv", lon: 30.523, lat: 50.45 },
	{ name: "kharkiv", lon: 36.23, lat: 49.99 },
	{ name: "donetsk", lon: 37.8, lat: 48.0 },
	{ name: "gaza", lon: 34.45, lat: 31.5 },
	{ name: "tehran", lon: 51.38, lat: 35.68 },
	{ name: "tel aviv", lon: 34.78, lat: 32.08 },
	{ name: "beirut", lon: 35.5, lat: 33.89 },
	{ name: "damascus", lon: 36.29, lat: 33.51 },
	{ name: "odesa", lon: 30.72, lat: 46.48 },
	{ name: "kherson", lon: 32.61, lat: 46.63 },
];

function geoparse(text: string): { lon: number; lat: number } | null {
	const t = text.toLowerCase();
	for (const p of PLACES)
		if (t.includes(p.name)) return { lon: p.lon, lat: p.lat };
	return null;
}

export interface TgPost {
	postId: string;
	datetime: string;
	rawText: string;
}

// Split for testability: video/photo posts carry KBs of inline SVG + thumb
// markup between the anchors, so the windows are generous (tight 4000/8000
// windows silently dropped every video post — aljazeeraenglish read zero).
export function parseTelegramPosts(html: string, cap = 20): TgPost[] {
	const posts = [
		...html.matchAll(
			/data-post="([^"]+)"[\s\S]{0,12000}?datetime="([^"]+)"[\s\S]{0,20000}?js-message_text"[^>]*>([\s\S]{0,2000}?)<\/div>/g,
		),
	];
	return posts.slice(0, cap).map((m) => ({
		postId: m[1],
		datetime: m[2],
		rawText: m[3],
	}));
}

function stripHtml(s: string): string {
	return s
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.trim();
}

export async function collect() {
	const source = "telegram";
	const layer = "telegram";
	let total = 0;
	const errors: string[] = [];
	for (const ch of CHANNELS) {
		const url = `https://t.me/s/${ch}`;
		try {
			assertSafeUrl(url);
			const res = await stealthFetch(url, {}, 20000);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const html = await res.text();
			const posts = parseTelegramPosts(html);
			await storeRaw(source, layer, res.status, {
				channel: ch,
				n: posts.length,
			});
			for (const { postId, datetime, rawText } of posts) {
				const text = stripHtml(rawText).slice(0, 500);
				if (!text) continue;
				const geo = geoparse(text);
				await storeNormalized({
					id: `tg:${createHash("md5").update(postId).digest("hex")}`,
					ts:
						Date.parse(datetime) && !Number.isNaN(Date.parse(datetime))
							? new Date(datetime).toISOString()
							: new Date().toISOString(),
					source,
					layer,
					title: `@${ch}: ${text.slice(0, 120)}`,
					body: text,
					url: `https://t.me/${postId}`,
					severity: "info",
					confidence: geo ? 0.55 : 0.4,
					lon: geo?.lon,
					lat: geo?.lat,
					entities: {},
					meta: { channel: ch },
				});
				total++;
			}
			await new Promise((r) => setTimeout(r, 1500)); // be polite between channels
		} catch (e: unknown) {
			errors.push(`${ch}: ${errMsg(e)}`);
		}
	}
	await markHealth(
		source,
		errors.length < CHANNELS.length,
		errors.join("; ") || undefined,
	);
	if (total === 0) return { ok: false, error: errors.join("; ") || "no posts" };
	return { ok: true, count: total };
}

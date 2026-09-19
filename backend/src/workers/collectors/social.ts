// Keyless social signal (no auth walls): Mastodon hashtag timelines,
// ArcticShift Reddit search, Lemmy post list, Flickr tag feeds, iNaturalist
// recent observations → `news` layer (eye-witness/social pulse). Bluesky
// searchPosts 403s here — parked, not shipped.
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSafeUrl, stealthFetch } from "../lib/fetch.js";
import { errMsg, markHealth, storeNormalized, storeRaw } from "../lib/store.js";
import { parseRSS } from "./news.js";

const TAGS = ["earthquake", "flood", "wildfire"];

function stripHtml(s: string): string {
	return s
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

const Toot = z.object({
	id: z.union([z.string(), z.number()]).optional(),
	created_at: z.string().optional(),
	content: z.string().optional(),
	url: z.string().nullable().optional(),
	account: z
		.object({ username: z.string().optional() })
		.passthrough()
		.optional(),
});

export async function collect() {
	const layer = "news";
	let n = 0;
	const errors: string[] = [];

	// Mastodon hashtag timelines (mastodon.social relays the fediverse).
	for (const tag of TAGS) {
		try {
			const url = `https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=5`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const toots = z.array(Toot).parse(await res.json());
			await storeRaw("masto", layer, res.status, { tag, n: toots.length });
			for (const t of toots) {
				const text = stripHtml(t.content ?? "").slice(0, 280);
				if (!text) continue;
				const ts = Date.parse(t.created_at ?? "");
				await storeNormalized({
					id: `masto:${tag}:${t.id ?? createHash("md5").update(text).digest("hex")}`,
					ts: Number.isNaN(ts)
						? new Date().toISOString()
						: new Date(ts).toISOString(),
					source: "masto",
					layer,
					title: `@${t.account?.username ?? "?"}: ${text}`.slice(0, 300),
					url: t.url ?? undefined,
					severity: "info",
					confidence: 0.6,
					entities: {},
					meta: { tag },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`masto/${tag}: ${errMsg(e)}`);
		}
	}
	const mastoOk = !errors.some((e) => e.startsWith("masto/"));
	await markHealth("masto", mastoOk, mastoOk ? undefined : errors.join("; "));

	// ArcticShift Reddit search (Pushshift successor, keyless).
	for (const q of ["earthquake", "flood"]) {
		try {
			const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=worldnews&limit=3&query=${encodeURIComponent(q)}`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const j = (await res.json()) as {
				data?: {
					title?: string;
					author?: string;
					score?: number;
					num_comments?: number;
					created_utc?: number;
					permalink?: string;
				}[];
			};
			const posts = j.data ?? [];
			await storeRaw("reddit", layer, res.status, { q, n: posts.length });
			for (const p of posts) {
				if (!p.title || !p.permalink) continue;
				const ts =
					typeof p.created_utc === "number" ? p.created_utc * 1000 : NaN;
				await storeNormalized({
					id: `reddit:${createHash("md5").update(p.permalink).digest("hex")}`,
					ts: Number.isNaN(ts)
						? new Date().toISOString()
						: new Date(ts).toISOString(),
					source: "reddit",
					layer,
					title: p.title.slice(0, 280),
					url: `https://www.reddit.com${p.permalink}`,
					severity: "info",
					confidence: 0.6,
					entities: {},
					meta: { author: p.author, score: p.score, comments: p.num_comments },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`reddit/${q}: ${errMsg(e)}`);
		}
	}
	const redditOk = !errors.some((e) => e.startsWith("reddit/"));
	await markHealth(
		"reddit",
		redditOk,
		redditOk ? undefined : errors.join("; "),
	);

	// Lemmy world post list (federated forum pulse).
	try {
		const url = "https://lemmy.world/api/v3/post/list?limit=5&sort=New";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			posts?: {
				post?: { name?: string; url?: string; published?: string; id?: number };
			}[];
		};
		const posts = j.posts ?? [];
		await storeRaw("lemmy", layer, res.status, { n: posts.length });
		for (const w of posts) {
			const p = w.post;
			if (!p?.name) continue;
			const ts = Date.parse(p.published ?? "");
			await storeNormalized({
				id: `lemmy:${p.id ?? createHash("md5").update(p.name).digest("hex")}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "lemmy",
				layer,
				title: p.name.slice(0, 280),
				url: p.url ?? undefined,
				severity: "info",
				confidence: 0.55,
				entities: {},
				meta: {},
			});
			n++;
		}
		await markHealth("lemmy", true);
	} catch (e: unknown) {
		errors.push(`lemmy: ${errMsg(e)}`);
		await markHealth("lemmy", false, errors[errors.length - 1]);
	}

	// Flickr tag feeds per disaster tag (eye-witness photos).
	for (const tag of TAGS.slice(0, 2)) {
		try {
			const url = `https://www.flickr.com/services/feeds/photos_public.gne?tags=${encodeURIComponent(tag)}&format=json&nojsoncallback=1`;
			assertSafeUrl(url);
			const res = await stealthFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const j = (await res.json()) as {
				items?: { title?: string; link?: string; date_taken?: string }[];
			};
			const items = (j.items ?? []).slice(0, 5);
			await storeRaw("flickr", layer, res.status, { tag, n: items.length });
			for (const it of items) {
				if (!it.title || !it.link) continue;
				const ts = Date.parse(it.date_taken ?? "");
				await storeNormalized({
					id: `flickr:${createHash("md5").update(it.link).digest("hex")}`,
					ts: Number.isNaN(ts)
						? new Date().toISOString()
						: new Date(ts).toISOString(),
					source: "flickr",
					layer,
					title: `Photo: ${it.title.slice(0, 240)} (#${tag})`.slice(0, 300),
					url: it.link,
					severity: "info",
					confidence: 0.55,
					entities: {},
					meta: { tag },
				});
				n++;
			}
		} catch (e: unknown) {
			errors.push(`flickr/${tag}: ${errMsg(e)}`);
		}
	}
	const flickrOk = !errors.some((e) => e.startsWith("flickr/"));
	await markHealth(
		"flickr",
		flickrOk,
		flickrOk ? undefined : errors.join("; "),
	);

	// iNaturalist recent observations (biodiversity pulse, geo when present).
	try {
		const url =
			"https://api.inaturalist.org/v1/observations?per_page=10&order_by=observed_on&order=desc";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			results?: {
				id?: number;
				observed_on?: string | null;
				place_guess?: string | null;
				taxon?: { name?: string } | null;
				geojson?: { coordinates?: number[] } | null;
			}[];
		};
		const rows = j.results ?? [];
		await storeRaw("inat", layer, res.status, { n: rows.length });
		for (const o of rows) {
			const sp = o.taxon?.name ?? "observation";
			const ts = Date.parse(o.observed_on ?? "");
			const coords = o.geojson?.coordinates;
			await storeNormalized({
				id: `inat:${o.id ?? createHash("md5").update(`${sp}${o.observed_on}`).digest("hex")}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "inat",
				layer,
				title: `${sp}${o.place_guess ? ` — ${o.place_guess}` : ""}`.slice(
					0,
					300,
				),
				severity: "info",
				confidence: 0.6,
				lon: Array.isArray(coords) ? coords[0] : undefined,
				lat: Array.isArray(coords) ? coords[1] : undefined,
				entities: {},
				meta: { species: sp },
			});
			n++;
		}
		await markHealth("inat", true);
	} catch (e: unknown) {
		errors.push(`inat: ${errMsg(e)}`);
		await markHealth("inat", false, errors[errors.length - 1]);
	}

	// GBIF recent occurrences (research-grade biodiversity).
	try {
		const url = "https://api.gbif.org/v1/occurrence/search?limit=10&year=2026";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			results?: {
				key?: number;
				scientificName?: string;
				eventDate?: string;
				decimalLatitude?: number;
				decimalLongitude?: number;
			}[];
		};
		const rows = j.results ?? [];
		await storeRaw("gbif", layer, res.status, { n: rows.length });
		for (const o of rows) {
			if (!o.key) continue;
			const ts = Date.parse(o.eventDate ?? "");
			await storeNormalized({
				id: `gbif:${o.key}`,
				ts: Number.isNaN(ts)
					? new Date().toISOString()
					: new Date(ts).toISOString(),
				source: "gbif",
				layer,
				title: (o.scientificName ?? "occurrence").slice(0, 300),
				severity: "info",
				confidence: 0.6,
				lon:
					typeof o.decimalLongitude === "number"
						? o.decimalLongitude
						: undefined,
				lat:
					typeof o.decimalLatitude === "number" ? o.decimalLatitude : undefined,
				entities: {},
				meta: {},
			});
			n++;
		}
		await markHealth("gbif", true);
	} catch (e: unknown) {
		errors.push(`gbif: ${errMsg(e)}`);
		await markHealth("gbif", false, errors[errors.length - 1]);
	}

	// Bluesky actor directory (keyless): news-org handles as watchlist pulse.
	try {
		const url =
			"https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=news&limit=10";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const j = (await res.json()) as {
			actors?: { did?: string; handle?: string; displayName?: string }[];
		};
		const rows = j.actors ?? [];
		await storeRaw("bsky", layer, res.status, { n: rows.length });
		for (const a of rows) {
			if (!a.did) continue;
			await storeNormalized({
				id: `bsky:${a.did.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 60)}`,
				ts: new Date().toISOString(),
				source: "bsky",
				layer,
				title: `${a.displayName ?? a.handle ?? "?"} (@${a.handle ?? "?"}) on Bluesky`,
				severity: "info",
				confidence: 0.6,
				entities: {},
				meta: { handle: a.handle ?? null },
			});
			n++;
		}
		await markHealth("bsky", true);
	} catch (e: unknown) {
		errors.push(`bsky: ${errMsg(e)}`);
		await markHealth("bsky", false, errors[errors.length - 1]);
	}

	// GitHub public events (keyless, 60/hr): firehose sample of code activity.
	try {
		const url = "https://api.github.com/events?per_page=5";
		assertSafeUrl(url);
		const res = await stealthFetch(url, {
			headers: { "User-Agent": "Thoth/0.1 (+https://github.com/thoth)" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			id?: string;
			type?: string;
			created_at?: string;
			actor?: { login?: string };
			repo?: { name?: string };
		}[];
		await storeRaw("gh-events", layer, res.status, { n: rows.length });
		for (const e of rows) {
			if (!e.id) continue;
			await storeNormalized({
				id: `ghevent:${e.id}`,
				ts: e.created_at ?? new Date().toISOString(),
				source: "gh-events",
				layer,
				title:
					`${e.actor?.login ?? "?"} ${e.type ?? "?"} → ${e.repo?.name ?? "?"}`.slice(
						0,
						300,
					),
				severity: "info",
				confidence: 0.6,
				entities: {},
				meta: { type: e.type ?? null, actor: e.actor?.login ?? null },
			});
			n++;
		}
		await markHealth("gh-events", true);
	} catch (e: unknown) {
		errors.push(`gh-events: ${errMsg(e)}`);
		await markHealth("gh-events", false, errors[errors.length - 1]);
	}

	// Lobsters newest (keyless JSON): hacker-news-adjacent tech pulse.
	try {
		const url = "https://lobste.rs/newest.json";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			short_id?: string;
			created_at?: string;
			title?: string;
			score?: number;
			comment_count?: number;
			tags?: string[];
		}[];
		await storeRaw("lobsters", layer, res.status, { n: rows.length });
		for (const p of rows.slice(0, 15)) {
			if (!p.short_id) continue;
			await storeNormalized({
				id: `lobsters:${p.short_id}`,
				ts: p.created_at ?? new Date().toISOString(),
				source: "lobsters",
				layer,
				title: `${(p.title ?? "?").slice(0, 220)} [+${p.score ?? 0}/${p.comment_count ?? 0}]`,
				url: `https://lobste.rs/s/${p.short_id}`,
				severity: (p.score ?? 0) >= 20 ? "watch" : "info",
				confidence: 0.7,
				entities: {},
				meta: {
					score: p.score,
					comments: p.comment_count,
					tags: (p.tags ?? []).slice(0, 5),
				},
			});
			n++;
		}
		await markHealth("lobsters", true);
	} catch (e: unknown) {
		errors.push(`lobsters: ${errMsg(e)}`);
		await markHealth("lobsters", false, errors[errors.length - 1]);
	}

	// DEV.to security tag (keyless): practitioner security writing pulse.
	try {
		const url = "https://dev.to/api/articles?per_page=10&tag=security";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			id?: number;
			title?: string;
			published_at?: string;
			url?: string;
			public_reactions_count?: number;
			comments_count?: number;
			user?: { username?: string };
		}[];
		await storeRaw("devto", layer, res.status, { n: rows.length });
		for (const a of rows) {
			if (!a.id) continue;
			await storeNormalized({
				id: `devto:${a.id}`,
				ts: a.published_at ?? new Date().toISOString(),
				source: "devto",
				layer,
				title: `${(a.title ?? "?").slice(0, 230)} (@${a.user?.username ?? "?"})`,
				url: a.url ?? `https://dev.to/article/${a.id}`,
				severity: "info",
				confidence: 0.65,
				entities: {},
				meta: {
					reactions: a.public_reactions_count ?? null,
					comments: a.comments_count ?? null,
					author: a.user?.username ?? null,
				},
			});
			n++;
		}
		await markHealth("devto", true);
	} catch (e: unknown) {
		errors.push(`devto: ${errMsg(e)}`);
		await markHealth("devto", false, errors[errors.length - 1]);
	}

	// radio-browser geo stations (keyless): sampled community radio
	// transmitters with real coordinates — media-activity pulse.
	try {
		const url =
			"https://de1.api.radio-browser.info/json/stations/search?has_geo_info=true&order=votes&hidebroken=true&limit=15";
		assertSafeUrl(url);
		const res = await stealthFetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const rows = (await res.json()) as {
			stationuuid?: string;
			name?: string;
			country?: string;
			votes?: number;
			geo_lat?: number | null;
			geo_long?: number | null;
			tags?: string;
		}[];
		await storeRaw("radio", layer, res.status, { n: rows.length });
		for (const st of rows) {
			if (!st.stationuuid) continue;
			if (typeof st.geo_lat !== "number" || typeof st.geo_long !== "number")
				continue;
			await storeNormalized({
				id: `radio:${st.stationuuid.slice(0, 16)}`,
				ts: new Date().toISOString(),
				source: "radio",
				layer,
				title:
					`${st.name ?? "?"} (${st.country ?? "?"}) — ${(st.tags ?? "").slice(0, 100)}`.slice(
						0,
						280,
					),
				severity: "info",
				confidence: 0.6,
				lon: st.geo_long,
				lat: st.geo_lat,
				entities: {},
				meta: { country: st.country, votes: st.votes ?? null },
			});
			n++;
		}
		await markHealth("radio", true);
	} catch (e: unknown) {
		errors.push(`radio: ${errMsg(e)}`);
		await markHealth("radio", false, errors[errors.length - 1]);
	}

	if (n === 0) return { ok: false, error: errors.join("; ") };
	return { ok: true, count: n };
}

export { parseRSS };
